# Botiga Roadmap

Organized by product area. Status: **Shipped** · **Next** · **Backlog** · **Later** · **Icebox**
Origin: **Discussed** = user requested or reported · **Suggested** = Claude proposed

---

## Strategic Pillars

> Three product pillars frame the build. Each pillar maps to one or more detailed sections further down. Use this as the strategic-priority view; use the per-section tables for execution detail.

### Pillar 1 — Concierge

> Proactive AI rep that greets shoppers, qualifies intent, and routes to the right tool (video / negotiate / search). The unifying surface — every other capability lives behind it.

**Status: ~45% built (substrate + persona, brain still missing)**

- ✅ Widget shell, proactive open trigger, button + bubble modes — see *Shopify Widget*
- ✅ Product context fetch + lead capture
- ✅ `storeContext` service — bot reads live collections, active promos, and brand voice from any public Shopify storefront. Same path works for clone targets and real merchants.
- ✅ Bot persona (name + avatar + greeting) — set during onboarding, persisted to `merchant_settings`
- ❌ Intent classification (just-browsing / compare / haggle / support)
- ❌ 3-path routing UI — chips that hand off to video / negotiate / search
- ❌ Returning customer recognition + loyalty tiers (also feeds Pillar 2)
- ❌ Behavioral triggers beyond dwell-time (scroll depth, exit-intent, cart value)
- ❌ **Brand-story auto-write** — scrape About Us / IG bio / FB about page → distill into a brand-voice paragraph the concierge bot uses when greeting / answering. Today the merchant has to write this manually if they want it.

**Critical next:** Concierge V1 — proactive pop-up + 3 intent chips + routing. Listed in *What to Build Next → Tier 1*.

---

### Pillar 2 — Negotiation Engine

> Customer makes an offer, AI counter-offers along an adaptive price ladder until deal or floor. Most mature pillar.

**Status: ~85% built**

- ✅ Core `POST /negotiate`, price ladder, 4-moment deal screen — see *Negotiation API*
- ✅ Adaptive spread tiers by price point, tone-matched escalation
- ✅ Lead capture, recovery flow, cart bundle negotiation, per-product rules
- ✅ Plan enforcement, rate limiting, API key auth
- ✅ Shopify expiring offline tokens + refresh-on-use helper (May 2026 — required by Shopify deprecation of non-expiring tokens)
- ❌ **Full-price justifications** — 3-5 merchant-supplied (or auto-distilled from About Us / IG) reasons the bot uses to defend price during haggling. e.g. "I can do $199 — hand-finished by artisans, not mass produced." Today the bot only has tone + ladder; no narrative anchor for *why* the price holds.
- ❌ Returning customer recognition + loyalty tiers (Next — see *Customer Loyalty & Retention*)
- ❌ Counter-offer floor warnings, exit-intent trigger
- ❌ Klaviyo / Postscript connectors

**Critical next:** Loyalty / returning customer recognition.

---

### Pillar 3 — Content Engine

> Merchant gives Botiga a video / IG handle / WhatsApp message — Botiga creates Shopify products and shoppable videos automatically. Zero manual tagging.

**Status: ~70% surface, ~50% brain**

- ✅ Shoppable video viewer — stories, carousel, feed, deep links, multi-deal banners — see *Shoppable Video*
- ✅ Instagram import — merchant enters @handle, pulls recent videos + photos (capped 20 during demo)
- ✅ Manual product tagging, in-video negotiation overlay
- ✅ AI video analysis — Groq Llama 4 Scout vision on frames + caption → product candidates with confidence
- ✅ Auto-tag with confidence thresholds: ≥0.5 auto / 0.3-0.5 pending review / <0.3 skip
- ✅ AI Tag drawer — multi-product cards, inline price + sizes, accept-tag emerald flash
- ✅ AI Product Create — builds Shopify draft with variants from analyzer output
- ✅ Public preview at `/preview/[merchantId]` — TikTok-style vertical feed, brand-gradient action buttons, deep-link via `?btgv=`
- ✅ Floating Feed widget — auto-provisioned in onboarding, populated with merchant's videos
- ✅ Background auto-tag continuation — videos page silently finishes any unanalyzed videos in 5-chunks
- ⚠️ Plumbing built but uncommitted (in working tree): WhatsApp inbound webhook, transcribe, image→video, messenger, catalog match, Shopify resolve
- ❌ WhatsApp video → product create (commit + wire the plumbing above)
- ❌ Proactive Agent — IG auto-poll + UNDO window (see *Proactive Agent*)
- ❌ TikTok import, auto-sync, phone upload

**Critical next:** WhatsApp video → product create (Phase 3) + Proactive Agent (IG auto-poll + UNDO).

---

### Cross-pillar infrastructure (shipped)

These don't belong to one pillar — they unblock or power multiple:

- **Clone tool** (`/admin/clone`) — writes a real public storefront's catalog + policies + pages into a dev store for eval testing
- **`storeContext` service** — live read of any public storefront's collections / banners / about content (powers Pillar 1 awareness)
- **Shopify expiring offline tokens + refresh helper** — unblocks Pillars 2 and 3 from May 2026 Shopify deprecation
- **4-step onboarding wizard** — URL → Install → Bot persona → TurboTax-style live progress (auto-fires bot setup, IG pull, auto-tag chunks, Floating Feed reseed, defaults). Under 2 min target.
- **`POST /onboarding/auto-setup`** — idempotent setup endpoint: provisions Floating Feed widget + populates with active videos + applies concierge defaults
- **Defensive module loading** — `safeRequire` / `safeMount` in api/index.js so missing files don't 500 the whole API

---

## Proactive Agent

> The agent's job is to make sure that when a merchant uploads a video on Instagram (or as a habit), it shows up on their store as a tagged shop video — without the merchant having to remember to send it to us. Trust > friction: silent auto-import with an UNDO escape hatch beats prompt-and-wait.

