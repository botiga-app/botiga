# Botiga Roadmap

Organized by product area. Status: **Shipped** · **Next** · **Backlog** · **Later** · **Icebox**
Origin: **Discussed** = user requested or reported · **Suggested** = Claude proposed

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
| Instagram import — merchant enters @handle, pulls recent videos | Backlog | M | Merchant UX | Discussed |
| TikTok import — merchant enters @handle, pulls recent videos | Backlog | M | Merchant UX | Discussed |
| Phone / direct upload — upload MP4 from device | Backlog | S | Merchant UX | Discussed |
| Auto-sync — scheduled re-pull from Instagram/TikTok | Backlog | M | Merchant UX | Discussed |
| AI product tagging — vision model auto-suggests products | Backlog | L | DX | Discussed |
| Video analytics — views, clicks, negotiate rate, checkout rate | Backlog | M | Analytics | Suggested |
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
| AI buyer persona detection | Later | L | Conversion | Suggested |

---

## Email & Notifications

| Feature | Status | Size | Impact | Origin |
|---|---|---|---|---|
| Deal email — discount code + checkout link | Shipped | M | Conversion | Discussed |
| Marketplace merchant alert — customer contact + commission breakdown | Shipped | M | Trust | Discussed |
| Post-deal 24h follow-up email | Backlog | S | Recovery | Suggested |
| Abandoned negotiation recovery email | Backlog | M | Recovery | Suggested |
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

*Last updated: 2026-04-22*
