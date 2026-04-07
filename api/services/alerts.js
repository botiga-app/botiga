const supabase = require('../lib/supabase');

async function generateAdminAlerts() {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const { data: merchants } = await supabase
    .from('merchants')
    .select('id, name, plan, created_at');

  for (const merchant of (merchants || [])) {
    // Floor price breaches
    const { data: breaches } = await supabase
      .from('negotiations')
      .select('id, deal_price, floor_price')
      .eq('merchant_id', merchant.id)
      .eq('status', 'won')
      .filter('deal_price', 'lt', 'floor_price');

    for (const breach of (breaches || [])) {
      await insertAlertIfNew(merchant.id, 'floor_breach', `Floor price breached on negotiation ${breach.id}. Deal: $${breach.deal_price}, Floor: $${breach.floor_price}`, 'critical');
    }

    // LLM cost > 15% of revenue
    const { data: monthNegs } = await supabase
      .from('negotiations')
      .select('deal_price')
      .eq('merchant_id', merchant.id)
      .eq('status', 'won')
      .gte('created_at', monthAgo);

    const { data: llmCosts } = await supabase
      .from('llm_traces')
      .select('cost_usd')
      .eq('merchant_id', merchant.id)
      .gte('created_at', monthAgo);

    const revenue = (monthNegs || []).reduce((s, n) => s + (n.deal_price || 0), 0);
    const llmTotal = (llmCosts || []).reduce((s, t) => s + (t.cost_usd || 0), 0);

    if (revenue > 0 && llmTotal / revenue > 0.15) {
      await insertAlertIfNew(merchant.id, 'high_llm_cost', `LLM cost is ${Math.round(llmTotal / revenue * 100)}% of revenue this month ($${llmTotal.toFixed(4)} vs $${revenue.toFixed(2)})`, 'warning');
    }

    // 0 negotiations in 7 days (churn risk)
    const { data: recentNegs } = await supabase
      .from('negotiations')
      .select('id')
      .eq('merchant_id', merchant.id)
      .gte('created_at', sevenDaysAgo)
      .limit(1);

    if ((recentNegs || []).length === 0) {
      await insertAlertIfNew(merchant.id, 'churn_risk', `No negotiations in the last 7 days`, 'warning');
    }

    // New merchant with no first deal in 48h
    if (new Date(merchant.created_at) > new Date(fortyEightHoursAgo)) {
      const { data: anyNeg } = await supabase
        .from('negotiations')
        .select('id')
        .eq('merchant_id', merchant.id)
        .limit(1);

      if ((anyNeg || []).length === 0) {
        await insertAlertIfNew(merchant.id, 'idle', `New merchant installed but no negotiations started in 48h`, 'info');
      }
    }
  }
}

async function insertAlertIfNew(merchantId, type, message, severity) {
  // Don't duplicate unresolved alerts of same type
  const { data: existing } = await supabase
    .from('admin_alerts')
    .select('id')
    .eq('merchant_id', merchantId)
    .eq('type', type)
    .eq('resolved', false)
    .single();

  if (!existing) {
    await supabase.from('admin_alerts').insert({ merchant_id: merchantId, type, message, severity });
  }
}

module.exports = { generateAdminAlerts };
