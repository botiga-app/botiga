'use client';
import { useState } from 'react';

const ITEMS = [
  // ─── Shipped Apr 28–29, 2026 ──────────────────────────────────────────────
  { product: 'Shopify App', feature: 'Managed install via OAuth — write_draft_orders scope, token exchange', status: 'Shipped', size: 'L', impact: 'Distribution', origin: 'Discussed', notes: 'Shopify Dev Dashboard install: OAuth code-grant flow, scope approval, token persisted to merchants table; resolves 403 errors for draft order creation' },
  { product: 'Negotiation API', feature: 'Multi-item Draft Orders — one checkout, per-line-item negotiated prices', status: 'Shipped', size: 'L', impact: 'Conversion', origin: 'Discussed', notes: 'upsertNegotiatedItem rebuilds line_items from negotiations table per session_token; uses applied_discount (Shopify ignores price field on variant-backed lines); session_token shared across tabs via localStorage' },
  { product: 'Negotiation API', feature: 'Bot never offers below customer\'s stated counter', status: 'Shipped', size: 'S', impact: 'Conversion', origin: 'Discussed', notes: 'Guard added in negotiation.js after price ladder: if customerOffer >= floor, nextPrice = max(nextPrice, customerOffer). Stops the "user offered $180, bot accepted $175" bug.' },
  { product: 'Shopify Widget', feature: 'Cross-tab session via localStorage', status: 'Shipped', size: 'S', impact: 'Conversion', origin: 'Discussed', notes: 'Switched _botiga_sid + _botiga_session from sessionStorage to localStorage with 2h TTL so multi-tab negotiations share the same draft order' },
  { product: 'Shopify Widget', feature: '"Deal Done, Darling!" celebration gated on Checkout click', status: 'Shipped', size: 'S', impact: 'UX', origin: 'Discussed', notes: 'Per-deal lock-in shows just "Keep shopping / Checkout"; the big celebration only fires when the user explicitly chooses Checkout. No more interrupting multi-item flows.' },
  { product: 'Shopify Widget', feature: 'Per-deal Keep shopping / Checkout choice (replaces auto-redirect)', status: 'Shipped', size: 'M', impact: 'Conversion', origin: 'Discussed', notes: 'Both n.js modal and concierge negotiation modal end with two CTAs: Keep shopping (closes modal, hands off to concierge) or Checkout (celebration → Draft Order URL)' },
  { product: 'Shoppable Video', feature: 'Concierge negotiation modal mirrors n.js post-deal flow', status: 'Shipped', size: 'M', impact: 'UX', origin: 'Discussed', notes: 'Concierge "Push for a better price" path now matches the product-page n.js modal — same Keep shopping / Checkout buttons, same celebration, same Draft Order redirect' },
  { product: 'Shoppable Video', feature: 'Video feed pause + replay during shelf actions', status: 'Shipped', size: 'M', impact: 'UX', origin: 'Discussed', notes: 'Vertical swipe and active video pause when user taps Cart / Buy / Negotiate from a video shelf; video rewinds to time 0 and replays when modal closes or cart request resolves' },
  { product: 'Shoppable Video', feature: 'Cross-widget shared chat history (n.js ↔ concierge)', status: 'Shipped', size: 'M', impact: 'UX', origin: 'Discussed', notes: 'Both widgets write deal events to the same _btgv_chat_v2_ localStorage key. Concierge resumes the conversation from any prior surface — n.js negotiation, video scroll, anything.' },
  { product: 'Shoppable Video', feature: 'Deal-aware concierge greeting + chips ("Picking up where we left off")', status: 'Shipped', size: 'S', impact: 'UX', origin: 'Discussed', notes: 'Greeting references locked-in deals and total; chips become Checkout / Keep shopping instead of generic main menu' },
  { product: 'Shoppable Video', feature: 'Natural-language intents in concierge — "checkout" / "add to cart"', status: 'Shipped', size: 'S', impact: 'UX', origin: 'Discussed', notes: 'Typing "checkout", "buy now", "complete my purchase" → fires celebration → redirects to Draft Order URL. Typing "add to cart" → adds the page product or last-shown card.' },
  { product: 'Shoppable Video', feature: 'Proactive picks after "Keep shopping"', status: 'Shipped', size: 'M', impact: 'Conversion', origin: 'Discussed', notes: 'Concierge greets ("Nice grab!" / "Stacking up wins") and renders 6 curated picks prioritized by sale, filtered to exclude items already in cart and already negotiated' },
  { product: 'Shoppable Video', feature: 'Cart-page consolidated banner (replaces stacked banners)', status: 'Shipped', size: 'S', impact: 'UX', origin: 'Discussed', notes: 'One banner showing total: "🎁 N deals locked in — total $X · Checkout →" pointing at the latest Draft Order invoice URL. Single timer driven by soonest expiry.' },
  { product: 'Shoppable Video', feature: '"Similar items" excludes current product + cart items', status: 'Shipped', size: 'S', impact: 'UX', origin: 'Discussed', notes: '_btgvFilterShown helper fetches /cart.js, removes anything by handle/id matching the user\'s current product or items already in cart' },
  { product: 'Shoppable Video', feature: '"Show more products" — extract IDs from LLM text', status: 'Shipped', size: 'S', impact: 'UX', origin: 'Discussed', notes: 'Llama 3.1 dumped product names + [ID:xxx] in reply text instead of product_ids. Server now regex-extracts IDs and strips bullet/ID noise from reply.' },
  { product: 'Shoppable Video', feature: 'Product chip name fallback (catalog field "name")', status: 'Shipped', size: 'S', impact: 'UX', origin: 'Discussed', notes: 'Card renderer was checking p.product_name || p.title; chat-recommendation flow uses catalog.name. Added p.name to the fallback chain.' },
  { product: 'Email & Notifications', feature: 'Deal expiring recovery step (1h before deal_expires_at)', status: 'Shipped', size: 'M', impact: 'Recovery', origin: 'Discussed', notes: 'Coded but parked: queries won deals expiring within ~1h, checks Shopify draft order isn\'t already completed, sends WhatsApp + email reminder. Cron is daily on Vercel Hobby — needs Pro upgrade or external scheduler for 15-min cadence.' },
  { product: 'Infrastructure', feature: 'Vercel cron config + sync-widgets npm script', status: 'Shipped', size: 'S', impact: 'Operations', origin: 'Discussed', notes: 'vercel.json now declares /api/cron/recovery and /api/cron/alerts (daily — Hobby tier limit). api/package.json sync-widgets script copies widget/video.js + widget/dist/n.js into api/public/ before deploy.' },

  // Shoppable Video
  { product: 'Shoppable Video', feature: 'Stories widget — circular story bubbles, full-screen viewer', status: 'Shipped', size: 'L', impact: 'Core', origin: 'Discussed', notes: 'Instagram-style stories bar above the fold; tap to open full-screen viewer' },
  { product: 'Shoppable Video', feature: 'Carousel / Watch & Shop — horizontal scrollable video feed', status: 'Shipped', size: 'L', impact: 'Core', origin: 'Discussed', notes: '4-up grid on desktop, 2-up mobile; arrow nav; lazy load + autoplay' },
  { product: 'Shoppable Video', feature: 'In-video negotiation — full AI chat overlay inside video viewer', status: 'Shipped', size: 'L', impact: 'Conversion', origin: 'Discussed', notes: 'Tapping Negotiate opens the full negotiate panel on top of the video' },
  { product: 'Shoppable Video', feature: 'Product tagging — each video tagged to Shopify product', status: 'Shipped', size: 'M', impact: 'Core', origin: 'Discussed', notes: 'Merchant searches products in dashboard and tags to video; shows in feed shelf' },
  { product: 'Shoppable Video', feature: 'Email + WhatsApp capture inside video negotiation flow', status: 'Shipped', size: 'S', impact: 'Lead capture', origin: 'Discussed', notes: 'Email gate + WhatsApp field surfaces inside video negotiate panel' },
  { product: 'Shoppable Video', feature: 'Deal auto-redirect — won deal auto-navigates to cart after 2s', status: 'Shipped', size: 'S', impact: 'Conversion', origin: 'Discussed', notes: 'Celebration screen → /cart?discount=CODE after 2.2s' },
  { product: 'Shoppable Video', feature: 'Multi-deal cart banners — stacked banners per negotiated item', status: 'Shipped', size: 'S', impact: 'Conversion', origin: 'Discussed', notes: 'One banner per active deal on /cart; countdown timer per deal' },
  { product: 'Shoppable Video', feature: 'Deep linking — ?btgv=VIDEO_ID opens feed at specific video', status: 'Shipped', size: 'M', impact: 'UX', origin: 'Discussed', notes: 'URL param opens TikTok feed scrolled to that video on page load' },
  { product: 'Shoppable Video', feature: 'Deep linking — ?btgv=s:COL_ID opens story viewer directly', status: 'Shipped', size: 'M', impact: 'UX', origin: 'Discussed', notes: 'Story collection deep link; opens viewer and starts playback' },
  { product: 'Shoppable Video', feature: 'URL updates as feed scrolls (history.replaceState)', status: 'Shipped', size: 'S', impact: 'UX', origin: 'Discussed', notes: 'Browser URL reflects current video without a page reload' },
  { product: 'Shoppable Video', feature: 'Share button — copies video-specific URL', status: 'Shipped', size: 'S', impact: 'UX', origin: 'Discussed', notes: 'Uses navigator.share on mobile, clipboard fallback on desktop' },
  { product: 'Shoppable Video', feature: 'Product context fetch — bot references vendor/type/tags/description', status: 'Shipped', size: 'M', impact: 'Conversion', origin: 'Discussed', notes: 'Fetches /products/HANDLE.js; passes context to LLM before opening message' },
  { product: 'Shoppable Video', feature: 'Instagram import — merchant enters @handle, pulls recent videos', status: 'Shipped', size: 'M', impact: 'Merchant UX', origin: 'Discussed', notes: 'Uses instagram120 RapidAPI; merchant selects videos to import from thumbnail grid' },
  { product: 'Shoppable Video', feature: 'Product cards in video feed — mixed video + product slides', status: 'Shipped', size: 'M', impact: 'Conversion', origin: 'Discussed', notes: 'Extracts tagged products; interleaves 1 product card after every 3 videos in feed' },
  { product: 'Shoppable Video', feature: 'TikTok import — merchant enters @handle, pulls recent videos', status: 'Backlog', size: 'M', impact: 'Merchant UX', origin: 'Discussed', notes: 'Same flow as Instagram import; RapidAPI TikTok endpoint' },
  { product: 'Shoppable Video', feature: 'Phone / direct upload — upload MP4 from device', status: 'Backlog', size: 'S', impact: 'Merchant UX', origin: 'Discussed', notes: 'Manual upload fallback for non-social content' },
  { product: 'Shoppable Video', feature: 'Auto-sync — scheduled re-pull from Instagram/TikTok', status: 'Backlog', size: 'M', impact: 'Merchant UX', origin: 'Discussed', notes: 'New posts appear automatically without manual re-import' },
  { product: 'Shoppable Video', feature: 'AI product tagging — vision model auto-suggests products', status: 'Backlog', size: 'L', impact: 'DX', origin: 'Discussed', notes: 'Reduces manual tagging effort; merchant confirms suggestions' },
  { product: 'Shoppable Video', feature: 'Video analytics — views, clicks, negotiate rate, checkout rate', status: 'Backlog', size: 'M', impact: 'Analytics', origin: 'Suggested', notes: 'Per-video funnel to understand which content converts' },
  { product: 'Shoppable Video', feature: 'Video comments — customers comment on videos, merchant replies', status: 'Next', size: 'M', impact: 'Social', origin: 'Discussed', notes: 'Comment thread per video; merchant reply from dashboard; shown in widget' },
  { product: 'Shoppable Video', feature: 'Video reviews — star rating + text review on each shoppable video', status: 'Next', size: 'M', impact: 'Trust', origin: 'Discussed', notes: 'Post-purchase review prompt; avg rating shown on video card' },
  { product: 'Shoppable Video', feature: 'A/B testing for video placements', status: 'Later', size: 'M', impact: 'Optimization', origin: 'Suggested', notes: 'Test carousel vs. floating widget; compare conversion rate' },
  { product: 'Shoppable Video', feature: 'Meta retargeting — fire pixel events from video interactions', status: 'Later', size: 'M', impact: 'Marketing', origin: 'Suggested', notes: 'Retarget viewers who watched but did not buy' },
  // Shopify Widget
  { product: 'Shopify Widget', feature: 'Core widget embed — bubble + button modes', status: 'Shipped', size: 'M', impact: 'Core', origin: 'Discussed', notes: 'Injects into any Shopify theme via script tag' },
  { product: 'Shopify Widget', feature: 'Proactive chat open (dwell-time trigger)', status: 'Shipped', size: 'S', impact: 'Conversion', origin: 'Discussed', notes: 'Opens after N seconds of page idle' },
  { product: 'Shopify Widget', feature: 'Immediate open mode', status: 'Shipped', size: 'S', impact: 'Conversion', origin: 'Discussed', notes: 'Opens 600ms after page load' },
  { product: 'Shopify Widget', feature: 'On-click trigger mode', status: 'Shipped', size: 'S', impact: 'UX', origin: 'Discussed', notes: 'Only opens when customer clicks button' },
  { product: 'Shopify Widget', feature: 'Cart bundle negotiation', status: 'Shipped', size: 'M', impact: 'Conversion', origin: 'Discussed', notes: 'Detects cart page context; applies cart-specific discount rules' },
  { product: 'Shopify Widget', feature: 'Accept / counter chips after each bot offer', status: 'Shipped', size: 'S', impact: 'Conversion', origin: 'Discussed', notes: '[✓ Accept $X] and [Make a counter] appear after every bot price' },
  { product: 'Shopify Widget', feature: 'Email gate — blur-reveal private price', status: 'Shipped', size: 'S', impact: 'Lead capture', origin: 'Discussed', notes: 'Price blurred at 2px; email unlocks reveal; 🔒 private price copy' },
  { product: 'Shopify Widget', feature: 'WhatsApp / phone capture in email gate', status: 'Shipped', size: 'S', impact: 'Lead capture', origin: 'Discussed', notes: 'Second field below email: or send to WhatsApp' },
  { product: 'Shopify Widget', feature: 'Gradient color support for widget button', status: 'Shipped', size: 'S', impact: 'Merchant UX', origin: 'Discussed', notes: 'CSS linear-gradient support in widget settings' },
  { product: 'Shopify Widget', feature: 'Product-aware bot messages Phase 1 — vendor/type/tags/description', status: 'Shipped', size: 'M', impact: 'Conversion', origin: 'Discussed', notes: 'Widget fetches /products/HANDLE.js; bot references specific materials, style, origin' },
  { product: 'Shopify Widget', feature: 'Price-adaptive spread tiers — real ladders for low-price items', status: 'Shipped', size: 'M', impact: 'Conversion', origin: 'Discussed', notes: 'Tighter concession steps for <$50 items; wider for high-ticket' },
  { product: 'Shopify Widget', feature: 'Deal auto-redirect — won deal navigates to cart after 2s', status: 'Shipped', size: 'S', impact: 'Conversion', origin: 'Discussed', notes: 'Celebration screen → /cart?discount=CODE' },
  { product: 'Shopify Widget', feature: 'Cart discount applied automatically on redirect', status: 'Shipped', size: 'S', impact: 'Conversion', origin: 'Discussed', notes: 'Discount code appended to cart URL; auto-applies at checkout' },
  { product: 'Shopify Widget', feature: 'Product-aware bot messages — Phase 2 (inventory, reviews)', status: 'Backlog', size: 'M', impact: 'Conversion', origin: 'Suggested', notes: 'Pull Shopify reviews/metafields; surface social proof mid-negotiation' },
  { product: 'Shopify Widget', feature: 'Product-aware bot messages — Phase 3 (personalisation)', status: 'Backlog', size: 'L', impact: 'Conversion', origin: 'Suggested', notes: 'Dynamic justification library per product category' },
  { product: 'Shopify Widget', feature: 'Multi-language widget', status: 'Later', size: 'M', impact: 'Growth', origin: 'Suggested', notes: 'Auto-detect navigator.language; bot replies in customer language' },
  { product: 'Shopify Widget', feature: 'Voice negotiation (TTS bot replies)', status: 'Icebox', size: 'L', impact: 'Delight', origin: 'Suggested', notes: 'Widget speaks bot messages aloud' },
  { product: 'Shopify Widget', feature: 'Browser extension for non-Shopify stores', status: 'Icebox', size: 'L', impact: 'Growth', origin: 'Suggested', notes: 'WooCommerce, BigCommerce, etc.' },
  // Botiga Marketplace
  { product: 'Botiga Marketplace', feature: 'DB schema — customers, products, negotiations, messages, sponsored', status: 'Shipped', size: 'M', impact: 'Core', origin: 'Discussed', notes: 'Migrations 012–014; merchant_id and negotiation_id as UUID' },
  { product: 'Botiga Marketplace', feature: 'Product indexer — crawls /products.json per merchant, upserts catalog', status: 'Shipped', size: 'M', impact: 'Core', origin: 'Discussed', notes: 'Handles tags as array; no status filter; tsvector auto-updated' },
  { product: 'Botiga Marketplace', feature: 'Full-text search via tsvector + RPC function', status: 'Shipped', size: 'M', impact: 'Core', origin: 'Discussed', notes: 'marketplace_search() RPC with plainto_tsquery; bypasses Supabase JS client bugs' },
  { product: 'Botiga Marketplace', feature: 'NLP intent parsing — LLM extracts keywords, price range, style, occasion', status: 'Shipped', size: 'M', impact: 'Core', origin: 'Discussed', notes: 'Groq llama-3.3-70b; fallback to raw query on parse failure' },
  { product: 'Botiga Marketplace', feature: 'Marketplace negotiate API — start + message endpoints', status: 'Shipped', size: 'L', impact: 'Core', origin: 'Discussed', notes: 'Same pricing engine + bot as widget; merchant emailed on deal win' },
  { product: 'Botiga Marketplace', feature: 'Customer auth — signup/login/JWT', status: 'Shipped', size: 'M', impact: 'Core', origin: 'Discussed', notes: 'bcryptjs + jsonwebtoken; captures email + phone on signup' },
  { product: 'Botiga Marketplace', feature: 'Account orders page — deal history with checkout links', status: 'Shipped', size: 'M', impact: 'UX', origin: 'Discussed', notes: 'Customer sees all past deals; active deals show countdown' },
  { product: 'Botiga Marketplace', feature: 'Landing page — hero search + example chips + how it works', status: 'Shipped', size: 'M', impact: 'Growth', origin: 'Discussed', notes: 'NLP search bar front-and-center; chips for quick searches' },
  { product: 'Botiga Marketplace', feature: 'Search results grid — product cards with negotiate CTA', status: 'Shipped', size: 'M', impact: 'Core', origin: 'Discussed', notes: 'Grid with image, price, store name, Negotiate button' },
  { product: 'Botiga Marketplace', feature: 'Product detail page — image gallery, variants, negotiate modal', status: 'Shipped', size: 'M', impact: 'Core', origin: 'Discussed', notes: 'Full PDP with variant selector; negotiate modal inline' },
  { product: 'Botiga Marketplace', feature: 'Merchant email on deal win — product, customer contact, commission', status: 'Shipped', size: 'M', impact: 'Trust', origin: 'Discussed', notes: 'Merchant gets full customer contact + discount code + commission breakdown' },
  { product: 'Botiga Marketplace', feature: 'Sponsored placements schema + bidding table', status: 'Shipped', size: 'S', impact: 'Monetization', origin: 'Discussed', notes: 'Schema only; no UI yet' },
  { product: 'Botiga Marketplace', feature: 'Sponsored placements UI — merchant bids on keywords', status: 'Backlog', size: 'M', impact: 'Monetization', origin: 'Discussed', notes: 'Merchant dashboard tab to set bid per keyword' },
  { product: 'Botiga Marketplace', feature: 'Merchant self-onboarding to marketplace', status: 'Backlog', size: 'M', impact: 'Growth', origin: 'Suggested', notes: 'Merchant opts in, sets commission %, store is indexed automatically' },
  { product: 'Botiga Marketplace', feature: 'Multi-merchant indexer cron (auto re-index daily)', status: 'Backlog', size: 'S', impact: 'Operations', origin: 'Suggested', notes: 'Vercel cron job re-indexes all marketplace_active merchants nightly' },
  { product: 'Botiga Marketplace', feature: 'Customer wishlist / save for later', status: 'Backlog', size: 'S', impact: 'Engagement', origin: 'Suggested', notes: 'Heart icon on product card; saved to account' },
  { product: 'Botiga Marketplace', feature: 'Social proof — "X people negotiating this"', status: 'Later', size: 'S', impact: 'Conversion', origin: 'Suggested', notes: 'Live counter on product cards' },
  { product: 'Botiga Marketplace', feature: 'Recommendation engine — "you might also like"', status: 'Later', size: 'L', impact: 'Conversion', origin: 'Suggested', notes: 'Based on viewed + negotiated products' },
  // Merchant Dashboard
  { product: 'Merchant Dashboard', feature: 'Settings page — tone / discount % / floor price', status: 'Shipped', size: 'M', impact: 'Merchant UX', origin: 'Discussed', notes: 'Single-scroll settings with all widget + negotiation controls' },
  { product: 'Merchant Dashboard', feature: 'Floating save bar (Unsaved changes → Save / Discard)', status: 'Shipped', size: 'S', impact: 'Merchant UX', origin: 'Discussed', notes: 'Animated pill slides in on change; replaces auto-save' },
  { product: 'Merchant Dashboard', feature: 'Button label / color / text color controls', status: 'Shipped', size: 'S', impact: 'Merchant UX', origin: 'Discussed', notes: 'Merchant can brand the widget button' },
  { product: 'Merchant Dashboard', feature: 'Widget position selector', status: 'Shipped', size: 'S', impact: 'Merchant UX', origin: 'Discussed', notes: 'below-cart, floating, etc.' },
  { product: 'Merchant Dashboard', feature: 'Proactive message customization', status: 'Shipped', size: 'S', impact: 'Merchant UX', origin: 'Discussed', notes: 'Custom opener copy the bot uses on first message' },
  { product: 'Merchant Dashboard', feature: 'Cart-specific max discount setting', status: 'Shipped', size: 'S', impact: 'Conversion', origin: 'Discussed', notes: 'Separate discount cap for cart vs. product page' },
  { product: 'Merchant Dashboard', feature: 'Plan enforcement (free 50 / starter 500 monthly limit)', status: 'Shipped', size: 'S', impact: 'Monetization', origin: 'Discussed', notes: 'Returns 402 with upgrade URL when limit hit' },
  { product: 'Merchant Dashboard', feature: 'Negotiation history view', status: 'Shipped', size: 'M', impact: 'Analytics', origin: 'Discussed', notes: 'All negotiations with status, price, customer email' },
  { product: 'Merchant Dashboard', feature: 'Video widget management — upload, tag, reorder', status: 'Shipped', size: 'L', impact: 'Merchant UX', origin: 'Discussed', notes: 'Full video CRUD; product tagging; collection management' },
  { product: 'Merchant Dashboard', feature: 'Marketplace opt-in settings — discount %, commission, store name', status: 'Shipped', size: 'S', impact: 'Merchant UX', origin: 'Discussed', notes: 'Marketplace tab in settings; toggle marketplace_active' },
  { product: 'Merchant Dashboard', feature: 'Settings page — tabbed redesign', status: 'Backlog', size: 'M', impact: 'Merchant UX', origin: 'Suggested', notes: 'Split into Widget / Negotiation / Notifications / Billing tabs' },
  { product: 'Merchant Dashboard', feature: 'Live preview panel in settings', status: 'Backlog', size: 'M', impact: 'Merchant UX', origin: 'Suggested', notes: 'Right-side widget preview updates as settings change' },
  { product: 'Merchant Dashboard', feature: 'Per-product rules UI', status: 'Backlog', size: 'M', impact: 'Control', origin: 'Suggested', notes: 'Visual rule builder: product tag → max discount override' },
  { product: 'Merchant Dashboard', feature: 'Negotiation funnel chart', status: 'Backlog', size: 'M', impact: 'Analytics', origin: 'Suggested', notes: 'Opened → first offer → counter → deal vs. walk-away' },
  { product: 'Merchant Dashboard', feature: 'Revenue recovered KPI card', status: 'Backlog', size: 'S', impact: 'Analytics', origin: 'Suggested', notes: 'Deals closed × avg discount' },
  { product: 'Merchant Dashboard', feature: 'Per-product analytics', status: 'Backlog', size: 'M', impact: 'Analytics', origin: 'Suggested', notes: 'Which SKUs negotiate most; avg accepted discount' },
  { product: 'Merchant Dashboard', feature: 'A/B tone testing', status: 'Backlog', size: 'L', impact: 'Optimization', origin: 'Suggested', notes: 'Friendly vs. professional tone; compare close rate' },
  { product: 'Merchant Dashboard', feature: 'CSV export of captured leads', status: 'Backlog', size: 'S', impact: 'CRM', origin: 'Suggested', notes: 'Download all emails + deal details' },
  { product: 'Merchant Dashboard', feature: 'Real-time merchant notifications', status: 'Later', size: 'M', impact: 'Engagement', origin: 'Suggested', notes: 'Slack/email ping on deal close or high-value negotiation' },
  { product: 'Merchant Dashboard', feature: 'Negotiation replay viewer', status: 'Icebox', size: 'M', impact: 'Analytics', origin: 'Suggested', notes: 'Full conversation timeline in dashboard' },
  // Negotiation API
  { product: 'Negotiation API', feature: 'Core negotiate endpoint (POST /negotiate)', status: 'Shipped', size: 'L', impact: 'Core', origin: 'Discussed', notes: 'Full engine: ladder pricing + tone + LLM + Shopify discount creation' },
  { product: 'Negotiation API', feature: 'Price ladder engine — adaptive spread tiers by price point', status: 'Shipped', size: 'L', impact: 'Conversion', origin: 'Discussed', notes: '4-step concession ladder from list → floor; step unlocks per round' },
  { product: 'Negotiation API', feature: '4-moment deal screen (accepted state)', status: 'Shipped', size: 'M', impact: 'Conversion', origin: 'Discussed', notes: 'Checkout URL + discount code + expiry returned on deal close' },
  { product: 'Negotiation API', feature: 'Tone-matched human escalation', status: 'Shipped', size: 'M', impact: 'Trust', origin: 'Discussed', notes: 'Bot hands off gracefully when it can\'t go lower' },
  { product: 'Negotiation API', feature: 'Lead capture endpoint (PUT /negotiate/:id/contact)', status: 'Shipped', size: 'S', impact: 'Lead capture', origin: 'Discussed', notes: 'Saves email/phone to negotiation row after gate submit' },
  { product: 'Negotiation API', feature: 'Product eligibility check (GET /widget/product-rules)', status: 'Shipped', size: 'M', impact: 'Control', origin: 'Discussed', notes: 'Per-product rule resolution; tag-based overrides' },
  { product: 'Negotiation API', feature: 'Rate limiting', status: 'Shipped', size: 'S', impact: 'Stability', origin: 'Discussed', notes: 'Per-IP limits via express-rate-limit' },
  { product: 'Negotiation API', feature: 'API key auth middleware', status: 'Shipped', size: 'S', impact: 'Security', origin: 'Discussed', notes: 'Validates k= query param; core to multi-tenant design' },
  { product: 'Negotiation API', feature: 'CORS — wide-open for widget / strict for dashboard', status: 'Shipped', size: 'S', impact: 'Security', origin: 'Discussed', notes: 'PUT method included to prevent save errors' },
  { product: 'Negotiation API', feature: 'Returning customer recognition — bot greets by name, deeper floor for repeat buyers', status: 'Next', size: 'M', impact: 'Retention', origin: 'Discussed', notes: 'Match email from gate to past negotiations; unlock better concession tier' },
  { product: 'Negotiation API', feature: 'Loyalty tiers in bot — 1st / 3rd / 5th+ purchase = progressively better deal floors', status: 'Next', size: 'M', impact: 'Retention', origin: 'Discussed', notes: 'Count past won negotiations per email; adjust floor % accordingly' },
  { product: 'Negotiation API', feature: 'Counter-offer floor warnings', status: 'Backlog', size: 'S', impact: 'Conversion', origin: 'Suggested', notes: 'Bot signals final offer one step before hard floor' },
  { product: 'Negotiation API', feature: 'Escalation path tuning by product tag', status: 'Backlog', size: 'M', impact: 'Control', origin: 'Suggested', notes: 'slow-mover tag → bot concedes faster' },
  { product: 'Negotiation API', feature: 'Abandoned negotiation recovery email', status: 'Backlog', size: 'M', impact: 'Recovery', origin: 'Discussed', notes: 'Trigger if session drops after 2+ messages, no deal; "your offer is still on the table"' },
  { product: 'Negotiation API', feature: 'Exit-intent negotiate trigger', status: 'Backlog', size: 'S', impact: 'Conversion', origin: 'Discussed', notes: 'Widget fires when customer moves to close tab on product page' },
  { product: 'Negotiation API', feature: 'AI buyer persona detection', status: 'Later', size: 'L', impact: 'Conversion', origin: 'Suggested', notes: 'Detect price-sensitive vs. brand-loyal from tone; adapt concession speed' },
  // Customer Loyalty & Retention
  { product: 'Loyalty & Retention', feature: 'Returning customer recognition — bot greets by name, surfaces deal history', status: 'Next', size: 'M', impact: 'Retention', origin: 'Discussed', notes: 'Same email used before → bot opens with personalised greeting and better floor' },
  { product: 'Loyalty & Retention', feature: 'Loyalty tiers — 1st / 3rd / 5th+ purchase unlocks progressively better deal', status: 'Next', size: 'M', impact: 'Retention', origin: 'Discussed', notes: 'Tier based on won negotiation count per email across all merchants' },
  { product: 'Loyalty & Retention', feature: 'Win-back email — 30-day post-deal new arrivals + loyalty offer', status: 'Next', size: 'S', impact: 'Retention', origin: 'Discussed', notes: 'Triggered 30 days after last deal close if no return visit' },
  { product: 'Loyalty & Retention', feature: 'Abandoned negotiation recovery — "your offer is still on the table"', status: 'Backlog', size: 'M', impact: 'Recovery', origin: 'Discussed', notes: 'Email sent 2h after session drop with 2+ messages and no deal' },
  { product: 'Loyalty & Retention', feature: 'Exit-intent negotiate trigger — widget fires when customer moves to close tab', status: 'Backlog', size: 'S', impact: 'Conversion', origin: 'Discussed', notes: 'mouseleave on document fires a "Wait — want to make an offer?" prompt' },
  { product: 'Loyalty & Retention', feature: 'Customer profile page — deal history, saved items, loyalty tier', status: 'Backlog', size: 'M', impact: 'UX', origin: 'Suggested', notes: 'Accessible from widget after email capture; shows tier + past savings' },
  { product: 'Loyalty & Retention', feature: 'Post-purchase upsell — bot offers related product at negotiated price', status: 'Backlog', size: 'M', impact: 'AOV', origin: 'Suggested', notes: 'After checkout, redirect to a second product offer page' },
  { product: 'Loyalty & Retention', feature: 'Bundle negotiation — buy 2, negotiate the price', status: 'Backlog', size: 'M', impact: 'AOV', origin: 'Discussed', notes: 'Bot detects 2+ items in cart; offers bundle deal instead of per-item' },
  // Social Proof & Community
  { product: 'Social Proof', feature: 'Video comments — customers comment on shoppable videos, merchant replies', status: 'Next', size: 'M', impact: 'Social', origin: 'Discussed', notes: 'Comment thread per video; stored in DB; merchant replies from dashboard' },
  { product: 'Social Proof', feature: 'Video reviews — star rating + text review on each shoppable video', status: 'Next', size: 'M', impact: 'Trust', origin: 'Discussed', notes: 'Post-purchase review prompt; avg star rating shown on video card in carousel' },
  { product: 'Social Proof', feature: 'Product reviews on widget — star rating inside negotiate widget header', status: 'Next', size: 'S', impact: 'Trust', origin: 'Discussed', notes: 'Avg rating + review count shown in widget header; pulls from video reviews' },
  { product: 'Social Proof', feature: '"X people negotiating this" live counter on video/product', status: 'Backlog', size: 'S', impact: 'FOMO', origin: 'Discussed', notes: 'Active negotiation count per product in last 24h' },
  { product: 'Social Proof', feature: 'Deal ticker — "Maria from Austin just got 15% off this dress"', status: 'Backlog', size: 'S', impact: 'FOMO', origin: 'Suggested', notes: 'Scrolling ticker of recent deals; opt-in per merchant' },
  { product: 'Social Proof', feature: 'Review request post-deal — auto-ask for review after successful negotiation', status: 'Backlog', size: 'S', impact: 'Social proof', origin: 'Suggested', notes: 'Email sent 3 days after deal close; links back to video review form' },
  { product: 'Social Proof', feature: 'UGC reshare — flag customer-tagged posts for merchant to repost', status: 'Later', size: 'M', impact: 'Community', origin: 'Suggested', notes: 'Merchant marks customer Instagram posts for approval and repost' },
  // Share & Negotiate
  { product: 'Share & Negotiate', feature: 'Caption generator — paste product URL, get IG / TikTok / WhatsApp captions', status: 'Next', size: 'S', impact: 'Growth', origin: 'Discussed', notes: 'LLM generates platform-specific caption + hashtags from Shopify product data' },
  { product: 'Share & Negotiate', feature: 'Shareable product negotiate page — botiga.ai/p/[merchant]/[product]', status: 'Next', size: 'M', impact: 'Conversion', origin: 'Discussed', notes: 'Clean mobile landing page with product image, price, and Make an Offer CTA' },
  { product: 'Share & Negotiate', feature: 'Link-in-bio page — botiga.ai/shop/[merchant] showing all featured products', status: 'Next', size: 'S', impact: 'Growth', origin: 'Discussed', notes: 'Replaces Linktree; all featured products negotiate directly from the page' },
  // Email & Notifications
  { product: 'Email & Notifications', feature: 'Deal email — discount code + checkout link', status: 'Shipped', size: 'M', impact: 'Conversion', origin: 'Discussed', notes: 'Supports Resend, Gmail SMTP, AWS SES' },
  { product: 'Email & Notifications', feature: 'Marketplace merchant alert — customer contact + commission breakdown', status: 'Shipped', size: 'M', impact: 'Trust', origin: 'Discussed', notes: 'Merchant gets email on every marketplace deal win' },
  { product: 'Email & Notifications', feature: 'Win-back email — 30-day post-deal new arrivals + loyalty offer', status: 'Next', size: 'S', impact: 'Retention', origin: 'Discussed', notes: 'Triggered 30 days after last deal if no return visit detected' },
  { product: 'Email & Notifications', feature: 'Post-deal 24h follow-up email', status: 'Backlog', size: 'S', impact: 'Recovery', origin: 'Suggested', notes: 'If checkout URL unused after 24h; send urgency email' },
  { product: 'Email & Notifications', feature: 'Abandoned negotiation recovery email', status: 'Backlog', size: 'M', impact: 'Recovery', origin: 'Discussed', notes: 'Trigger if session drops after 2+ messages, no deal' },
  { product: 'Email & Notifications', feature: 'Klaviyo connector', status: 'Backlog', size: 'M', impact: 'CRM', origin: 'Suggested', notes: 'Push captured emails + deal status to Klaviyo list' },
  { product: 'Email & Notifications', feature: 'Postscript / SMSBump integration', status: 'Backlog', size: 'M', impact: 'CRM', origin: 'Suggested', notes: 'WhatsApp/SMS deal notifications' },
  { product: 'Email & Notifications', feature: 'Real-time merchant deal alerts (push/SMS)', status: 'Later', size: 'M', impact: 'Engagement', origin: 'Suggested', notes: 'Slack/email ping on deal close or high-value negotiation' },
  // Shopify App
  { product: 'Shopify App', feature: 'Script tag install via API key', status: 'Shipped', size: 'S', impact: 'Core', origin: 'Discussed', notes: 'Merchant pastes one script tag — no app required today' },
  { product: 'Shopify App', feature: 'Shopify Flow trigger on deal close', status: 'Backlog', size: 'M', impact: 'Integrations', origin: 'Suggested', notes: 'Merchant can wire up their own automations' },
  { product: 'Shopify App', feature: 'Shopify OAuth embedded app', status: 'Later', size: 'L', impact: 'Distribution', origin: 'Suggested', notes: 'Required for App Store listing' },
  { product: 'Shopify App', feature: 'Shopify Billing API integration', status: 'Later', size: 'M', impact: 'Monetization', origin: 'Suggested', notes: 'In-app subscription via Shopify Payments' },
  { product: 'Shopify App', feature: 'GDPR webhooks (customer/shop redact)', status: 'Later', size: 'M', impact: 'Compliance', origin: 'Suggested', notes: 'Required for App Store approval' },
  { product: 'Shopify App', feature: 'App Store submission & review', status: 'Later', size: 'L', impact: 'Distribution', origin: 'Suggested', notes: 'Design review, listing copy, screenshots' },
  // Admin Dashboard
  { product: 'Admin Dashboard', feature: 'Live negotiation feed — all active sessions, auto-refresh 5s', status: 'Shipped', size: 'M', impact: 'Operations', origin: 'Discussed', notes: 'Real-time view of every active negotiation across all merchants' },
  { product: 'Admin Dashboard', feature: 'Conversation replay per negotiation', status: 'Shipped', size: 'S', impact: 'Operations', origin: 'Discussed', notes: 'Expand any row to see full chat transcript' },
  { product: 'Admin Dashboard', feature: 'Floor risk flag (⚠ after 5+ turns)', status: 'Shipped', size: 'S', impact: 'Operations', origin: 'Suggested', notes: 'Highlights negotiations approaching floor price' },
  { product: 'Admin Dashboard', feature: 'All merchants — revenue / win rate / LLM cost / churn risk', status: 'Shipped', size: 'M', impact: 'Operations', origin: 'Discussed', notes: 'Full merchant health overview in one table' },
  { product: 'Admin Dashboard', feature: 'Merchant detail expand — tone / discount / floor / broker fee', status: 'Shipped', size: 'S', impact: 'Operations', origin: 'Discussed', notes: 'Click any merchant row to see their settings' },
  { product: 'Admin Dashboard', feature: 'Alerts — floor breach / high LLM cost / churn risk / idle', status: 'Shipped', size: 'M', impact: 'Operations', origin: 'Discussed', notes: 'Grouped by severity: critical / warning / info' },
  { product: 'Admin Dashboard', feature: 'Alert resolve action', status: 'Shipped', size: 'S', impact: 'Operations', origin: 'Discussed', notes: 'One-click resolve; dismissed from list' },
  { product: 'Admin Dashboard', feature: 'Roadmap kanban board', status: 'Shipped', size: 'M', impact: 'Internal', origin: 'Discussed', notes: 'Admin-only; Shipped/Next/Backlog/Later/Icebox columns' },
  { product: 'Admin Dashboard', feature: 'Marketplace commission dashboard', status: 'Backlog', size: 'M', impact: 'Operations', origin: 'Suggested', notes: 'Total commission earned; per-merchant breakdown; payout tracking' },
  // Infrastructure
  { product: 'Infrastructure', feature: 'Vercel deployment (API + dashboard + marketplace)', status: 'Shipped', size: 'S', impact: 'Core', origin: 'Discussed', notes: 'api: botiga-api-two.vercel.app; dashboard + marketplace on same org' },
  { product: 'Infrastructure', feature: 'Supabase (Postgres + auth)', status: 'Shipped', size: 'M', impact: 'Core', origin: 'Discussed', notes: 'Multi-tenant; per-merchant rows; RLS on all tables' },
  { product: 'Infrastructure', feature: 'DB migrations (001–014)', status: 'Shipped', size: 'S', impact: 'Core', origin: 'Discussed', notes: '014 makes s3_key nullable for social-imported videos' },
  { product: 'Infrastructure', feature: 'Merchant white-label', status: 'Later', size: 'M', impact: 'Revenue', origin: 'Suggested', notes: 'Custom sender domain; no Botiga branding; for higher tiers' },
  { product: 'Infrastructure', feature: 'Competitor price matching', status: 'Icebox', size: 'L', impact: 'Conversion', origin: 'Suggested', notes: 'Surface competitor prices mid-negotiation' },
];

