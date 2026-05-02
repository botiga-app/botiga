// Clone-from-public-storefront admin tool.
//
// Flow:
//   1. POST /api/admin/clone/start { source_url, target_merchant_id }
//        → validates source returns products.json, creates clone_jobs row
//   2. POST /api/admin/clone/tick?job_id=X
//        → processes one chunk of work (products, policies, or pages)
//          and updates the cursor. Dashboard polls this in a loop.
//   3. GET  /api/admin/clone/status?job_id=X
//        → returns current job state for the progress UI
//   4. GET  /api/admin/clone/jobs
//        → list recent clone jobs for the dashboard history view
//   5. GET  /api/admin/clone/clone-targets
//        → list merchants we can clone *into* (kind in clone/test, has access token)

const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const { validateAdminSecret } = require('../middleware/auth');
const {
  fetchProductsPage,
  fetchPolicy,
  fetchPageUrls,
  fetchPage,
  normalizeBase,
  POLICY_SLUGS,
} = require('../services/storefrontCrawler');
const {
  productExists,
  createProduct,
  pageExists,
  createPage,
  updatePolicy,
} = require('../services/adminWriter');
const { getValidShopifyToken } = require('../lib/shopifyToken');

router.use('/admin/clone', validateAdminSecret);

// Tunables. Each tick stays comfortably under Vercel Hobby's 60s function limit.
const PRODUCTS_PER_TICK = 15;
const PAGES_PER_TICK = 5;
const RATE_LIMIT_MS = 500; // Shopify standard plans = 2 req/s

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function appendLog(jobId, level, msg) {
  const { data: job } = await supabase
    .from('clone_jobs')
    .select('log')
    .eq('id', jobId)
    .single();
  const log = Array.isArray(job?.log) ? job.log : [];
  log.push({ ts: new Date().toISOString(), level, msg: String(msg).slice(0, 500) });
  // Keep last 200 entries
  await supabase
    .from('clone_jobs')
    .update({ log: log.slice(-200) })
    .eq('id', jobId);
}

// ─── Start ──────────────────────────────────────────────────────────────────
router.post('/admin/clone/start', async (req, res) => {
  const { source_url, target_merchant_id } = req.body || {};
  if (!source_url || !target_merchant_id) {
    return res.status(400).json({ error: 'source_url and target_merchant_id required' });
  }

  // Validate target merchant has Admin API credentials
  const { data: merchant, error: merchErr } = await supabase
    .from('merchants')
    .select('id, shopify_domain, shopify_access_token, shopify_refresh_token, shopify_token_expires_at, kind')
    .eq('id', target_merchant_id)
    .maybeSingle();
  if (merchErr) return res.status(500).json({ error: merchErr.message });
  if (!merchant) return res.status(404).json({ error: 'target merchant not found' });
  if (!merchant.shopify_domain || !merchant.shopify_access_token) {
    return res.status(400).json({ error: 'target merchant missing Shopify Admin API credentials — install Botiga app on the dev store first' });
  }

  // Validate source URL exposes /products.json
  let normalizedSource;
  try {
    normalizedSource = normalizeBase(source_url);
    const sample = await fetchProductsPage(normalizedSource, 1);
    if (!Array.isArray(sample)) throw new Error('source did not return product array');
  } catch (err) {
    return res.status(400).json({ error: `source unreachable: ${err.message}` });
  }

  // Mark target as a clone (idempotent)
  await supabase
    .from('merchants')
    .update({ kind: merchant.kind === 'production' ? 'clone' : merchant.kind, source_url: normalizedSource })
    .eq('id', target_merchant_id);

  const { data: job, error: jobErr } = await supabase
    .from('clone_jobs')
    .insert({
      merchant_id: target_merchant_id,
      source_url: normalizedSource,
      status: 'pending',
      current_phase: 'products',
      started_at: new Date().toISOString(),
      log: [{ ts: new Date().toISOString(), level: 'info', msg: `clone started: ${normalizedSource}` }],
    })
    .select()
    .single();
  if (jobErr) return res.status(500).json({ error: jobErr.message });
  res.json({ job_id: job.id, job });
});

// ─── Tick ───────────────────────────────────────────────────────────────────
router.post('/admin/clone/tick', async (req, res) => {
  const jobId = req.query.job_id || req.body?.job_id;
  if (!jobId) return res.status(400).json({ error: 'job_id required' });

  const { data: job, error: jobErr } = await supabase
    .from('clone_jobs')
    .select('*')
    .eq('id', jobId)
    .maybeSingle();
  if (jobErr) return res.status(500).json({ error: jobErr.message });
  if (!job) return res.status(404).json({ error: 'job not found' });
  if (job.status === 'done' || job.status === 'error') return res.json({ job, has_more: false });

  const { data: merchant } = await supabase
    .from('merchants')
    .select('id, shopify_domain, shopify_access_token, shopify_refresh_token, shopify_token_expires_at')
    .eq('id', job.merchant_id)
    .single();
  const accessToken = await getValidShopifyToken(merchant);
  const target = { shop: merchant.shopify_domain, accessToken };

  await supabase.from('clone_jobs').update({ status: 'running' }).eq('id', jobId);

  try {
    if (job.current_phase === 'products') {
      await tickProducts(job, target);
    } else if (job.current_phase === 'policies') {
      await tickPolicies(job, target);
    } else if (job.current_phase === 'pages') {
      await tickPages(job, target);
    }

    const { data: updated } = await supabase
      .from('clone_jobs')
      .select('*')
      .eq('id', jobId)
      .single();
    const has_more = updated.status !== 'done' && updated.status !== 'error';
    res.json({ job: updated, has_more });
  } catch (err) {
    console.error('[clone/tick] failed', err);
    await supabase
      .from('clone_jobs')
      .update({ status: 'error', last_error: String(err.message).slice(0, 500) })
      .eq('id', jobId);
    await appendLog(jobId, 'error', err.message);
    res.status(500).json({ error: err.message });
  }
});