| Feature | Status | Size | Impact | Origin |
|---|---|---|---|---|
| **Instagram auto-poll + silent auto-import** — merchant uploads to IG, video lands on their store within 30min | **Next** | M | Retention | Discussed |
| **UNDO window after auto-import** — single message + 60min revert | **Next** | S | Trust | Discussed |
| **Anti-spam batching + STOP keyword** — max 1 outbound/6h, batch consecutive reels into one message | **Next** | S | Trust | Discussed |
| Catalog gap nudge — `products/create` webhook → "you added X, got a video?" after 3 days untagged | Backlog | S | Engagement | Discussed |
| Performance ping — 24h post-upload views/likes/deals summary, builds the upload habit | Backlog | S | Engagement | Discussed |
| TikTok auto-poll | Later | M | Retention | Discussed |
| "Send to Botiga" browser extension on instagram.com — real-time capture vs polling | Later | L | Retention | Discussed |

**Why silent auto-import (not confirm-and-wait):** confirm flows ask the merchant to do something on every reel — that's the friction we're trying to eliminate. UNDO is a one-tap escape hatch that only fires when a reel was wrong, which is the rare case.

---

## IG Ad Funnel

> Customer taps a sponsored Instagram reel → lands on the merchant's vertical video feed. They've never heard of Botiga and have no context. The 5-second window decides whether they bounce, browse, or buy. This is the single highest-leverage funnel we have: IG ad spend is the dominant discovery channel for fashion/lifestyle merchants, and winning here makes Botiga merchants' ROAS measurably better than any TikTok-style-but-not-shoppable competitor.

> The strategic asset that makes this funnel uniquely winnable: **we know exactly which video the shopper came from** (deep-linked from the ad). Every layer of the experience can anchor on that.

### Buyer journey — what the shopper experiences

> Stories are written from the shopper's POV. Persona = "Maya," a 28-year-old who tapped a sponsored reel on her phone, has never heard of Botiga, and has ~5 seconds of patience.

**B1 · The video I tapped plays first** — `Tier 1 · Next · S`
> *As Maya arriving from an IG sponsored reel, I want the exact video I tapped on to play immediately, so the transition from ad to shop feels seamless and I don't have to hunt.*
**Acceptance:** `?v=<video_id>` deep-link scrolls feed to that video on first paint. Source video metadata flows into Concierge as conversational context. SSR pre-renders the right OG tags so the IG preview also looks right.

**B2 · I learn the price is negotiable in 5 seconds** — `Tier 1 · Next · S`
> *As Maya who's never used Botiga, I want to immediately understand that prices here can be negotiated, so I get what makes this feed different from any other Instagram shop.*
**Acceptance:** Welcome banner slides up over slide 1 after 1.5s: *"Every item here is negotiable. Tap 🤝 to make an offer — or 💬 ask anything."* Dismissible, auto-fades at 6s. Re-appears as a small `🤝 Negotiable` chip if the user swipes past 3 slides without tapping anything.

**B3 · The price tag tells me there's room to move** — `Tier 1 · Next · S`
> *As Maya looking at a product card, I want the price line to telegraph that the listed price is a starting point, so I instinctively understand I could pay less.*
**Acceptance:** Product card shows list price + a smaller "as low as $X" hint computed from `merchant_settings.max_discount_pct` (or per-product rule). Subtle pulse animation on the 🤝 button on slide 1 only; calmer afterwards.

**B4 · The brand looks legit** — `Tier 1 · Next · XS`
> *As Maya who just tapped an ad and lands on an unfamiliar feed, I want a small brand badge that confirms this is the actual merchant, but I don't want a header that pulls me out of the feed.*
**Acceptance:** Top-left small pill with merchant logo + name on backdrop blur. Tap → opens merchant homepage in a new tab. No other merchant chrome until the customer engages.

**B5 · There's a bot I can ask** — `Tier 1 · Next · M`
> *As Maya with a sizing or returns question, I want a familiar chat bubble in the corner, so I can get an answer without leaving the feed.*
**Acceptance:** Floating concierge bubble bottom-right with the merchant's bot avatar (from `merchant_settings.bot_avatar_url`). After 8s of dwell, soft pulse + "1" badge. Tap opens slide-over chat pre-loaded with the source-video product context — *"Saw you watching the [yellow midi dress]. Want to see styles like it, or shall I help you make an offer?"*. Distinct from Situation 2's tile-between-videos surface — IG-arrival shoppers are too cold for inline interruption; bubble pattern wins.

**B6 · I see other people doing this** — `Tier 2 · Next · M`
> *As Maya considering an unfamiliar action (negotiating with a bot), I want to see real activity from other shoppers, so the action feels safe and normal — not weird.*
**Acceptance:** Subtle toast slides in top-center for 4s every 30-45s of scroll. Pulled from real recent `negotiations` table data — *"Maria from Austin just got 15% off the Dayton Bag · 4 minutes ago"*. Hard rule: only real activity, never fabricated. Killswitch in admin.

**B7 · The bot speaks only when it has something useful to say** — `Tier 3 · Backlog · L`
> *As Maya, I don't want the bot interrupting me randomly, but I do want it to surface help when I'm clearly stuck — so it feels helpful, not pushy.*
**Acceptance:** Reactive triggers based on session signals. Each fires at most once per session: scrolled 5 with 0 likes → *"Want me to narrow it down?"*; liked 2+ same product → *"Looks like the [Dayton Bag] caught your eye"*; time-on-video > 10s → *"Want a closer look?"*; watched 2x → *"Decided to come back to this one?"*

**B8 · I can take this with me** — `Tier 2 · Next · M`
> *As Maya about to leave without buying, I want to text or email myself the link, so the impulse buy doesn't have to happen right now and I have a way back.*
**Acceptance:** Save-the-shop exit captures phone or email on `mouseleave` to top edge, browser back gesture, or tab-blur. Sends follow-up SMS/email with: deep-link to where they were + a soft re-engagement hook ("Sage remembered our conversation"). Reuses existing recovery flow plumbing.

