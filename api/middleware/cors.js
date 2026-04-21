const cors = require('cors');

// Wide-open CORS for widget embedding — the widget needs to call the API from any merchant domain
const widgetCors = cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'OPTIONS'],
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
