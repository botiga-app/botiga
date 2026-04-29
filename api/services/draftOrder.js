const SHOPIFY_API_VERSION = '2024-01';

function shopifyHeaders(accessToken) {
  return {
    'Content-Type': 'application/json',
    'X-Shopify-Access-Token': accessToken
  };
}

async function shopifyFetch(shop, accessToken, method, path, body) {
  const url = `https://${shop}/admin/api/${SHOPIFY_API_VERSION}${path}`;
  const res = await fetch(url, {
    method,
    headers: shopifyHeaders(accessToken),
    body: body ? JSON.stringify(body) : undefined
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Shopify ${method} ${path} failed (${res.status}): ${txt.slice(0, 200)}`);
  }
  return res.json();
}

/**
 * Find the active draft order for a session by querying negotiations table.
 * Returns the Shopify draft order object, or null if none exists.
 */
async function getSessionDraftOrder(supabase, sessionToken, shop, accessToken) {
  if (!sessionToken) return null;

  const { data: rows } = await supabase
    .from('negotiations')
    .select('draft_order_id, draft_order_invoice_url')
    .eq('session_token', sessionToken)
    .not('draft_order_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1);

  if (!rows || !rows.length || !rows[0].draft_order_id) return null;

  try {
    const data = await shopifyFetch(shop, accessToken, 'GET', `/draft_orders/${rows[0].draft_order_id}.json`);
    const order = data.draft_order;
    // Discard completed/cancelled draft orders
    if (order.status === 'completed' || order.status === 'cancelled') return null;
    return order;
  } catch (err) {
    console.warn('[DraftOrder] Could not fetch existing draft order:', err.message);
    return null;
  }
}

/**
 * Create a brand-new draft order with one line item at the negotiated price.
 */
async function createDraftOrder({ shop, accessToken, sessionToken, variantId, quantity, negotiatedPrice }) {
  const data = await shopifyFetch(shop, accessToken, 'POST', '/draft_orders.json', {
    draft_order: {
      line_items: [{
        variant_id: parseInt(variantId, 10),
        quantity: quantity || 1,
        price: parseFloat(negotiatedPrice).toFixed(2)
      }],
      tags: 'botiga-negotiated',
      note: `Botiga negotiated session: ${sessionToken}`
    }
  });
  return data.draft_order;
}

/**
 * Add a new line item to an existing draft order.
 * If the same variant already exists, updates its price instead.
 */
async function addLineItemToDraftOrder({ shop, accessToken, draftOrderId, variantId, quantity, negotiatedPrice }) {
  // Fetch current line items
  const existing = await shopifyFetch(shop, accessToken, 'GET', `/draft_orders/${draftOrderId}.json`);
  const lineItems = existing.draft_order.line_items || [];

  const vid = parseInt(variantId, 10);
  const existingIdx = lineItems.findIndex(li => li.variant_id === vid);

  if (existingIdx >= 0) {
    // Update price on existing line item
    lineItems[existingIdx] = {
      ...lineItems[existingIdx],
      price: parseFloat(negotiatedPrice).toFixed(2),
      quantity: quantity || 1
    };
  } else {
    lineItems.push({
      variant_id: vid,
      quantity: quantity || 1,
      price: parseFloat(negotiatedPrice).toFixed(2)
    });
  }

  const data = await shopifyFetch(shop, accessToken, 'PUT', `/draft_orders/${draftOrderId}.json`, {
    draft_order: { line_items: lineItems }
  });
  return data.draft_order;
}

/**
 * Remove the line item matching `variantId` from a draft order.
 * If it was the last line item, deletes the whole draft order.
 * Returns the updated draft order, or null if it was deleted.
 *
 * Lookup is by variant_id (not line_item id) because we rebuild line items
 * on every upsert, which reissues line_item ids.
 */
async function removeLineItemFromDraftOrder({ shop, accessToken, draftOrderId, variantId }) {
  const existing = await shopifyFetch(shop, accessToken, 'GET', `/draft_orders/${draftOrderId}.json`);
  const lineItems = existing.draft_order.line_items || [];

  const vid = parseInt(variantId, 10);
  const remaining = lineItems
    .filter(li => li.variant_id !== vid)
    .map(li => ({
      variant_id: li.variant_id,
      quantity: li.quantity,
      price: li.price
    }));

  if (remaining.length === 0) {
    await shopifyFetch(shop, accessToken, 'DELETE', `/draft_orders/${draftOrderId}.json`);
    return null;
  }

  const data = await shopifyFetch(shop, accessToken, 'PUT', `/draft_orders/${draftOrderId}.json`, {
    draft_order: { line_items: remaining }
  });
  return data.draft_order;
}

/**
 * Create or update the session's draft order with a newly negotiated item.
 *
 * Rebuilds the entire line_items array from the negotiations table (status='won')
 * for this session_token, plus the item being upserted. We deliberately omit the
 * Shopify line_item `id` field so Shopify treats every line as new and honors the
 * `price` we send — keeping `id` causes Shopify to ignore custom prices on PUT
 * and revert to list price.
 *
 * Returns { draftOrder, draftOrderId, lineItemId, invoiceUrl }.
 */
async function upsertNegotiatedItem({ supabase, shop, accessToken, sessionToken, variantId, negotiatedPrice, listPrice }) {
  if (!shop || !accessToken) {
    throw new Error('Shopify credentials required for Draft Orders');
  }

  // Pull all prior wins for this session so they survive the rebuild
  const { data: priorWins } = await supabase
    .from('negotiations')
    .select('variant_id, deal_price, list_price')
    .eq('session_token', sessionToken)
    .eq('status', 'won')
    .not('variant_id', 'is', null)
    .not('deal_price', 'is', null);

  // Map of variant_id -> { deal, list }. The current upsert wins for its variant.
  const itemsByVariant = new Map();
  for (const w of (priorWins || [])) {
    const vid = parseInt(w.variant_id, 10);
    if (!Number.isFinite(vid)) continue;
    itemsByVariant.set(vid, {
      deal: parseFloat(w.deal_price),
      list: parseFloat(w.list_price || w.deal_price)
    });
  }
  itemsByVariant.set(parseInt(variantId, 10), {
    deal: parseFloat(negotiatedPrice),
    list: parseFloat(listPrice || negotiatedPrice)
  });

  // Build line_items using applied_discount (fixed_amount) — Shopify ignores
  // the `price` field on variant-backed draft order lines, but ALWAYS honors
  // applied_discount.value as a per-unit discount off the variant's list price.
  const lineItems = Array.from(itemsByVariant.entries()).map(([vid, p]) => {
    const discountValue = Math.max(0, p.list - p.deal);
    return {
      variant_id: vid,
      quantity: 1,
      applied_discount: {
        value_type: 'fixed_amount',
        value: discountValue.toFixed(2),
        amount: discountValue.toFixed(2),
        title: 'Botiga negotiated price',
        description: `Negotiated from $${p.list.toFixed(2)} to $${p.deal.toFixed(2)}`
      }
    };
  });

  const existing = await getSessionDraftOrder(supabase, sessionToken, shop, accessToken);

  const body = {
    draft_order: {
      line_items: lineItems,
      tags: 'botiga-negotiated',
      note: `Botiga negotiated session: ${sessionToken}`
    }
  };

  let draftOrder;
  if (existing) {
    const data = await shopifyFetch(shop, accessToken, 'PUT', `/draft_orders/${existing.id}.json`, body);
    draftOrder = data.draft_order;
  } else {
    const data = await shopifyFetch(shop, accessToken, 'POST', '/draft_orders.json', body);
    draftOrder = data.draft_order;
  }

  // Resolve the line item id we just added/updated by variant_id
  const vid = parseInt(variantId, 10);
  const lineItem = draftOrder.line_items.find(li => li.variant_id === vid);

  return {
    draftOrder,
    draftOrderId: String(draftOrder.id),
    lineItemId: lineItem ? String(lineItem.id) : null,
    invoiceUrl: draftOrder.invoice_url
  };
}

module.exports = {
  upsertNegotiatedItem,
  removeLineItemFromDraftOrder,
  getSessionDraftOrder
};