**B9 · There's only one obvious next thing to do** — `Tier 2 · Next · M`
> *As Maya, I want exactly one clear next action visible at any moment, so I'm not paralyzed by competing CTAs.*
**Acceptance:** CTA cascade — primary action escalates with engagement. First 5s no CTA (pure content). Welcome banner appears. Then 🤝 pulses on next product card. After 2 likes on same product → bubble pulses with "Want to make an offer?" Etc. Never two competing CTAs visible simultaneously.

### Merchant value — what the seller gets

> Stories from the merchant's POV. Persona = "Rachel," who runs a Shopify store and spends $5K/month on IG ads.

**M1 · My feed lives on my domain, not Botiga's** — `Tier 2 · Next · M`
> *As Rachel running IG ads, I want the feed URL to be on my own Shopify domain, so the ad-to-shop transition keeps my SEO equity and brand authority — and customers don't see "botiga.ai" in the URL.*
**Acceptance:** Shopify App Block / theme integration so merchants can drop the feed onto `/pages/shop` or any theme template. Feed renders inside their theme's chrome (header/footer). Path: `https://shop.com/pages/shop?v=<id>`.

**M2 · Botiga-hosted fallback for fast-start merchants** — `Tier 0 · Shipped`
> *As Rachel who wants to start running IG ads tomorrow without touching theme code, I want a hosted feed URL that's immediately shareable, so I can A/B test before committing to theme integration.*
**Acceptance:** `/preview/[merchantId]` works as a public, customer-facing feed today. Shareable link, no auth.

**M3 · Custom domain for serious merchants** — `Tier 3 · Later · L`
> *As an enterprise merchant, I want to host the feed at `shop.<my-domain>.com` so customers never see "myshopify.com" or "botiga.ai" in the URL — the experience feels fully native.*
**Acceptance:** CNAME setup per merchant. Botiga serves the feed but DNS makes it appear on merchant's subdomain.

**M4 · I can see which IG ads convert** — `Tier 2 · Next · M`
> *As Rachel spending money on IG ads, I want to see UTM-tracked conversion funnels per ad creative, so I know which video drives the most revenue per dollar — and I can shut off the duds.*
**Acceptance:** New "IG Ad Funnel" tab in merchant dashboard. Per UTM source/campaign/content row: views → likes → bot engagements → negotiations → purchases → AOV → 30-day repeat rate. Bot-vs-no-bot lift comparison so Rachel can see Botiga's incremental contribution.

**M5 · Customers we don't close still become leads** — `Tier 2 · Next · M (depends on B8)`
> *As Rachel whose CAC on IG is high, I want even non-converters to be captured as warm leads, so the ad spend isn't wasted on visitors who bounce.*
**Acceptance:** Save-the-shop captures convert into the merchant's `customers` table with full UTM attribution. Re-engagement via email/SMS at 24h, 3d, 7d intervals. Each touch references the specific video they came in from.

### Infrastructure — what we need under the hood

**I1 · Deep-link routing** — `Tier 1 · Next · S`
> *As an engineer, I want a single URL pattern that supports `?v=<id>` and `/v/<id>` formats, so IG ads can use either share-friendly or query-friendly links interchangeably.*
**Acceptance:** Both formats resolve to the same feed slot. SSR picks up the deep-link for OG tag generation (so IG previews and Twitter cards look right when the link is shared).

**I2 · Source video as concierge context** — `Tier 1 · Next · S`
> *As an engineer, I want the deep-link video ID and its tagged product threaded into every concierge call as system context, so the bot can reference what the shopper came in from.*
**Acceptance:** `POST /api/concierge/respond` accepts `entry_video_id`. System prompt includes "The shopper arrived from <video title> tagged to <product>" so the very first concierge greeting can anchor on it.

**I3 · Open graph + Twitter card SSR** — `Tier 2 · Backlog · S`
> *As a merchant sharing the feed link on social media or in IG bios, I want the link preview to show the source video thumbnail + product, so the share looks polished and clickable.*
**Acceptance:** SSR sets `og:image` to the source video thumbnail, `og:title` to "<product> — negotiate now at <merchant>", `og:description` to a brand-voice teaser pulled from `merchant_settings.brand_value_statements[0]`.

### Sequencing — what to ship first

The first three (B1, B2, B3) plus I1+I2 are ~½ day combined and lift the moat from invisible to obvious for every IG-arrival shopper. B5 (bubble Concierge) is the bigger ship but naturally follows. M4 (attribution dashboard) is what gets merchants to *upgrade* — it's the data they need to justify their ad spend to themselves and their CFO.

**Ship order:** B1 → B2 → B3 → I1 → I2 → B4 → B8 → B5 → M4 → B6 → M1 → B9 → M5 → I3 → B7 → M3.

---

## Shoppable Video

> Video shopping overlay — customer watches, negotiates, and checks out without leaving the video.

