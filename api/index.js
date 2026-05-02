require('dotenv').config();
const express = require('express');
const path = require('path');
const { CronJob } = require('cron');
const { processRecoveryQueue } = require('./services/recovery');
const { generateAdminAlerts } = require('./services/alerts');

const app = express();

// Sentry v8 uses setupExpressErrorHandler, only if DSN is configured
if (process.env.SENTRY_DSN) {
  const Sentry = require('@sentry/node');
  Sentry.init({ dsn: process.env.SENTRY_DSN });
  Sentry.setupExpressErrorHandler(app);
}

// Webhooks must be mounted BEFORE express.json() — they need the raw body for HMAC verification
app.use('/', require('./routes/webhooks'));

// Twilio inbound webhook — Twilio posts application/x-www-form-urlencoded
// so it needs urlencoded() before json(), and signature validation happens inside the route
app.use('/api/inbound', express.urlencoded({ extended: false }));
app.use('/api', require('./routes/whatsapp-inbound'));

app.use(express.json());

// Handle CORS preflight for all routes — must be before route definitions
const { widgetCors } = require('./middleware/cors');
app.options('*', widgetCors);

// Routes
app.use('/api', require('./routes/negotiate'));
app.use('/api', require('./routes/draft-order'));
app.use('/api', require('./routes/merchants'));
app.use('/api', require('./routes/deals'));
app.use('/api', require('./routes/recovery'));
app.use('/api', require('./routes/shopify-oauth'));
app.use('/api', require('./routes/shopify-token-exchange'));
app.use('/api', require('./routes/rules'));
app.use('/api', require('./routes/billing'));
app.use('/api', require('./routes/cron'));
app.use('/api', require('./routes/admin'));
app.use('/api', require('./routes/videos'));
app.use('/api', require('./routes/marketplace'));
app.use('/api', require('./routes/shop'));
app.use('/api', require('./routes/clone'));
app.use('/api', require('./routes/admin-video-tagging'));
app.use('/api', require('./routes/script-tags').router);

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

// Fallback error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

// In-process crons only for local dev — on Vercel, crons are triggered via HTTP by vercel.json
if (!process.env.VERCEL) {
  new CronJob('*/15 * * * *', async () => {
    console.log('[Cron] Running recovery queue...');
    await processRecoveryQueue();
  }, null, true);

  new CronJob('0 * * * *', async () => {
    console.log('[Cron] Generating admin alerts...');
    await generateAdminAlerts();
  }, null, true);
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Botiga API running on port ${PORT}`));

module.exports = app;