const STATUSES = ['Shipped', 'Next', 'Backlog', 'Later', 'Icebox'];
const PRODUCTS = ['All', 'Shoppable Video', 'Shopify Widget', 'Botiga Marketplace', 'Merchant Dashboard', 'Negotiation API', 'Loyalty & Retention', 'Social Proof', 'Share & Negotiate', 'Email & Notifications', 'Admin Dashboard', 'Shopify App', 'Infrastructure'];
const ORIGINS = ['All', 'Discussed', 'Suggested'];

const STATUS_STYLE = {
  Shipped:  { bg: 'bg-emerald-50',  border: 'border-emerald-200', dot: 'bg-emerald-500',  label: 'text-emerald-700',  count: 'bg-emerald-100 text-emerald-700' },
  Next:     { bg: 'bg-indigo-50',   border: 'border-indigo-200',  dot: 'bg-indigo-500',   label: 'text-indigo-700',   count: 'bg-indigo-100 text-indigo-700'  },
  Backlog:  { bg: 'bg-gray-50',     border: 'border-gray-200',    dot: 'bg-gray-400',     label: 'text-gray-600',     count: 'bg-gray-100 text-gray-600'      },
  Later:    { bg: 'bg-amber-50',    border: 'border-amber-200',   dot: 'bg-amber-400',    label: 'text-amber-700',    count: 'bg-amber-100 text-amber-700'    },
  Icebox:   { bg: 'bg-slate-50',    border: 'border-slate-200',   dot: 'bg-slate-400',    label: 'text-slate-600',    count: 'bg-slate-100 text-slate-600'    },
};

