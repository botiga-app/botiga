const cors = require('cors');

// Wide-open CORS for widget embedding — the widget needs to call the API from any merchant domain.
// NOTE: this middleware also serves the global OPTIONS preflight (`app.options('*', widgetCors)`),
// so its methods list governs preflight responses for *every* route — including dashboard PATCH /
// DELETE calls. Keep PATCH + DELETE in here even though the widget itself doesn't use them, or the
// browser will block dashboard mutations with no visible error.
const widgetCors = cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: '*'
});

// Strict CORS for dashboard API calls
const dashboardOrigins = [
  process.env.DASHBOARD_URL || 'https://app.botiga.ai',
  'https://botiga-dashboard-gamma.vercel.app',
  'https://botiga-dashboard',   // matches any botiga-dashboard-*.vercel.app
  'http://localhost:3000',
  'http://localhost:3001',
  process.env.APP_URL
].filter(Boolean);

const dashboardCors = cors({
  origin: (origin, cb) => {
    // Allow no-origin requests (server-to-server, redirects, curl)
    if (!origin) return cb(null, true);
    if (dashboardOrigins.some(o => origin.startsWith(o))) return cb(null, true);
    cb(new Error('Not allowed by CORS'));
  },
  credentials: true
});

module.exports = { widgetCors, dashboardCors };