| Feature | Status | Size | Impact | Origin |
|---|---|---|---|---|
| Stories widget — circular story bubbles, full-screen viewer | Shipped | L | Core | Discussed |
| Carousel / Watch & Shop — horizontal scrollable video feed | Shipped | L | Core | Discussed |
| In-video negotiation — full AI chat overlay inside video viewer | Shipped | L | Conversion | Discussed |
| Product tagging — each video tagged to Shopify product | Shipped | M | Core | Discussed |
| Email + WhatsApp capture inside video negotiation flow | Shipped | S | Lead capture | Discussed |
| Deal auto-redirect — won deal auto-navigates to cart after 2s | Shipped | S | Conversion | Discussed |
| Multi-deal cart banners — stacked banners per negotiated item | Shipped | S | Conversion | Discussed |
| Deep linking — `?btgv=VIDEO_ID` opens feed at specific video | Shipped | M | UX | Discussed |
| Deep linking — `?btgv=s:COL_ID` opens story viewer directly | Shipped | M | UX | Discussed |
| URL updates as feed scrolls (history.replaceState) | Shipped | S | UX | Discussed |
| Share button — copies video-specific URL | Shipped | S | UX | Discussed |
| Product context fetch — bot references vendor/type/tags/description | Shipped | M | Conversion | Discussed |
| Instagram import — merchant enters @handle, pulls recent videos | Shipped | M | Merchant UX | Discussed |
| Product cards in video feed — mixed video + product slides | Shipped | M | Conversion | Discussed |
| TikTok import — merchant enters @handle, pulls recent videos | Backlog | M | Merchant UX | Discussed |
| Phone / direct upload — upload MP4 from device | Backlog | S | Merchant UX | Discussed |
| Auto-sync — scheduled re-pull from Instagram/TikTok | Backlog | M | Merchant UX | Discussed |
| AI product tagging — vision model auto-suggests products | Backlog | L | DX | Discussed |
| Video analytics — views, clicks, negotiate rate, checkout rate | Backlog | M | Analytics | Suggested |
| **Video comments** — customers comment on videos, merchant replies | **Next** | M | Social | Discussed |
| **Video reviews** — star rating + text review on each shoppable video | **Next** | M | Social proof | Discussed |
| A/B testing for video placements | Later | M | Optimization | Suggested |
| Meta retargeting — fire pixel events from video interactions | Later | M | Marketing | Suggested |

---

## Shopify Widget (n.js embed)

| Feature | Status | Size | Impact | Origin |
|---|---|---|---|---|
| Core widget embed — bubble + button modes | Shipped | M | Core | Discussed |
| Proactive chat open (dwell-time trigger) | Shipped | S | Conversion | Discussed |
| Immediate open mode | Shipped | S | Conversion | Discussed |
| On-click trigger mode | Shipped | S | UX | Discussed |
| Cart bundle negotiation | Shipped | M | Conversion | Discussed |
| Accept / counter chips after each bot offer | Shipped | S | Conversion | Discussed |
| Email gate — blur-reveal private price | Shipped | S | Lead capture | Discussed |
| WhatsApp / phone capture in email gate | Shipped | S | Lead capture | Discussed |
| Gradient color support for widget button | Shipped | S | Merchant UX | Discussed |
| Product-aware bot messages Phase 1 — vendor/type/tags/description | Shipped | M | Conversion | Discussed |
| Price-adaptive spread tiers — real ladders for low-price items | Shipped | M | Conversion | Discussed |
| Deal auto-redirect — won deal navigates to cart after 2s | Shipped | S | Conversion | Discussed |
| Cart discount applied automatically on redirect | Shipped | S | Conversion | Discussed |
| Product-aware bot messages — Phase 2 (inventory, reviews) | Backlog | M | Conversion | Suggested |
| Product-aware bot messages — Phase 3 (personalisation) | Backlog | L | Conversion | Suggested |
| Multi-language widget | Later | M | Growth | Suggested |
| Voice negotiation (TTS bot replies) | Icebox | L | Delight | Suggested |
| Browser extension for non-Shopify stores | Icebox | L | Growth | Suggested |

---

## Botiga.ai Marketplace

> Standalone reverse marketplace — customers NLP-search across all onboarded Shopify stores, AI negotiates, merchant gets emailed on deal win.

| Feature | Status | Size | Impact | Origin |
|---|---|---|---|---|
| DB schema — customers, products, negotiations, messages, sponsored | Shipped | M | Core | Discussed |
| Product indexer — crawls `/products.json` per merchant, upserts catalog | Shipped | M | Core | Discussed |
| Full-text search via tsvector + auto-update trigger | Shipped | M | Core | Discussed |
| NLP intent parsing — LLM extracts keywords, price range, style, occasion | Shipped | M | Core | Discussed |
| Marketplace search RPC — raw SQL for reliable full-text search | Shipped | S | Core | Discussed |
| Marketplace negotiate API — start + message endpoints | Shipped | L | Core | Discussed |
| Same pricing engine + bot — real price ladder, same LLM | Shipped | M | Conversion | Discussed |
| Merchant email on deal win — product, customer contact, commission breakdown | Shipped | M | Trust | Discussed |
| Customer deal confirmation email — discount code + checkout link | Shipped | S | Conversion | Discussed |
| Customer auth — signup/login/JWT, captures email + phone | Shipped | M | Core | Discussed |
| Account orders page — deal history with checkout links | Shipped | M | UX | Discussed |
| Landing page — hero search bar + example chips + how it works | Shipped | M | Growth | Discussed |
| Search results grid — product cards with negotiate CTA | Shipped | M | Core | Discussed |
| Product detail page — image gallery, variants, negotiate modal | Shipped | M | Core | Discussed |
| Negotiate chat modal — typing indicator, deal screen, cart redirect | Shipped | M | Conversion | Discussed |
| Sponsored placements schema + bidding table | Shipped | S | Monetization | Discussed |
| Sponsored placements UI — merchant bids on keywords | Backlog | M | Monetization | Discussed |
| Commission tracking dashboard for Botiga admin | Backlog | M | Operations | Suggested |
| Merchant self-onboarding to marketplace | Backlog | M | Growth | Suggested |
| Multi-merchant indexer cron (auto re-index daily) | Backlog | S | Operations | Suggested |
| Customer wishlist / save for later | Backlog | S | Engagement | Suggested |
| Social proof — "X people negotiating this" | Later | S | Conversion | Suggested |
| Recommendation engine — "you might also like" | Later | L | Conversion | Suggested |

---

## Merchant Dashboard (app.botiga.ai)