const PRODUCT_COLORS = {
  'Shoppable Video':     'bg-rose-100 text-rose-700',
  'Shopify Widget':      'bg-violet-100 text-violet-700',
  'Botiga Marketplace':  'bg-cyan-100 text-cyan-700',
  'Merchant Dashboard':  'bg-blue-100 text-blue-700',
  'Negotiation API':     'bg-orange-100 text-orange-700',
  'Loyalty & Retention': 'bg-teal-100 text-teal-700',
  'Social Proof':        'bg-fuchsia-100 text-fuchsia-700',
  'Share & Negotiate':   'bg-lime-100 text-lime-700',
  'Email & Notifications': 'bg-pink-100 text-pink-700',
  'Admin Dashboard':     'bg-red-100 text-red-700',
  'Shopify App':         'bg-green-100 text-green-700',
  'Infrastructure':      'bg-gray-100 text-gray-600',
};

const SIZE_LABEL = { S: 'Small', M: 'Medium', L: 'Large' };

function Card({ item, onClick, selected }) {
  const s = STATUS_STYLE[item.status];
  return (
    <div
      onClick={() => onClick(item)}
      className={`bg-white rounded-xl border cursor-pointer transition-all duration-150 p-4 hover:shadow-md hover:-translate-y-0.5 ${
        selected ? 'ring-2 ring-indigo-400 border-indigo-200' : 'border-gray-100'
      }`}
    >
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <p className="text-sm font-medium text-gray-900 leading-snug">{item.feature}</p>
        <span className="text-xs text-gray-400 shrink-0 font-mono">{item.size}</span>
      </div>
      {item.notes && (
        <p className="text-xs text-gray-400 mb-2 leading-relaxed line-clamp-2">{item.notes}</p>
      )}
      {item.note && (
        <div className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-2.5 py-1.5 mb-2 leading-relaxed">
          📌 {item.note}
        </div>
      )}
      <div className="flex flex-wrap gap-1.5 mt-2">
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${PRODUCT_COLORS[item.product]}`}>
          {item.product}
        </span>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
          item.origin === 'Discussed' ? 'bg-indigo-50 text-indigo-600' : 'bg-gray-50 text-gray-500'
        }`}>
          {item.origin === 'Discussed' ? '💬 You' : '🤖 Claude'}
        </span>
        <span className="text-xs px-2 py-0.5 rounded-full bg-gray-50 text-gray-500">
          {item.impact}
        </span>
      </div>
    </div>
  );
}

