const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const { widgetCors } = require('../middleware/cors');
const { removeLineItemFromDraftOrder } = require('../services/draftOrder');
const { getValidShopifyToken } = require('../lib/shopifyToken');

// Remove a single negotiated line item from the session's draft order.
// Widget calls this when the shopper removes an item from their negotiated cart.
// Auth: negotiation_id is the token — no API key needed (same pattern as /contact).
router.delete('/draft-order/line-item', widgetCors, async (req, res) => {
  const { negotiation_id } = req.body;
  if (!negotiation_id) return res.status(400).json({ error: 'negotiation_id required' });

  // Load the negotiation to get draft order details and merchant credentials
  const { data: neg, error: negErr } = await supabase
    .from('negotiations')
    .select('id, draft_order_id, variant_id, merchant_id, status')
    .eq('id', negotiation_id)
    .single();

  if (negErr || !neg) return res.status(404).json({ error: 'Negotiation not found' });
  if (!neg.draft_order_id) return res.status(400).json({ error: 'No draft order on this negotiation' });
  if (!neg.variant_id) return res.status(400).json({ error: 'Negotiation has no variant_id' });

  // Get merchant Shopify credentials
  const { data: merchant } = await supabase
    .from('merchants')
    .select('id, shopify_domain, shopify_access_token, shopify_refresh_token, shopify_token_expires_at')
    .eq('id', neg.merchant_id)
    .single();

  if (!merchant?.shopify_domain || !merchant?.shopify_access_token) {
    return res.status(400).json({ error: 'Merchant Shopify credentials not configured' });
  }

  try {
    const accessToken = await getValidShopifyToken(merchant);
    const updated = await removeLineItemFromDraftOrder({
      shop: merchant.shopify_domain,
      accessToken,
      draftOrderId: neg.draft_order_id,
      variantId: neg.variant_id
    });

    // Mark this negotiation as item_removed
    await supabase
      .from('negotiations')
      .update({ status: 'item_removed', updated_at: new Date().toISOString() })
      .eq('id', negotiation_id);

    // If draft order was fully deleted (no items left), update invoice URL
    const invoiceUrl = updated ? updated.invoice_url : null;
    if (updated) {
      await supabase
        .from('negotiations')
        .update({ draft_order_invoice_url: invoiceUrl })
        .eq('draft_order_id', neg.draft_order_id);
    }

    res.json({
      ok: true,
      draft_order_deleted: !updated,
      invoice_url: invoiceUrl
    });
  } catch (err) {
    console.error('[DraftOrder] Remove line item failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Get the current draft order state for a session (widget polls this to sync cart)
router.get('/draft-order/session', widgetCors, async (req, res) => {
  const { session_token } = req.query;
  if (!session_token) return res.status(400).json({ error: 'session_token required' });

  const { data: rows } = await supabase
    .from('negotiations')
    .select('id, product_name, list_price, deal_price, draft_order_id, draft_order_line_item_id, draft_order_invoice_url, status, variant_id')
    .eq('session_token', session_token)
    .in('status', ['won'])
    .not('draft_order_id', 'is', null)
    .order('created_at', { ascending: true });

  if (!rows || !rows.length) return res.json({ deals: [], invoice_url: null });

  res.json({
    deals: rows.map(r => ({
      negotiation_id: r.id,
      product_name: r.product_name,
      list_price: r.list_price,
      deal_price: r.deal_price,
      draft_order_line_item_id: r.draft_order_line_item_id,
      draft_order_invoice_url: r.draft_order_invoice_url
    })),
    invoice_url: rows[rows.length - 1].draft_order_invoice_url
  });
});

module.exports = router;