| Feature | Status | Size | Impact | Origin |
|---|---|---|---|---|
| Settings page — tone / discount % / floor price | Shipped | M | Merchant UX | Discussed |
| Floating save bar (Unsaved changes → Save / Discard) | Shipped | S | Merchant UX | Discussed |
| Button label / color / text color controls | Shipped | S | Merchant UX | Discussed |
| Widget position selector | Shipped | S | Merchant UX | Discussed |
| Proactive message customization | Shipped | S | Merchant UX | Discussed |
| Cart-specific max discount setting | Shipped | S | Conversion | Discussed |
| Plan enforcement (free 50 / starter 500 monthly limit) | Shipped | S | Monetization | Discussed |
| Negotiation history view | Shipped | M | Analytics | Discussed |
| Video widget management — upload, tag, reorder | Shipped | L | Merchant UX | Discussed |
| Marketplace opt-in settings (discount %, commission, store name) | Shipped | S | Merchant UX | Discussed |
| 4-step onboarding wizard — URL → Install → Bot persona → TurboTax-style live progress | Shipped | L | Merchant UX | Discussed |
| Bot persona setup in onboarding — name + 6 preset emoji avatars + custom GIF/URL paste, live preview chat bubble | Shipped | M | Merchant UX | Discussed |
| Sidebar reorder — pillar-first nav (Concierge → Negotiation → Video bot → Install → Billing) | Shipped | S | Merchant UX | Discussed |
| Public preview at `/preview/[merchantId]` with copy-share link — phone-frame vertical feed | Shipped | M | Demo / sharing | Discussed |
| Per-product rules UI — inline editor in video drawer | Shipped | M | Control | Discussed |
| Settings page — tabbed redesign / split into Concierge bot + Negotiation bot pages | Backlog | M | Merchant UX | Discussed |
| Live preview panel in settings | Backlog | M | Merchant UX | Suggested |
| Dashboard full revamp — pillar-page UX (deferred until first iteration ships) | Backlog | L | Merchant UX | Discussed |
| Negotiation funnel chart | Backlog | M | Analytics | Suggested |
| Revenue recovered KPI card | Backlog | S | Analytics | Suggested |
| Per-product analytics | Backlog | M | Analytics | Suggested |
| A/B tone testing | Backlog | L | Optimization | Suggested |
| CSV export of captured leads | Backlog | S | CRM | Suggested |
| Real-time merchant notifications | Later | M | Engagement | Suggested |
| Negotiation replay viewer | Icebox | M | Analytics | Suggested |

---

## Negotiation API (api/*)

| Feature | Status | Size | Impact | Origin |
|---|---|---|---|---|
| Core negotiate endpoint (`POST /negotiate`) | Shipped | L | Core | Discussed |
| Price ladder engine — adaptive spread tiers by price point | Shipped | L | Conversion | Discussed |
| 4-moment deal screen (accepted state) | Shipped | M | Conversion | Discussed |
| Tone-matched human escalation | Shipped | M | Trust | Discussed |
| Lead capture endpoint (`PUT /negotiate/:id/contact`) | Shipped | S | Lead capture | Discussed |
| Product eligibility check (`GET /widget/product-rules`) | Shipped | M | Control | Discussed |
| Widget settings endpoint (`GET /widget/settings`) | Shipped | S | Core | Discussed |
| Product context passed to LLM (vendor/type/tags/description) | Shipped | M | Conversion | Discussed |
| Rate limiting | Shipped | S | Stability | Discussed |
| API key auth middleware | Shipped | S | Security | Discussed |
| CORS — wide-open for widget / strict for dashboard | Shipped | S | Security | Discussed |
| **Full-price justifications** — 3-5 merchant statements (or auto-distilled from About Us / IG) the bot uses to defend price. Stored on `merchant_settings.price_justifications jsonb`, fed into the negotiation system prompt. | **Next** | M | Conversion | Discussed |
| Counter-offer floor warnings | Backlog | S | Conversion | Suggested |
| Escalation path tuning by product tag | Backlog | M | Control | Suggested |
| Post-deal follow-up email (24h reminder) | Backlog | S | Recovery | Suggested |
| Abandoned negotiation recovery email | Backlog | M | Recovery | Suggested |
| **Returning customer recognition** — bot greets by name, unlocks deeper floor for repeat buyers | **Next** | M | Retention | Discussed |
| **Loyalty tiers in bot** — 1st / 3rd / 5th+ purchase unlocks progressively better deal floors | **Next** | M | Retention | Discussed |
| Exit-intent negotiate trigger — widget fires when customer moves to close tab | Backlog | S | Conversion | Discussed |
| AI buyer persona detection | Later | L | Conversion | Suggested |

---

## Email & Notifications

| Feature | Status | Size | Impact | Origin |
|---|---|---|---|---|
| Deal email — discount code + checkout link | Shipped | M | Conversion | Discussed |
| Marketplace merchant alert — customer contact + commission breakdown | Shipped | M | Trust | Discussed |
| Post-deal 24h follow-up email | Backlog | S | Recovery | Suggested |
| Abandoned negotiation recovery email | Backlog | M | Recovery | Discussed |
| **Win-back email** — 30-day post-deal "new arrivals + loyalty offer" | **Next** | S | Retention | Discussed |
| Klaviyo connector | Backlog | M | CRM | Suggested |
| Postscript / SMSBump integration | Backlog | M | CRM | Suggested |
| Real-time merchant deal alerts (push/SMS) | Later | M | Engagement | Suggested |

---

## Shopify App (App Store)

| Feature | Status | Size | Impact | Origin |
|---|---|---|---|---|
| Script tag install via API key | Shipped | S | Core | Discussed |
| Shopify Flow trigger on deal close | Backlog | M | Integrations | Suggested |
| Shopify OAuth embedded app | Later | L | Distribution | Suggested |
| Shopify Billing API integration | Later | M | Monetization | Suggested |
| GDPR webhooks (customer/shop redact) | Later | M | Compliance | Suggested |
| App Store submission & review | Later | L | Distribution | Suggested |

---

