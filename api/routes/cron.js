const express = require('express');
const router = express.Router();
const { processRecoveryQueue } = require('../services/recovery');
const { generateAdminAlerts } = require('../services/alerts');

// Vercel Cron sends Authorization: Bearer <CRON_SECRET>
function verifyCronSecret(req, res, next) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers['authorization'];
    if (auth !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }
  next();
}

router.get('/cron/recovery', verifyCronSecret, async (req, res) => {
  try {
    await processRecoveryQueue();
    res.json({ ok: true });
  } catch (err) {
    console.error('[Cron] Recovery queue error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/cron/alerts', verifyCronSecret, async (req, res) => {
  try {
    await generateAdminAlerts();
    res.json({ ok: true });
  } catch (err) {
    console.error('[Cron] Alerts error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
