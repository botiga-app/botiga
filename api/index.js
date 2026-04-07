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

app.use(express.json());

// Handle CORS preflight for all routes — must be before route definitions
const { widgetCors } = require('./middleware/cors');
app.options('*', widgetCors);

// Routes
app.use('/api', require('./routes/negotiate'));
app.use('/api', require('./routes/merchants'));
app.use('/api', require('./routes/deals'));
app.use('/api', require('./routes/recovery'));
app.use('/api', require('./routes/shopify-oauth'));
app.use('/api', require('./routes/cron'));
app.use('/api', require('./routes/admin'));

// Serve widget script — CORS open so any Shopify store can load it
app.get('/n.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-cache, no-store');
  res.sendFile(path.join(__dirname, '../widget/dist/n.js'));
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