## Customer Loyalty & Retention

> Returning customers cost 5–7x less to close. Bot recognizes them and rewards them automatically.

| Feature | Status | Size | Impact | Origin |
|---|---|---|---|---|
| **Returning customer recognition** — bot greets by name, surfaces deal history | **Next** | M | Retention | Discussed |
| **Loyalty tiers** — 1st / 3rd / 5th+ purchase unlocks progressively better negotiation floors | **Next** | M | Retention | Discussed |
| **Win-back email** — 30-day post-deal email with new arrivals + loyalty offer | **Next** | S | Retention | Discussed |
| Abandoned negotiation recovery email — "your offer is still on the table" 2h after drop-off | Backlog | M | Recovery | Discussed |
| Exit-intent negotiate trigger — widget fires when customer moves to close tab | Backlog | S | Conversion | Discussed |
| Customer profile page — deal history, saved items, loyalty tier | Backlog | M | UX | Suggested |
| Post-purchase upsell — after checkout, bot offers related product at negotiated price | Backlog | M | AOV | Suggested |
| Bundle negotiation — "buy 2, negotiate the price" to push AOV | Backlog | M | AOV | Discussed |

---

## Social Proof & Community

> Turn passive viewers into active participants. Comments and reviews on shoppable videos create trust at the moment of purchase intent.

| Feature | Status | Size | Impact | Origin |
|---|---|---|---|---|
| **Video comments** — customers comment on shoppable videos, merchant can reply | **Next** | M | Social | Discussed |
| **Video reviews** — star rating + text review attached to each shoppable video | **Next** | M | Trust | Discussed |
| **Product reviews on widget** — star rating visible inside negotiate widget header | **Next** | S | Trust | Discussed |
| 3-second like/view polling — count bumps + floating hearts when another user likes | Shipped | S | FOMO | Discussed |
| Add-to-cart counter on video — "🛒 23 people added this from this video" | Next | S | FOMO | Discussed |
| Scarcity badge from Shopify inventory — "⚡ Only 4 left" on product card in feed | Next | S | FOMO | Discussed |
| Recent activity toast — "Someone in London ❤️ just liked this" slide-up notification | Backlog | S | FOMO | Discussed |
| 🔥 Trending badge — auto-badge videos above engagement threshold in last 24h | Backlog | S | FOMO | Discussed |
| "X people bought after watching" — cross-reference add-to-cart with Shopify orders | Backlog | M | FOMO | Discussed |
| "X people negotiating this" live counter on video/product | Backlog | S | FOMO | Discussed |
| Deal ticker — "Maria from Austin just got 15% off this dress" social feed | Backlog | S | FOMO | Suggested |
| Review request post-deal — auto-ask for review after successful negotiation | Backlog | S | Social proof | Suggested |
| UGC reshare — flag customer-tagged posts for merchant to repost | Later | M | Community | Suggested |

---

## Admin Dashboard (/admin/*)

| Feature | Status | Size | Impact | Origin |
|---|---|---|---|---|
| Live negotiation feed — all active sessions, auto-refresh 5s | Shipped | M | Operations | Discussed |
| Conversation replay per negotiation in live feed | Shipped | S | Operations | Discussed |
| Floor risk flag (⚠ after 5+ turns) | Shipped | S | Operations | Suggested |
| All merchants view — revenue, win rate, LLM cost, churn risk | Shipped | M | Operations | Discussed |
| Merchant detail expand — tone, discount, floor, broker fee | Shipped | S | Operations | Discussed |
| Alerts — floor breach, high LLM cost, churn risk, idle merchants | Shipped | M | Operations | Discussed |
| Alert resolve action | Shipped | S | Operations | Discussed |
| Roadmap kanban board | Shipped | M | Internal | Discussed |
| Marketplace commission dashboard | Backlog | M | Operations | Suggested |

---

## Infrastructure & Platform

| Feature | Status | Size | Impact | Origin |
|---|---|---|---|---|
| Vercel deployment (API + dashboard + marketplace) | Shipped | S | Core | Discussed |
| Supabase (Postgres + auth) | Shipped | M | Core | Discussed |
| DB migrations (001–031) — through cascade FKs + onboarding + branding | Shipped | M | Core | Discussed |
| Defensive module loading — `safeRequire` / `safeMount` wraps optional routes so a missing file doesn't 500 the whole API | Shipped | S | Stability | Discussed |
| Tick-pattern chunking — auto-tag-tick, clone-tick, IG-import-tick run within Vercel's 60s ceiling | Shipped | M | Stability | Discussed |
| Background queue (Inngest / Trigger.dev) — proper agent-friendly execution past Vercel ceiling | **Later** | M | Stability | Discussed |
| Merchant white-label | Later | M | Revenue | Suggested |
| Competitor price matching | Icebox | L | Conversion | Suggested |

---

## Agentic Flows (post-V1)

> After the first iteration ships and we're seeing real merchant signal, lift the Pillar-3 vision pipeline and Pillar-1 concierge into proper tool-using agents. Single-call LLMs ship faster; agents win once the surface forks too much for hard-coded paths. Deferred deliberately — don't change too much before proving the V1 loop.

