# Botiga Roadmap

Organized by product area. Status: **Shipped** · **Next** · **Backlog** · **Later** · **Icebox**
Origin: **Discussed** = user requested or reported · **Suggested** = Claude proposed

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
| Settings page — tabbed redesign | Backlog | M | Merchant UX | Suggested |
| Live preview panel in settings | Backlog | M | Merchant UX | Suggested |
| Per-product rules UI | Backlog | M | Control | Suggested |
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
| DB migrations (001–013) | Shipped | S | Core | Discussed |
| Merchant white-label | Later | M | Revenue | Suggested |
| Competitor price matching | Icebox | L | Conversion | Suggested |

---

---

## AI Content Creation

> Merchant gives Botiga a video — Botiga figures out what's in it, writes the product listing, creates the Shopify product draft, and makes it shoppable. Zero manual tagging.

| Feature | Status | Size | Impact | Origin |
|---|---|---|---|---|
| **AI video analysis** — extract frames, call Vision AI (Groq Llama 3.2), return title + description + tags | **Next** | S | Merchant UX | Discussed |
| **Auto Shopify product create** — POST draft product to Shopify Admin API from AI analysis, tag video automatically | **Next** | M | Merchant UX | Discussed |
| **AI Tag button on video card** — one-click flow: analyze → review AI suggestion → create product or match existing | **Next** | S | Merchant UX | Discussed |
| Auto-analyze on Instagram import — run Vision AI automatically on every imported video, pre-fill product suggestions | Backlog | S | Merchant UX | Discussed |
| Batch analyze — run AI on all untagged videos at once | Backlog | S | Merchant UX | Discussed |
| AI video title + caption generation — suggest TikTok/Instagram captions from product analysis | Backlog | S | Content | Suggested |
| Video → product image extraction — pull best frames as Shopify product images | Backlog | M | Merchant UX | Discussed |

**Cost:** Groq Llama 3.2 Vision free tier = ~2,400 video analyses/day. Paid rate ~$0.0005/video. Absorb in plan pricing.

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
| **Floating video launcher** | Removes the only reason merchants hesitate. Zero homepage changes. Transforms video widget install story from "edit your theme" to "paste one tag." Prerequisite for the concierge. | Shoppable Video |
| **Concierge V1** — proactive pop-up, 3 intent chips, routes to video/negotiate/search | The product that unifies everything. Differentiates from every competitor. Rep AI proves the category works. V1 just needs: trigger timing, 3 paths, handoff to existing tools. | New |
| **Product page auto-inject** | Script detects `/products/` URLs, injects video shelf + negotiate button automatically. Merchants never touch a template. Second-lowest friction install after the launcher. | Shoppable Video |

### Tier 2 — Build soon (conversion + FOMO)

| Feature | Why | Section |
|---|---|---|
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

*Last updated: 2026-04-30 — added Proactive Agent section (IG auto-poll + UNDO chosen as the proactive loop strategy)*
