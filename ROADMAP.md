# Botiga Roadmap

Organized by product area. Status: **Shipped** · **Next** · **Backlog** · **Later** · **Icebox**
Origin: **Discussed** = user requested or reported · **Suggested** = Claude proposed

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
| Shopify auto-email from signed-in account | Shipped | S | Lead capture | Discussed |
| WhatsApp / phone capture option in gate | Next | S | Lead capture | Discussed |
| Gradient color for chat icon / button | Next | S | Merchant UX | Discussed |
| Product-aware bot messages — Phase 1 | Next | M | Conversion | Discussed |
| Product-aware bot messages — Phase 2 | Backlog | M | Conversion | Suggested |
| Product-aware bot messages — Phase 3 | Backlog | L | Conversion | Suggested |
| Multi-language widget | Later | M | Growth | Suggested |
| Voice negotiation (TTS bot replies) | Icebox | L | Delight | Suggested |
| Browser extension for non-Shopify stores | Icebox | L | Growth | Suggested |

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
| Nibble-inspired price ladder engine | Shipped | L | Conversion | Discussed |
| 4-moment deal screen (accepted state) | Shipped | M | Conversion | Discussed |
| Tone-matched human escalation | Shipped | M | Trust | Discussed |
| Lead capture endpoint (`PUT /negotiate/:id/contact`) | Shipped | S | Lead capture | Discussed |
| Product eligibility check (`GET /widget/product-rules`) | Shipped | M | Control | Discussed |
| Widget settings endpoint (`GET /widget/settings`) | Shipped | S | Core | Discussed |
| Rate limiting | Shipped | S | Stability | Discussed |
| API key auth middleware | Shipped | S | Security | Discussed |
| CORS — wide-open for widget / strict for dashboard | Shipped | S | Security | Discussed |
| Debug endpoints (`/debug/*`) | Shipped | S | DX | Suggested |
| Counter-offer floor warnings | Backlog | S | Conversion | Suggested |
| Escalation path tuning by product tag | Backlog | M | Control | Suggested |
| Bundle negotiation — smarter cart discounts | Backlog | M | Conversion | Suggested |
| Post-deal follow-up email (24h reminder) | Backlog | S | Recovery | Suggested |
| Abandoned negotiation recovery email | Backlog | M | Recovery | Suggested |
| AI buyer persona detection | Later | L | Conversion | Suggested |

---

## Email & Notifications

| Feature | Status | Size | Impact | Origin |
|---|---|---|---|---|
| Deal email — discount code + checkout link | Shipped | M | Conversion | Discussed |
| Debug email test endpoint (`/debug/email`) | Shipped | S | DX | Suggested |
| Post-deal 24h follow-up email | Backlog | S | Recovery | Suggested |
| Abandoned negotiation recovery email | Backlog | M | Recovery | Suggested |
| Klaviyo connector | Backlog | M | CRM | Suggested |
| Postscript / SMSBump integration | Backlog | M | CRM | Suggested |
| Real-time merchant deal alerts | Later | M | Engagement | Suggested |

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

---

## Infrastructure & Platform

| Feature | Status | Size | Impact | Origin |
|---|---|---|---|---|
| Vercel deployment (API + dashboard) | Shipped | S | Core | Discussed |
| Supabase (Postgres + auth) | Shipped | M | Core | Discussed |
| DB migrations (001–008) | Shipped | S | Core | Discussed |
| Merchant white-label | Later | M | Revenue | Suggested |
| Competitor price matching | Icebox | L | Conversion | Suggested |

---

*Last updated: 2026-04-21*
