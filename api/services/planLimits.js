// Plan tier gating for the leads dashboard.
//
// Only the leads page is gated today — everything else (negotiations,
// videos, settings) is unlimited regardless of plan. The reasoning:
// leads are the most direct revenue lever, so capping them at the
// free tier creates a clear upgrade pull without crippling the core
// product experience.
//
// merchants.plan is a free-form TEXT column. Valid values today:
//   'trial' | 'free' | 'starter' | 'pro' | 'white_label'
// 'trial' behaves as 'pro' until trial_ends_at; the resolver below
// downgrades a stale trial to 'free' automatically.

const PLAN_LIMITS = {
  free:     { hot: 5,        warm: 10,       cold: 20       },
  starter:  { hot: 25,       warm: 50,       cold: Infinity },
  pro:      { hot: Infinity, warm: Infinity, cold: Infinity },
  white_label: { hot: Infinity, warm: Infinity, cold: Infinity },
};

function resolvePlan(merchant) {
  if (!merchant) return 'free';
  const plan = merchant.plan || 'free';
  if (plan === 'trial') {
    const trialEnd = merchant.trial_ends_at ? new Date(merchant.trial_ends_at).getTime() : 0;
    if (trialEnd && trialEnd > Date.now()) return 'pro';
    return 'free';
  }
  return PLAN_LIMITS[plan] ? plan : 'free';
}

function getLimits(merchant) {
  const plan = resolvePlan(merchant);
  return { plan, ...PLAN_LIMITS[plan] };
}

// Numbers shown to merchants in upgrade copy. -1 sentinel for "no cap"
// so the UI can render "Unlimited" instead of Infinity.
function getLimitsForUI(merchant) {
  const { plan, hot, warm, cold } = getLimits(merchant);
  return {
    plan,
    hot:  hot  === Infinity ? -1 : hot,
    warm: warm === Infinity ? -1 : warm,
    cold: cold === Infinity ? -1 : cold,
  };
}

module.exports = { resolvePlan, getLimits, getLimitsForUI, PLAN_LIMITS };
