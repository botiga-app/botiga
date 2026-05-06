const express = require('express');
const router = express.Router();
const { processRecoveryQueue } = require('../services/recovery');
const { generateAdminAlerts } = require('../services/alerts');
const { escalateStaleFloors, checkWonAbandoned } = require('../services/leadEscalation');

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

// Floor-idle escalation — every 5 min via Vercel Cron. Flips negotiations
// that reached floor and went quiet 7+ min into 'human_escalated' so the
// merchant sees them as hot leads.
router.get('/cron/escalate-floors', verifyCronSecret, async (req, res) => {
  try {
    const result = await escalateStaleFloors();
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[Cron] escalate-floors error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Won-but-not-checked-out — hourly via Vercel Cron. Flips status='won'
// rows older than 48h with no checkout to 'won_abandoned' so the
// merchant can follow up personally.
router.get('/cron/won-abandoned', verifyCronSecret, async (req, res) => {
  try {
    const result = await checkWonAbandoned();
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[Cron] won-abandoned error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