| Flow | Status | Size | Impact | Origin | Why agent (not script) |
|---|---|---|---|---|---|
| **Content agent** — video / WhatsApp message → tagged Shopify product. Tools: `analyzeFrames`, `searchCatalog`, `createDraftProduct`, `tagToVideo`, `askMerchant` (1 question max) | **Backlog** | L | Merchant UX | Discussed | Path forks heavily: existing vs new product, photo vs video, ambiguous vs clear, confidence-driven branching |
| **Concierge agent** — greet → classify intent → route to negotiate / video / search → close. Tools: `searchProducts`, `lookupPolicy`, `startNegotiation`, `openVideo`, `captureLead`, returning-customer memory | **Backlog** | L | Conversion | Discussed | Pillar 1 is fundamentally an agent problem — single-call LLMs can't handle browse/compare/haggle/support fork |
| **Customer-voice agent** — read negotiation transcripts + comments + reviews → distill brand voice + objection patterns → feed into all bot prompts. Runs nightly, read-only. | Backlog | M | Cross-pillar | Discussed | Compounds across all pillars; no shopper-facing risk |
| Recovery agent — cold WhatsApp follow-up on dropped negotiations | Later | M | Recovery | Suggested | Risky for trust — needs careful guardrails |
| Catalog gap agent — flag products without videos and prompt merchant | Later | S | Engagement | Discussed | Nice-to-have, lives behind Content agent |
| Health monitor agent — anomalies in orders / negotiations / costs → Slack | Later | S | Operations | Suggested | Internal tool, not customer-facing |

**Substrate the agentic flows will need (build once, before any agent):**
- `agent_runs` table — full step trace per run for replay / debug / kill-switch
- Tool registry — typed tool definitions reused across agents
- Step + tool-call budget caps per merchant (avoid runaway cost)
- Background queue (Inngest / Trigger.dev) — Vercel 60s tick-loop is the wrong shape for agents
- Reasoning model: Claude Sonnet 4.6 default, Opus 4.7 for the harder Content-agent calls. Vision stays Groq Llama 4 Scout for cheap frames.

**Explicitly NOT agentic** (deterministic state machines win):
- Negotiation engine — price ladder + tone tiers are tightly scoped, single-call works
- Onboarding wizard — 2-min deterministic flow more reliable than conversational
- Clone tool — deterministic, agents would only add cost

---

---

## AI Content Creation

> Merchant gives Botiga a video — Botiga figures out what's in it, writes the product listing, creates the Shopify product draft, and makes it shoppable. Zero manual tagging.

| Feature | Status | Size | Impact | Origin |
|---|---|---|---|---|
| AI video analysis — extract frames + caption, call Groq Llama 4 Scout vision, return product candidates with confidence | Shipped | M | Merchant UX | Discussed |
| Confidence thresholds: ≥0.5 auto-tag / 0.3-0.5 pending review / <0.3 skip — human always verifies | Shipped | S | Trust | Discussed |
| Auto Shopify product create — POST draft with variants (sizes/colors) to Shopify Admin API from AI analysis | Shipped | M | Merchant UX | Discussed |
| AI Tag drawer — multi-product cards, inline price + sizes, single form (not turn-by-turn chat) | Shipped | M | Merchant UX | Discussed |
| Accept-tag emerald flash with 900ms hold — visible feedback before row morph | Shipped | S | UX | Discussed |
| Auto-analyze on Instagram import — `auto-tag-tick` chunked endpoint runs Vision AI on every imported video | Shipped | M | Merchant UX | Discussed |
| Background auto-tag continuation on dashboard — silently finishes unanalyzed videos in 5-chunks if onboarding closed mid-tag | Shipped | S | UX | Discussed |
| Per-product negotiation rule editor inside video drawer | Shipped | M | Control | Discussed |
| Product picker with collection / tag filters (paginates through all products, not capped at 20) | Shipped | M | Merchant UX | Discussed |
| Vision-model fallback chain — Groq → Gemini Flash → paid (Anthropic vision) for redundancy | **Backlog** | M | Reliability | Discussed |
| AI video title + caption generation — suggest TikTok/Instagram captions from product analysis | Backlog | S | Content | Suggested |
| Video → product image extraction — pull best frames as Shopify product images | Backlog | M | Merchant UX | Discussed |
| WhatsApp video → product create — merchant DMs a video, agent transcribes + extracts price/size + creates draft | **Next** | L | Merchant UX | Discussed |

**Cost:** Groq Llama 4 Scout free tier = ~2,400 video analyses/day. Paid rate ~$0.0005/video. Absorb in plan pricing.

---

## Pricing

> Flat monthly fee. No per-visitor billing. No surprise spikes. Updated April 2026.

| Plan | Price | Conversations/mo | Videos | Features |
|---|---|---|---|---|
| **Free** | $0 | 100 | 5 | Negotiate widget, video launcher, concierge (limited) |
| **Starter** | $29/mo | 500 | Unlimited | Full concierge + negotiate + video, basic analytics |
| **Growth** | $49/mo | 2,000 | Unlimited | All Starter + AI auto-tag, marketplace listing, priority support |
| **Pro** | $149/mo | Unlimited | Unlimited | All Growth + white-label launcher, advanced analytics, API access |

### Why this undercuts everyone

| Competitor | Price | What you get |
|---|---|---|
| Rep AI | $99/mo | Chat concierge only — charges per visitor, spikes on traffic |
| Tolstoy | $99/mo | Shoppable video only — charges per impression |
| Videowise | $99–249/mo | Shoppable video only |
| Tidio + Lyro | $39–749/mo | Support chat, AI is a separate add-on |
| **Botiga Starter** | **$29/mo** | **Concierge + video + negotiate — flat rate, no surprises** |

### Pitch line
> *"Rep AI charges $99/month for chat alone. Tolstoy charges $99 for video alone. Botiga is $29 and you get both — plus AI price negotiation."*

### Pricing build items

| Feature | Status | Size |
|---|---|---|
| Plan enforcement in API (free 100 / starter 500 / growth 2K / pro unlimited) | Shipped (partial) | S |
| Billing page in dashboard — Stripe checkout for Starter/Growth/Pro | Backlog | M |
| Shopify Billing API integration (for App Store distribution) | Later | L |
| Usage meter — show conversations used this month on dashboard | Backlog | S |
| Upgrade prompt when limit approached (80% warning + hard stop) | Backlog | S |

---

## Competitive Landscape

> Knowledge as of April 2026. Verify current state before fundraising or sales decks.

### Who owns what

