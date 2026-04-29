const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');

const SHOPIFY_CLIENT_ID = process.env.SHOPIFY_CLIENT_ID;
const SHOPIFY_CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;

// Shopify managed install: when the app is installed/loaded, Shopify hits the App URL
// with id_token (JWT). We exchange that for an offline access token via Token Exchange API
// and store it in the merchants table.
router.get('/shopify/auth', async (req, res) => {
  const { id_token, shop, host, embedded } = req.query;

  if (!shop) {
    return res.status(400).send('Missing shop parameter. Open this from the Shopify admin.');
  }

  // No id_token → app is non-embedded, fall through to standard OAuth code grant.
  if (!id_token) {
    const SCOPES = 'write_price_rules,write_discounts,read_products,write_draft_orders';
    const redirectUri = 'https://botiga-api-two.vercel.app/api/shopify/callback';
    const authorizeUrl = `https://${shop}/admin/oauth/authorize?client_id=${SHOPIFY_CLIENT_ID}&scope=${encodeURIComponent(SCOPES)}&redirect_uri=${encodeURIComponent(redirectUri)}`;
    return res.redirect(authorizeUrl);
  }

  // Exchange id_token for offline access token
  try {
    const exchangeRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: SHOPIFY_CLIENT_ID,
        client_secret: SHOPIFY_CLIENT_SECRET,
        grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
        subject_token: id_token,
        subject_token_type: 'urn:ietf:params:oauth:token-type:id_token',
        requested_token_type: 'urn:shopify:params:oauth:token-type:offline-access-token'
      })
    });

    const data = await exchangeRes.json();
    if (!exchangeRes.ok || !data.access_token) {
      console.error('[TokenExchange] Failed:', exchangeRes.status, data);
      return res.status(500).send(`Token exchange failed: ${JSON.stringify(data)}`);
    }

    // Update merchant record — match by old jxavr1-ur first, fall back to first merchant
    let updated = await supabase
      .from('merchants')
      .update({ shopify_domain: shop, shopify_access_token: data.access_token })
      .eq('shopify_domain', 'jxavr1-ur.myshopify.com')
      .select('id, shopify_domain');

    if (!updated.data || !updated.data.length) {
      // Try matching by current shop domain
      updated = await supabase
        .from('merchants')
        .update({ shopify_domain: shop, shopify_access_token: data.access_token })
        .eq('shopify_domain', shop)
        .select('id, shopify_domain');
    }

    if (!updated.data || !updated.data.length) {
      // Fallback: update the first merchant
      const { data: first } = await supabase.from('merchants').select('id').limit(1).single();
      if (first) {
        await supabase
          .from('merchants')
          .update({ shopify_domain: shop, shopify_access_token: data.access_token })
          .eq('id', first.id);
      }
    }

    console.log('[TokenExchange] Stored offline token for', shop);

    return res.send(`
<!DOCTYPE html>
<html>
<head><title>Botiga — Installed</title></head>
<body style="font-family:system-ui;padding:60px;text-align:center;background:#f6f6f7">
  <div style="max-width:520px;margin:0 auto;background:#fff;padding:40px;border-radius:12px;box-shadow:0 1px 4px rgba(0,0,0,0.05)">
    <div style="font-size:48px;margin-bottom:16px">✅</div>
    <h2 style="color:#1a472a;margin:0 0 12px">Botiga installed for ${shop}</h2>
    <p style="color:#555;line-height:1.5">Access token has been stored. You can close this tab and continue using your store. The widget on your storefront will now use this token for negotiations and Draft Orders.</p>
  </div>
</body>
</html>
    `);
  } catch (err) {
    console.error('[TokenExchange] Error:', err);
    return res.status(500).send('Internal error during token exchange: ' + err.message);
  }
});

module.exports = router;
