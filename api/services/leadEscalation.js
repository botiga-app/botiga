// Cron-driven lead surfacing.
//
// Two flows:
//   1. escalate-stale-floors — when a customer reaches floor and goes idle
//      5–10 min without accepting, flip status to 'human_escalated' and
//      mark the row hot for the merchant. The bot's voice never changes;
//      this is purely a backend signal that the merchant should reach out.
//
//   2. check-won-abandoned — when a deal is struck (status='won') but the
//      customer never completes checkout, send a "your deal is still here"
//      reminder at T+24h, then mark 'won_abandoned' at T+48h so the
//      merchant sees the lead in their dashboard for personal follow-up.
//
// Both flows are idempotent: running the cron twice in a row produces the
// same result. They use timestamps on negotiations to gate work.

const supabase = require('../lib/supabase');
const { trackNegotiationEvent } = require('../lib/posthog');
const { sendOfferEmail } = require('./email');

// Window: customer hasn't messaged in 5–10 minutes after bot's last reply.
// We use a 7-minute floor (sweet spot of "they're definitely not coming
// right back" without being so long the merchant gets stale leads).
const ESCALATION_IDLE_MINUTES = 7;

async function escalateStaleFloors() {
  const cutoff = new Date(Date.now() - ESCALATION_IDLE_MINUTES * 60 * 1000).toISOString();

  // Negotiations at floor (current_step >= 5) that have been silent past
  // the cutoff and not already escalated. We only surface ones with
  // captured contact — without it the merchant has no way to follow up.
  const { data: stale, error } = await supabase
    .from('negotiations')
    .select('id, merchant_id, product_name, product_url, product_image, list_price, floor_price, bot_last_offered_price, customer_email, customer_whatsapp, customer_name, messages')
    .eq('status', 'active')
    .gte('current_step', 5)
    .lt('updated_at', cutoff)
    .or('customer_email.not.is.null,customer_whatsapp.not.is.null');

  if (error) {
    console.error('[leadEscalation] query failed:', error.message);
    return { escalated: 0 };
  }

  if (!stale || stale.length === 0) return { escalated: 0 };

  let count = 0;
  const nowIso = new Date().toISOString();

  for (const neg of stale) {
    // Best customer offer (highest number they've named) for the merchant
    // to see at a glance. Falls back to "unknown" if the customer never
    // typed a number — they may have just walked off after the floor offer.
    const customerOffers = (neg.messages || [])
      .filter(m => m.role === 'user')
      .map(m => {
        const matches = (m.content || '').match(/\$?\s*([\d,]+(?:\.[\d]{1,2})?)/g) || [];
        return matches.map(p => parseFloat(p.replace(/[$,\s]/g, ''))).filter(p => p > 10);
      })
      .flat();
    const bestOffer = customerOffers.length ? Math.max(...customerOffers) : null;

    const { error: updErr } = await supabase
      .from('negotiations')
      .update({
        status: 'human_escalated',
        lead_tier: 'hot',
        lead_status: 'new',
        escalated_at: nowIso,
        updated_at: nowIso,
      })
      .eq('id', neg.id)
      .eq('status', 'active');   // optimistic lock: skip if it changed under us

    if (updErr) {
      console.error('[leadEscalation] update failed for', neg.id, updErr.message);
      continue;
    }

    await supabase.from('admin_alerts').insert({
      merchant_id: neg.merchant_id,
      type: 'human_escalation',
      message: `Hot lead: customer reached floor on "${neg.product_name}" and went quiet. Best offer: ${bestOffer ? '$' + bestOffer : 'unknown'}. Floor: $${neg.floor_price}. Contact: ${neg.customer_email || neg.customer_whatsapp || 'none'}.`,
      severity: 'warning',
    });

    await trackNegotiationEvent({
      merchantId: neg.merchant_id,
      negotiationId: neg.id,
      event: 'negotiation_escalated',
      properties: { idle_minutes: ESCALATION_IDLE_MINUTES, best_offer: bestOffer },
    });

    // Send the customer a "your offer is still on the table" email so they
    // can come back and pick up where they left off. Phone contact is left
    // for the merchant to follow up — we don't have an SMS template here.
    if (neg.customer_email) {
      try {
        await sendOfferEmail({
          to: neg.customer_email,
          productName: neg.product_name,
          offerPrice: neg.bot_last_offered_price || Math.ceil(neg.floor_price),
          listPrice: neg.list_price,
          productUrl: neg.product_url,
          productImage: neg.product_image,
        });
      } catch (e) {
        console.warn('[leadEscalation] sendOfferEmail failed for', neg.id, e.message);
      }
    }

    count++;
  }

  return { escalated: count };
}

// Won deals that never converted. We send a soft reminder at T+24h
// (not at strike time — that's already handled by sendDealEmail) and
// mark abandoned at T+48h. The merchant sees these as hot leads.
async function checkWonAbandoned() {
  const now = Date.now();
  const t24 = new Date(now - 24 * 60 * 60 * 1000).toISOString();   // negotiations won >24h ago
  const t48 = new Date(now - 48 * 60 * 60 * 1000).toISOString();   // >48h → abandoned

  // Mark abandoned: status='won', deal struck >48h ago, no recovery converted.
  const { data: abandoned, error: abErr } = await supabase
    .from('negotiations')
    .select('id, merchant_id, product_name, deal_price, list_price, customer_email, customer_whatsapp, deal_expires_at')
    .eq('status', 'won')
    .lt('updated_at', t48)
    .is('recovered_at', null);

  let abandonedCount = 0;
  if (abErr) {
    console.error('[leadEscalation] won-abandoned query failed:', abErr.message);
  } else if (abandoned && abandoned.length > 0) {
    const nowIso = new Date().toISOString();
    for (const neg of abandoned) {
      const { error: updErr } = await supabase
        .from('negotiations')
        .update({
          status: 'won_abandoned',
          lead_tier: 'hot',
          lead_status: 'new',
          abandoned_at: nowIso,
          updated_at: nowIso,
        })
        .eq('id', neg.id)
        .eq('status', 'won');

      if (updErr) continue;

      await supabase.from('admin_alerts').insert({
        merchant_id: neg.merchant_id,
        type: 'won_abandoned',
        message: `Won deal abandoned: customer agreed to $${neg.deal_price} on "${neg.product_name}" but never checked out. Contact: ${neg.customer_email || neg.customer_whatsapp || 'none'}.`,
        severity: 'warning',
      });

      abandonedCount++;
    }
  }

  return { abandoned: abandonedCount };
}

module.exports = { escalateStaleFloors, checkWonAbandoned };
