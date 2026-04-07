const supabase = require('../lib/supabase');

async function checkRepeatNegotiator(sessionId, merchantId) {
  const { data } = await supabase
    .from('negotiations')
    .select('id')
    .eq('session_id', sessionId)
    .eq('merchant_id', merchantId)
    .eq('status', 'won')
    .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());

  return data && data.length > 0;
}

module.exports = { checkRepeatNegotiator };
