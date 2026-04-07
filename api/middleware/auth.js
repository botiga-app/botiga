const supabase = require('../lib/supabase');

async function validateApiKey(req, res, next) {
  const apiKey = req.body.api_key || req.query.k || req.headers['x-api-key'];

  if (!apiKey) {
    return res.status(401).json({ error: 'Missing API key' });
  }

  const { data: merchant, error } = await supabase
    .from('merchants')
    .select('id, plan, trial_ends_at')
    .eq('api_key', apiKey)
    .single();

  if (error || !merchant) {
    return res.status(401).json({ error: 'Invalid API key' });
  }

  // Check trial expiry
  if (merchant.plan === 'trial' && new Date(merchant.trial_ends_at) < new Date()) {
    return res.status(402).json({ error: 'Trial expired. Please upgrade your plan.' });
  }

  req.merchant = merchant;
  next();
}

function validateAdminSecret(req, res, next) {
  const secret = req.headers['x-admin-secret'] || req.query.secret;
  if (secret !== process.env.ADMIN_SECRET) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
}

module.exports = { validateApiKey, validateAdminSecret };