function DetailPanel({ item, onClose, notes, setNotes }) {
  if (!item) return null;
  const s = STATUS_STYLE[item.status];
  const note = notes[item.feature] ?? item.note ?? '';
  return (
    <div className="fixed inset-y-0 right-0 w-96 bg-white border-l border-gray-100 shadow-xl z-50 flex flex-col">
      <div className="flex items-center justify-between p-5 border-b border-gray-100">
        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${s.count}`}>
          {item.status}
        </span>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
      </div>
      <div className="flex-1 overflow-auto p-5 space-y-5">
        <div>
          <h2 className="text-lg font-bold text-gray-900 leading-snug">{item.feature}</h2>
          <p className="text-sm text-gray-500 mt-1">{item.notes}</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {[
            ['Product', item.product],
            ['Effort', SIZE_LABEL[item.size]],
            ['Impact', item.impact],
            ['Origin', item.origin === 'Discussed' ? '💬 You requested' : '🤖 Claude suggested'],
          ].map(([label, val]) => (
            <div key={label} className="bg-gray-50 rounded-lg p-3">
              <p className="text-xs text-gray-400 mb-0.5">{label}</p>
              <p className="text-sm font-medium text-gray-800">{val}</p>
            </div>
          ))}
        </div>
        <div>
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-2">📌 Note</label>
          <textarea
            value={note}
            onChange={e => setNotes(prev => ({ ...prev, [item.feature]: e.target.value }))}
            placeholder="Add a private note — context, blockers, who owns this..."
            rows={4}
            className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-none text-gray-800 placeholder-gray-300"
          />
          {note && (
            <p className="text-xs text-gray-400 mt-1">Notes are saved for this session.</p>
          )}
        </div>
      </div>
    </div>
  );
}

export default function RoadmapPage() {
  const [productFilter, setProductFilter] = useState('All');
  const [originFilter, setOriginFilter] = useState('All');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);
  const [notes, setNotes] = useState({});

  const filtered = ITEMS.filter(item => {
    if (productFilter !== 'All' && item.product !== productFilter) return false;
    if (originFilter !== 'All' && item.origin !== originFilter) return false;
    if (search && !item.feature.toLowerCase().includes(search.toLowerCase()) && !item.notes.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const byStatus = STATUSES.reduce((acc, s) => {
    acc[s] = filtered.filter(i => i.status === s);
    return acc;
  }, {});

  const shippedCount = ITEMS.filter(i => i.status === 'Shipped').length;
  const nextCount = ITEMS.filter(i => i.status === 'Next').length;
  const totalCount = ITEMS.length;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-100 px-8 py-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Product Roadmap</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {shippedCount} shipped · {nextCount} up next · {totalCount} total
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400">Last updated Apr 29, 2026</span>
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3 flex-wrap">
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search features..."
            className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 w-52 focus:outline-none focus:ring-2 focus:ring-indigo-300"
          />

          <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
            {['All', 'Discussed', 'Suggested'].map(o => (
              <button
                key={o}
                onClick={() => setOriginFilter(o)}
                className={`text-xs px-3 py-1 rounded-md transition-colors ${
                  originFilter === o ? 'bg-white text-gray-900 shadow-sm font-medium' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {o === 'Discussed' ? '💬 You' : o === 'Suggested' ? '🤖 Claude' : 'All'}
              </button>
            ))}
          </div>

          <select
            value={productFilter}
            onChange={e => setProductFilter(e.target.value)}
            className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300"
          >
            {PRODUCTS.map(p => <option key={p}>{p}</option>)}
          </select>
        </div>
      </div>

      {/* Kanban board */}
      <div className="p-6 overflow-x-auto">
        <div className="flex gap-4 min-w-max">
          {STATUSES.map(status => {
            const s = STATUS_STYLE[status];
            const items = byStatus[status];
            return (
              <div key={status} className="w-72 flex flex-col">
                {/* Column header */}
                <div className={`flex items-center gap-2 px-3 py-2.5 rounded-xl mb-3 border ${s.bg} ${s.border}`}>
                  <span className={`w-2 h-2 rounded-full ${s.dot}`} />
                  <span className={`text-sm font-semibold ${s.label}`}>{status}</span>
                  <span className={`ml-auto text-xs font-medium px-1.5 py-0.5 rounded-full ${s.count}`}>
                    {items.length}
                  </span>
                </div>

                {/* Cards */}
                <div className="space-y-2.5 flex-1">
                  {items.length === 0 ? (
                    <div className="text-center text-xs text-gray-400 py-8">Nothing here</div>
                  ) : (
                    items.map((item, i) => (
                      <Card
                        key={i}
                        item={{...item, note: notes[item.feature] ?? item.note}}
                        onClick={setSelected}
                        selected={selected?.feature === item.feature}
                      />
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Detail panel */}
      {selected && (
        <>
          <div className="fixed inset-0 bg-black/10 z-40" onClick={() => setSelected(null)} />
          <DetailPanel item={selected} onClose={() => setSelected(null)} notes={notes} setNotes={setNotes} />
        </>
      )}
    </div>
  );
}
