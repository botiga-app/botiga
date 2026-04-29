#!/bin/bash
# One-shot script: update Vercel env vars, redeploy, alias.
# Usage: SHOPIFY_SECRET='<secret>' bash api/scripts/setup-managed-install.sh

set -e

if [ -z "$SHOPIFY_SECRET" ]; then
  echo "ERROR: Set SHOPIFY_SECRET env var first."
  echo "  Get it from: https://dev.shopify.com → Botiga AI Sales Assistant → Settings → click eye next to Secret"
  echo "  Then run: SHOPIFY_SECRET='<the_secret>' bash api/scripts/setup-managed-install.sh"
  exit 1
fi

CLIENT_ID="9024718457c9563257b14484174b9e32"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

echo "==> Removing old SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET from production..."
npx vercel env rm SHOPIFY_CLIENT_ID production -y 2>/dev/null || true
npx vercel env rm SHOPIFY_CLIENT_SECRET production -y 2>/dev/null || true

echo "==> Adding new SHOPIFY_CLIENT_ID..."
echo -n "$CLIENT_ID" | npx vercel env add SHOPIFY_CLIENT_ID production

echo "==> Adding new SHOPIFY_CLIENT_SECRET..."
echo -n "$SHOPIFY_SECRET" | npx vercel env add SHOPIFY_CLIENT_SECRET production

echo "==> Deploying..."
DEPLOY_URL=$(npx vercel --prod 2>&1 | grep -Eo 'https://botiga-[a-z0-9]+-themyrastudio-1009s-projects\.vercel\.app' | head -1)

if [ -z "$DEPLOY_URL" ]; then
  echo "ERROR: Could not parse deployment URL. Run npx vercel --prod manually."
  exit 1
fi

echo "==> Aliasing $DEPLOY_URL to botiga-api-two.vercel.app..."
npx vercel alias "$DEPLOY_URL" botiga-api-two.vercel.app

echo ""
echo "==> Done! Now open this URL in your browser (logged into botiga-6380's admin):"
echo ""
echo "    https://admin.shopify.com/store/botiga-6380/apps/$CLIENT_ID"
echo ""
echo "After it loads and shows 'Botiga installed' confirmation, run:"
echo ""
echo "    cd $ROOT/api && node -e \"require('dotenv').config(); const s=require('./lib/supabase'); const {upsertNegotiatedItem}=require('./services/draftOrder'); (async()=>{const {data:m}=await s.from('merchants').select('shopify_domain,shopify_access_token').limit(1).single(); console.log('Domain:',m.shopify_domain); try{const {data:n}=await s.from('negotiations').select('variant_id').not('variant_id','is',null).limit(1).single(); const r=await upsertNegotiatedItem({supabase:s,shop:m.shopify_domain,accessToken:m.shopify_access_token,sessionToken:'t-'+Date.now(),variantId:n.variant_id,negotiatedPrice:99}); console.log('Draft Order: SUCCESS',r.draftOrderId);}catch(e){console.log('Draft Order: FAIL',e.message);}})();\""
