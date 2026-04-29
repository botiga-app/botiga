require('dotenv').config();
const supabase = require('../lib/supabase');
const { upsertNegotiatedItem } = require('../services/draftOrder');

(async () => {
  const token = process.env.SHOPIFY_TOKEN_BOTIGA_6380;
  const domain = 'botiga-6380.myshopify.com';
  if (!token) {
    console.error('Set SHOPIFY_TOKEN_BOTIGA_6380 in env first');
    process.exit(1);
  }

  const { data: m, error } = await supabase
    .from('merchants')
    .update({ shopify_domain: domain, shopify_access_token: token })
    .eq('shopify_domain', 'jxavr1-ur.myshopify.com')
    .select('id, shopify_domain')
    .single();

  if (error) { console.error('Update failed:', error.message); process.exit(1); }
  console.log('Merchant updated:', m.shopify_domain);

  console.log('\nTesting Draft Order creation...');
  try {
    const { data: n } = await supabase.from('negotiations').select('variant_id').not('variant_id','is',null).limit(1).single();
    const r = await upsertNegotiatedItem({
      supabase, shop: domain, accessToken: token,
      sessionToken: 'token-swap-test-' + Date.now(),
      variantId: n.variant_id, negotiatedPrice: 99
    });
    console.log('Draft Order created:', r.draftOrderId);
    console.log('Invoice URL:', r.invoiceUrl);
  } catch (e) {
    console.error('Draft Order failed:', e.message);
    process.exit(1);
  }

  console.log('\nAll set. Run a fresh negotiation in incognito.');
})();