async function tickProducts(job, target) {
  const page = await fetchProductsPage(job.source_url, job.products_page);
  if (page.length === 0) {
    // Catalog exhausted — move to policies
    await appendLog(job.id, 'info', `products done: imported ${job.products_imported}`);
    await supabase
      .from('clone_jobs')
      .update({ current_phase: 'policies', products_offset: 0 })
      .eq('id', job.id);
    return;
  }

  const slice = page.slice(job.products_offset, job.products_offset + PRODUCTS_PER_TICK);
  let imported = job.products_imported;
  let skipped = 0;

  for (const src of slice) {
    try {
      if (await productExists(target, src.handle)) {
        skipped++;
      } else {
        await createProduct(target, src);
        imported++;
      }
    } catch (err) {
      await appendLog(job.id, 'warn', `product ${src.handle} failed: ${err.message}`);
    }
    await sleep(RATE_LIMIT_MS);
  }

  const newOffset = job.products_offset + slice.length;
  const updates = { products_imported: imported };
  if (newOffset >= page.length) {
    // Page exhausted — advance
    updates.products_page = job.products_page + 1;
    updates.products_offset = 0;
    await appendLog(job.id, 'info', `page ${job.products_page}: imported ${imported - job.products_imported}, skipped ${skipped}`);
  } else {
    updates.products_offset = newOffset;
  }
  await supabase.from('clone_jobs').update(updates).eq('id', job.id);
}

async function tickPolicies(job, target) {
  let imported = job.policies_imported;
  for (const p of POLICY_SLUGS) {
    try {
      const fetched = await fetchPolicy(job.source_url, p.slug);
      if (fetched) {
        await updatePolicy(target, p.adminKey, fetched.html);
        imported++;
        await appendLog(job.id, 'info', `policy ${p.slug} updated`);
      } else {
        await appendLog(job.id, 'info', `policy ${p.slug} not found on source`);
      }
    } catch (err) {
      await appendLog(job.id, 'warn', `policy ${p.slug} failed: ${err.message}`);
    }
    await sleep(RATE_LIMIT_MS);
  }

  // Build the pages queue as we transition into the pages phase
  let pagesQueue = [];
  try {
    pagesQueue = await fetchPageUrls(job.source_url);
    await appendLog(job.id, 'info', `discovered ${pagesQueue.length} pages via sitemap`);
  } catch (err) {
    await appendLog(job.id, 'warn', `sitemap fetch failed: ${err.message}`);
  }

  await supabase
    .from('clone_jobs')
    .update({
      current_phase: 'pages',
      policies_imported: imported,
      pages_queue: pagesQueue,
      pages_offset: 0,
    })
    .eq('id', job.id);
}

async function tickPages(job, target) {
  const queue = job.pages_queue || [];
  const slice = queue.slice(job.pages_offset, job.pages_offset + PAGES_PER_TICK);
  let imported = job.pages_imported;

  for (const url of slice) {
    try {
      const page = await fetchPage(url);
      if (!page) {
        await appendLog(job.id, 'info', `page ${url} skipped (no body)`);
      } else if (await pageExists(target, page.handle)) {
        await appendLog(job.id, 'info', `page ${page.handle} already exists, skipping`);
      } else {
        await createPage(target, page);
        imported++;
        await appendLog(job.id, 'info', `page ${page.handle} created`);
      }
    } catch (err) {
      await appendLog(job.id, 'warn', `page ${url} failed: ${err.message}`);
    }
    await sleep(RATE_LIMIT_MS);
  }

  const newOffset = job.pages_offset + slice.length;
  if (newOffset >= queue.length) {
    // All done
    const finishedAt = new Date().toISOString();
    await supabase
      .from('clone_jobs')
      .update({
        current_phase: 'done',
        status: 'done',
        pages_imported: imported,
        pages_offset: newOffset,
        finished_at: finishedAt,
      })
      .eq('id', job.id);
    await supabase
      .from('merchants')
      .update({ cloned_at: finishedAt })
      .eq('id', job.merchant_id);
    await appendLog(job.id, 'info', `clone complete: ${job.products_imported} products, ${job.policies_imported} policies, ${imported} pages`);
  } else {
    await supabase
      .from('clone_jobs')
      .update({ pages_imported: imported, pages_offset: newOffset })
      .eq('id', job.id);
  }
}

// ─── Status (GET) ───────────────────────────────────────────────────────────
router.get('/admin/clone/status', async (req, res) => {
  const jobId = req.query.job_id;
  if (!jobId) return res.status(400).json({ error: 'job_id required' });
  const { data: job, error } = await supabase
    .from('clone_jobs')
    .select('*')
    .eq('id', jobId)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!job) return res.status(404).json({ error: 'job not found' });
  res.json({ job });
});

// ─── List jobs ──────────────────────────────────────────────────────────────
router.get('/admin/clone/jobs', async (req, res) => {
  const { data, error } = await supabase
    .from('clone_jobs')
    .select('id, merchant_id, source_url, status, current_phase, products_imported, policies_imported, pages_imported, started_at, finished_at, last_error, merchants(shopify_domain, kind)')
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ─── List eligible target merchants (clones + test stores) ─────────────────
router.get('/admin/clone/targets', async (req, res) => {
  const { data, error } = await supabase
    .from('merchants')
    .select('id, name, shopify_domain, kind, source_url, cloned_at')
    .in('kind', ['clone', 'test', 'production'])
    .not('shopify_access_token', 'is', null)
    .order('kind', { ascending: true })
    .order('shopify_domain', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

module.exports = router;