| Company | Core strength | Missing |
|---|---|---|
| **Tolstoy** | Shoppable video, floating launcher, Shopify-native install, stories format. Pre-recorded "video bot" for routing. Clean merchant UX. | No negotiation. No real AI. No marketplace. Full price only. |
| **Nibble** | AI price negotiation in chat format. Proven conversion lift. "Make an offer" UX on product pages. | No video. No concierge. No marketplace. Customer must already be on the product page. |
| **Rep AI** | Proactive AI concierge. Behavioural triggers (time on page, exit intent, scroll depth). Product Q&A, recommendations. 20–30% conversion lift claimed. Shopify App Store presence. | No video. No negotiation. Assists but doesn't close. |
| **Videowise** | Shoppable video, stories, carousels, analytics. Enterprise-focused. | No negotiation. No concierge. No marketplace. |
| **Firework** | Live shopping + short-form video. Media/brand focused. | Enterprise contracts. Not Shopify-native. No negotiation. |
| **Octane AI** | Quiz funnels + chat. Merchant-controlled recommendation flows. | Not genuinely intelligent. No video. No negotiation. |
| **Tidio / Gorgias** | Customer support chat with AI bolt-on. | Service-first, not sales-first. No video. No negotiation. |

### The white space Botiga owns

Nobody has connected **video discovery → AI concierge → price negotiation → cross-store marketplace fallback** in one widget behind one script tag. Every competitor owns exactly one lane.

### What to take from each

- **From Tolstoy** — floating launcher UX and zero-friction install story. They've trained merchants to accept a floating widget. Copy that pattern, stack everything behind it.
- **From Nibble** — "Make an offer" entry point on product pages. Low friction because it's the customer's idea. The concierge nudging toward negotiation is the same instinct, applied proactively.
- **From Rep AI** — behavioural trigger logic. Time on page, scroll depth, cart value, exit intent. They've solved when to interrupt without annoying. Use the same trigger system for the concierge pop-up timing.

### The moat

The marketplace creates a network effect none of them have. More merchants → more products for every customer → more value per visit. The unified widget (video + concierge + negotiate) creates switching cost once merchants are live. Win on distribution (App Store, zero homepage changes), defend on network.

### The risk

Rep AI is well-funded with Shopify merchant relationships. If they add video and negotiation they become a direct threat. The window to own "the unified commerce widget" positioning is real but not unlimited. Speed matters.

---

## What to Build Next

> Prioritised by: merchant friction removed, revenue impact, and strategic positioning. April 2026.

### Tier 1 — Build now (unblocks everything else)

| Feature | Why now | Section |
|---|---|---|
| **IG Ad Funnel buyer-side V1** — B1+B2+B3+I1+I2 (deep-link source video, welcome banner, "as low as" price hint, concierge context) | Highest-leverage funnel; solves the "shoppers from IG don't know they can negotiate" problem in ~½ day total. Merchants run IG ads daily — every day this is unfixed is bounced ad spend. | IG Ad Funnel |
| **Floating video launcher** | Removes the only reason merchants hesitate. Zero homepage changes. Transforms video widget install story from "edit your theme" to "paste one tag." Prerequisite for the concierge. | Shoppable Video |
| **Concierge V1** — proactive pop-up, 3 intent chips, routes to video/negotiate/search | The product that unifies everything. Differentiates from every competitor. Rep AI proves the category works. V1 just needs: trigger timing, 3 paths, handoff to existing tools. Pairs with IG Ad Funnel B5 (bubble surface). | New |
| **Product page auto-inject** | Script detects `/products/` URLs, injects video shelf + negotiate button automatically. Merchants never touch a template. Second-lowest friction install after the launcher. | Shoppable Video |

### Tier 2 — Build soon (conversion + FOMO)

| Feature | Why | Section |
|---|---|---|
| **Brand-story auto-write** — onboarding scrapes About Us / IG bio / FB about → drafts the brand voice paragraph + 3-5 full-price justifications, merchant edits & approves | Removes the "stare at empty textarea" moment from onboarding — same data flows into both Concierge greeting AND Negotiation defense. Nothing else gives one scrape this much downstream leverage. | Pillar 1 + Pillar 2 |
| **Full-price justifications** — bot uses these as defense lines when offers get aggressive | Today bot only has tone + ladder; no narrative for *why* price holds. Sales-coach-grade negotiation needs reasons, not just numbers. | Negotiation API |
| **Add-to-cart counter on video** — "🛒 23 people added this" | Data already in DB. One API call. Highest-trust social proof signal — purchase intent, not passive views. | Social Proof |
| **Scarcity badge from Shopify inventory** — "⚡ Only 4 left" | One Shopify API call per product. Real urgency. Nibble and Tolstoy don't do this. | Social Proof |
| **Returning customer recognition in concierge** | Rep AI's biggest selling point. Loyalty memory changes the conversation from cold to warm on every return visit. | Customer Loyalty |

### Tier 3 — Plan but don't start yet

| Feature | Why wait | Section |
|---|---|---|
| Shopify App Blocks | Right move for App Store submission, but L effort. Do after V1 is proven. | Shopify App |
| Hosted botiga.ai/shop/[handle] page | Good for merchants who won't install anything. Build after concierge is live so the page has a concierge on it too. | New |
| TikTok import | Nice to have. Instagram is already working. Add when merchant demand is clear. | Shoppable Video |
| Activity toast ("Someone just liked this") | Good FOMO but needs fake-data guardrails. Build after add-to-cart counter proves the pattern. | Social Proof |

---

*Last updated: 2026-05-05 — added IG Ad Funnel section as user stories (Maya the shopper, Rachel the merchant). Buyer-side V1 (deep-link + welcome banner + negotiable price hint) promoted to Tier 1 — the highest-leverage funnel for IG-running merchants. Previously: brand-story auto-write + full-price justifications (Tier 2), onboarding wizard, Floating Feed auto-provision, background auto-tag continuation, sidebar reorder, Agentic Flows section.*
