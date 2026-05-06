require('dotenv').config();
const express = require('express');
const path = require('path');
const { CronJob } = require('cron');

const app = express();

// Track which modules failed to load so /debug can report them.
const moduleLoadErrors = [];

function safeRequire(label, requireFn) {
  try {
    return requireFn();
  } catch (err) {
    const msg = `[BOOT-ERR] failed to load ${label}: ${err.message}`;
    console.error(msg);
    console.error(err.stack);
    moduleLoadErrors.push({ label, error: err.message, stack: err.stack });
    return null;
  }
}

function safeMount(mountPath, label, requireFn) {
  const mod = safeRequire(label, requireFn);
  if (mod) app.use(mountPath, mod);
}

// Defer service requires that may fail at module load
const recoverySvc = safeRequire('services/recovery', () => require('./services/recovery'));
const alertsSvc = safeRequire('services/alerts', () => require('./services/alerts'));

// Sentry v8 uses setupExpressErrorHandler, only if DSN is configured
if (process.env.SENTRY_DSN) {
  try {
    const Sentry = require('@sentry/node');
    Sentry.init({ dsn: process.env.SENTRY_DSN });
    Sentry.setupExpressErrorHandler(app);
  } catch (err) {
    console.error('[BOOT-ERR] Sentry init failed:', err.message);
    moduleLoadErrors.push({ label: 'sentry', error: err.message });
  }
}

// Webhooks must be mounted BEFORE express.json() — they need the raw body for HMAC verification
safeMount('/', 'routes/webhooks', () => require('./routes/webhooks'));

// Twilio inbound webhook — Twilio posts application/x-www-form-urlencoded
// so it needs urlencoded() before json(), and signature validation happens inside the route
app.use('/api/inbound', express.urlencoded({ extended: false }));
safeMount('/api', 'routes/whatsapp-inbound', () => require('./routes/whatsapp-inbound'));

app.use(express.json());

// Handle CORS preflight for all routes — must be before route definitions
const corsMod = safeRequire('middleware/cors', () => require('./middleware/cors'));
if (corsMod) app.options('*', corsMod.widgetCors);

// Routes — wrap each so a single failing require() doesn't kill the whole API
safeMount('/api', 'routes/negotiate', () => require('./routes/negotiate'));
safeMount('/api', 'routes/concierge', () => require('./routes/concierge'));
safeMount('/api', 'routes/leads', () => require('./routes/leads'));
safeMount('/api', 'routes/draft-order', () => require('./routes/draft-order'));
safeMount('/api', 'routes/merchants', () => require('./routes/merchants'));
safeMount('/api', 'routes/deals', () => require('./routes/deals'));
safeMount('/api', 'routes/recovery', () => require('./routes/recovery'));
safeMount('/api', 'routes/shopify-oauth', () => require('./routes/shopify-oauth'));
safeMount('/api', 'routes/shopify-token-exchange', () => require('./routes/shopify-token-exchange'));
safeMount('/api', 'routes/rules', () => require('./routes/rules'));
safeMount('/api', 'routes/billing', () => require('./routes/billing'));
safeMount('/api', 'routes/cron', () => require('./routes/cron'));
safeMount('/api', 'routes/admin', () => require('./routes/admin'));
safeMount('/api', 'routes/videos', () => require('./routes/videos'));
safeMount('/api', 'routes/marketplace', () => require('./routes/marketplace'));
safeMount('/api', 'routes/shop', () => require('./routes/shop'));
safeMount('/api', 'routes/clone', () => require('./routes/clone'));
safeMount('/api', 'routes/admin-video-tagging', () => require('./routes/admin-video-tagging'));
safeMount('/api', 'routes/onboarding', () => require('./routes/onboarding'));
const scriptTagsMod = safeRequire('routes/script-tags', () => require('./routes/script-tags'));
if (scriptTagsMod?.router) app.use('/api', scriptTagsMod.router);

// Diagnostic endpoint — surfaces module-load errors so we can debug
// from outside even when individual routes are broken.
app.get('/debug/boot', (req, res) => {
  res.json({
    healthy: moduleLoadErrors.length === 0,
    error_count: moduleLoadErrors.length,
    errors: moduleLoadErrors,
    env_present: {
      SUPABASE_URL: !!process.env.SUPABASE_URL,
      SUPABASE_SERVICE_KEY: !!process.env.SUPABASE_SERVICE_KEY,
      GROQ_API_KEY: !!process.env.GROQ_API_KEY,
      SHOPIFY_CLIENT_ID: !!process.env.SHOPIFY_CLIENT_ID,
      SHOPIFY_CLIENT_SECRET: !!process.env.SHOPIFY_CLIENT_SECRET,
      ADMIN_SECRET: !!process.env.ADMIN_SECRET,
      RAPIDAPI_KEY: !!process.env.RAPIDAPI_KEY,
    },
  });
});

// Serve public assets (confetti.js etc) — CORS open for Shopify Script Tags
app.use('/public', (req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  next();
}, require('express').static(path.join(__dirname, 'public')));

// Serve widget script — CORS open so any Shopify store can load it.
// Source of truth lives in widget/dist/n.js; build copies into public/ so
// vercel.json's "includeFiles": ["public/**"] picks it up at deploy time.
app.get('/n.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-cache, no-store');
  res.sendFile(path.join(__dirname, 'public/n.js'));
});

// Serve shoppable video widget — CORS open so any Shopify store can load it
app.get('/video.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-cache, no-store');
  res.sendFile(path.join(__dirname, 'public/video.js'));
});

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', ts: Date.now() }));

// Defensive root handler for Shopify install redirects.
// Shopify's managed install flow can redirect merchants to the App URL
// after consent — and depending on how the App URL is configured in the
// Partner Dashboard, the path can resolve to "/" (root) instead of the
// expected "/api/shopify/auth". When that happens, forward the install
// query params (hmac, host, shop, id_token, etc.) to the proper handler
// so OAuth completes regardless of how the App URL got resolved.
app.get('/', (req, res) => {
  if (req.query.hmac || req.query.shop || req.query.id_token) {
    const qs = new URLSearchParams(req.query).toString();
    return res.redirect(`/api/shopify/auth${qs ? '?' + qs : ''}`);
  }
  // No Shopify params — root has no useful content; point at health
  res.redirect('/health');
});

// Fallback error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

// In-process crons only for local dev — on Vercel, crons are triggered via HTTP by vercel.json
if (!process.env.VERCEL) {
  if (recoverySvc?.processRecoveryQueue) {
    new CronJob('*/15 * * * *', async () => {
      console.log('[Cron] Running recovery queue...');
      await recoverySvc.processRecoveryQueue();
    }, null, true);
  }
  if (alertsSvc?.generateAdminAlerts) {
    new CronJob('0 * * * *', async () => {
      console.log('[Cron] Generating admin alerts...');
      await alertsSvc.generateAdminAlerts();
    }, null, true);
  }
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Botiga API running on port ${PORT}`));

module.exports = app;
