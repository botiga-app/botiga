const rateLimit = require('express-rate-limit');

// Per-merchant rate limit: 60 negotiation messages per minute
const negotiationLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  keyGenerator: (req) => req.body.api_key || req.ip,
  message: { error: 'Too many requests. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false
});

// Tighter limit for widget settings endpoint
const settingsLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  keyGenerator: (req) => req.query.k || req.ip,
  message: { error: 'Too many requests.' }
});

module.exports = { negotiationLimiter, settingsLimiter };
