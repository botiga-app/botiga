'use client';
import { useState } from 'react';

const ITEMS = [
  // Shopify Widget
  { product: 'Shopify Widget', feature: 'Core widget embed — bubble + button modes', status: 'Shipped', size: 'M', impact: 'Core', origin: 'Discussed', notes: 'Injects into any Shopify theme via script tag' },
  { product: 'Shopify Widget', feature: 'Proactive chat open (dwell-time trigger)', status: 'Shipped', size: 'S', impact: 'Conversion', origin: 'Discussed', notes: 'Opens after N seconds of page idle' },
  { product: 'Shopify Widget', feature: 'Immediate open mode', status: 'Shipped', size: 'S', impact: 'Conversion', origin: 'Discussed', notes: 'Fixed missing else branch — opens 600ms after page load' },
  { product: 'Shopify Widget', feature: 'On-click trigger mode', status: 'Shipped', size: 'S', impact: 'UX', origin: 'Discussed', notes: 'Only opens when customer clicks button' },
  { product: 'Shopify Widget', feature: 'Cart bundle negotiation', status: 'Shipped', size: 'M', impact: 'Conversion', origin: 'Discussed', notes: 'Detects cart page context; applies cart-specific discount rules' },
  { product: 'Shopify Widget', feature: 'Accept / counter chips after each bot offer', status: 'Shipped', size: 'S', impact: 'Conversion', origin: 'Discussed', notes: '[✓ Accept $X] and [Make a counter] appear after every bot price' },
  { product: 'Shopify Widget', feature: 'Email gate — blur-reveal private price', status: 'Shipped', size: 'S', impact: 'Lead capture', origin: 'Discussed', notes: 'Price blurred at 2px; email unlocks reveal; 🔒 private price copy' },
  { product: 'Shopify Widget', feature: 'Shopify auto-email from signed-in account', status: 'Shipped', size: 'S', impact: 'Lead capture', origin: 'Discussed', notes: 'Reads /account.json; skips gate if email already known' },
  { product: 'Shopify Widget', feature: 'WhatsApp / phone capture in gate', status: 'Next', size: 'S', impact: 'Lead capture', origin: 'Discussed', notes: 'Second field below email: or send to WhatsApp' },
  { product: 'Shopify Widget', feature: 'Gradient color for chat icon / button', status: 'Next', size: 'S', impact: 'Merchant UX', origin: 'Discussed', notes: 'CSS linear-gradient support in widget settings' },
  { product: 'Shopify Widget', feature: 'Product-aware bot messages — Phase 1', status: 'Next', size: 'M', impact: 'Conversion', origin: 'Discussed', notes: 'Widget fetches /products/HANDLE.js; bot references specific materials, style, origin' },
  { product: 'Shopify Widget', feature: 'Product-aware bot messages — Phase 2', status: 'Backlog', size: 'M', impact: 'Conversion', origin: 'Suggested', notes: 'Pull Shopify reviews/metafields; surface social proof mid-negotiation' },
  { product: 'Shopify Widget', feature: 'Product-aware bot messages — Phase 3', status: 'Backlog', size: 'L', impact: 'Conversion', origin: 'Suggested', notes: 'Dynamic justification library per product category' },
  { product: 'Shopify Widget', feature: 'Multi-language widget', status: 'Later', size: 'M', impact: 'Growth', origin: 'Suggested', notes: 'Auto-detect navigator.language; bot replies in customer language' },
  { product: 'Shopify Widget', feature: 'Voice negotiation (TTS bot replies)', status: 'Icebox', size: 'L', impact: 'Delight', origin: 'Suggested', notes: 'Widget speaks bot messages aloud' },
  { product: 'Shopify Widget', feature: 'Browser extension for non-Shopify stores', status: 'Icebox', size: 'L', impact: 'Growth', origin: 'Suggested', notes: 'WooCommerce, BigCommerce, etc.' },
  // Merchant Dashboard
  { product: 'Merchant Dashboard', feature: 'Settings page — tone / discount % / floor price', status: 'Shipped', size: 'M', impact: 'Merchant UX', origin: 'Discussed', notes: 'Single-scroll settings with all widget + negotiation controls' },
  { product: 'Merchant Dashboard', feature: 'Floating save bar (Unsaved changes → Save / Discard)', status: 'Shipped', size: 'S', impact: 'Merchant UX', origin: 'Discussed', notes: 'Animated pill slides in on change; replaces auto-save' },
  { product: 'Merchant Dashboard', feature: 'Button label / color / text color controls', status: 'Shipped', size: 'S', impact: 'Merchant UX', origin: 'Discussed', notes: 'Merchant can brand the widget button' },
  { product: 'Merchant Dashboard', feature: 'Widget position selector', status: 'Shipped', size: 'S', impact: 'Merchant UX', origin: 'Discussed', notes: 'below-cart, floating, etc.' },
  { product: 'Merchant Dashboard', feature: 'Proactive message customization', status: 'Shipped', size: 'S', impact: 'Merchant UX', origin: 'Discussed', notes: 'Custom opener copy the bot uses on first message' },
  { product: 'Merchant Dashboard', feature: 'Cart-specific max discount setting', status: 'Shipped', size: 'S', impact: 'Conversion', origin: 'Discussed', notes: 'Separate discount cap for cart vs. product page' },
  { product: 'Merchant Dashboard', feature: 'Plan enforcement (free 50 / starter 500 limit)', status: 'Shipped', size: 'S', impact: 'Monetization', origin: 'Discussed', notes: 'Returns 402 with upgrade URL when limit hit' },
  { product: 'Merchant Dashboard', feature: 'Negotiation history view', status: 'Shipped', size: 'M', impact: 'Analytics', origin: 'Discussed', notes: 'All negotiations with status, price, customer email' },
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
  { product: 'Negotiation API', feature: 'Nibble-inspired price ladder engine', status: 'Shipped', size: 'L', impact: 'Conversion', origin: 'Discussed', notes: '4-step concession ladder from list → floor; step unlocks per round' },
  { product: 'Negotiation API', feature: '4-moment deal screen (accepted state)', status: 'Shipped', size: 'M', impact: 'Conversion', origin: 'Discussed', notes: 'Checkout URL + discount code + expiry returned on deal close' },
  { product: 'Negotiation API', feature: 'Tone-matched human escalation', status: 'Shipped', size: 'M', impact: 'Trust', origin: 'Discussed', notes: 'Bot hands off gracefully when it can\'t go lower' },
  { product: 'Negotiation API', feature: 'Lead capture endpoint (PUT /negotiate/:id/contact)', status: 'Shipped', size: 'S', impact: 'Lead capture', origin: 'Discussed', notes: 'Saves email/phone to negotiation row after gate submit' },
  { product: 'Negotiation API', feature: 'Product eligibility check', status: 'Shipped', size: 'M', impact: 'Control', origin: 'Discussed', notes: 'Per-product rule resolution; tag-based overrides' },
  { product: 'Negotiation API', feature: 'Rate limiting', status: 'Shipped', size: 'S', impact: 'Stability', origin: 'Discussed', notes: 'Per-IP limits via express-rate-limit' },
  { product: 'Negotiation API', feature: 'API key auth middleware', status: 'Shipped', size: 'S', impact: 'Security', origin: 'Discussed', notes: 'Validates k= query param; core to multi-tenant design' },
  { product: 'Negotiation API', feature: 'CORS — widget open / dashboard strict', status: 'Shipped', size: 'S', impact: 'Security', origin: 'Discussed', notes: 'Fixed missing PUT method that caused save errors' },
  { product: 'Negotiation API', feature: 'Debug endpoints (/debug/*)', status: 'Shipped', size: 'S', impact: 'DX', origin: 'Suggested', notes: 'Opening, LLM, email, merchant — for fast production diagnosis' },
  { product: 'Negotiation API', feature: 'Counter-offer floor warnings', status: 'Backlog', size: 'S', impact: 'Conversion', origin: 'Suggested', notes: 'Bot signals final offer one step before hard floor' },
  { product: 'Negotiation API', feature: 'Escalation path tuning by product tag', status: 'Backlog', size: 'M', impact: 'Control', origin: 'Suggested', notes: 'slow-mover tag → bot concedes faster' },
  { product: 'Negotiation API', feature: 'Bundle negotiation — smarter cart discounts', status: 'Backlog', size: 'M', impact: 'Conversion', origin: 'Suggested', notes: 'Cross-product bundle logic; not just % off total' },
  { product: 'Negotiation API', feature: 'Post-deal follow-up email (24h reminder)', status: 'Backlog', size: 'S', impact: 'Recovery', origin: 'Suggested', notes: 'If checkout URL unused after 24h; send urgency email' },
  { product: 'Negotiation API', feature: 'Abandoned negotiation recovery email', status: 'Backlog', size: 'M', impact: 'Recovery', origin: 'Suggested', notes: 'Trigger if session drops after 2+ messages, no deal' },
  { product: 'Negotiation API', feature: 'AI buyer persona detection', status: 'Later', size: 'L', impact: 'Conversion', origin: 'Suggested', notes: 'Detect price-sensitive vs. brand-loyal from tone; adapt concession speed' },
  // Email
  { product: 'Email & Notifications', feature: 'Deal email — discount code + checkout link', status: 'Shipped', size: 'M', impact: 'Conversion', origin: 'Discussed', notes: 'Supports Resend, Gmail SMTP, AWS SES' },
  { product: 'Email & Notifications', feature: 'Debug email test endpoint', status: 'Shipped', size: 'S', impact: 'DX', origin: 'Suggested', notes: '/debug/email?to= — fires real send, returns provider config' },
  { product: 'Email & Notifications', feature: 'Post-deal 24h follow-up email', status: 'Backlog', size: 'S', impact: 'Recovery', origin: 'Suggested', notes: 'If checkout URL unused after 24h; send urgency email' },
  { product: 'Email & Notifications', feature: 'Abandoned negotiation email', status: 'Backlog', size: 'M', impact: 'Recovery', origin: 'Suggested', notes: 'Trigger if session drops after 2+ messages, no deal' },
  { product: 'Email & Notifications', feature: 'Klaviyo connector', status: 'Backlog', size: 'M', impact: 'CRM', origin: 'Suggested', notes: 'Push captured emails + deal status to Klaviyo list' },
  { product: 'Email & Notifications', feature: 'Postscript / SMSBump integration', status: 'Backlog', size: 'M', impact: 'CRM', origin: 'Suggested', notes: 'WhatsApp/SMS deal notifications' },
  { product: 'Email & Notifications', feature: 'Real-time merchant deal alerts', status: 'Later', size: 'M', impact: 'Engagement', origin: 'Suggested', notes: 'Slack/email to merchant on deal close' },
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
  // Infrastructure
  { product: 'Infrastructure', feature: 'Vercel deployment (API + dashboard)', status: 'Shipped', size: 'S', impact: 'Core', origin: 'Discussed', notes: 'api: botiga-api-two.vercel.app' },
  { product: 'Infrastructure', feature: 'Supabase (Postgres + auth)', status: 'Shipped', size: 'M', impact: 'Core', origin: 'Discussed', notes: 'Multi-tenant; per-merchant rows' },
  { product: 'Infrastructure', feature: 'DB migrations (001–008)', status: 'Shipped', size: 'S', impact: 'Core', origin: 'Discussed', notes: '006–008 need manual run in Supabase SQL editor' },
  { product: 'Infrastructure', feature: 'Merchant white-label', status: 'Later', size: 'M', impact: 'Revenue', origin: 'Suggested', notes: 'Custom sender domain; no Botiga branding; for higher tiers' },
  { product: 'Infrastructure', feature: 'Competitor price matching', status: 'Icebox', size: 'L', impact: 'Conversion', origin: 'Suggested', notes: 'Surface competitor prices mid-negotiation' },
];

const STATUSES = ['Shipped', 'Next', 'Backlog', 'Later', 'Icebox'];
const PRODUCTS = ['All', 'Shopify Widget', 'Merchant Dashboard', 'Admin Dashboard', 'Negotiation API', 'Email & Notifications', 'Shopify App', 'Infrastructure'];
const ORIGINS = ['All', 'Discussed', 'Suggested'];

const STATUS_STYLE = {
  Shipped:  { bg: 'bg-emerald-50',  border: 'border-emerald-200', dot: 'bg-emerald-500',  label: 'text-emerald-700',  count: 'bg-emerald-100 text-emerald-700' },
  Next:     { bg: 'bg-indigo-50',   border: 'border-indigo-200',  dot: 'bg-indigo-500',   label: 'text-indigo-700',   count: 'bg-indigo-100 text-indigo-700'  },
  Backlog:  { bg: 'bg-gray-50',     border: 'border-gray-200',    dot: 'bg-gray-400',     label: 'text-gray-600',     count: 'bg-gray-100 text-gray-600'      },
  Later:    { bg: 'bg-amber-50',    border: 'border-amber-200',   dot: 'bg-amber-400',    label: 'text-amber-700',    count: 'bg-amber-100 text-amber-700'    },
  Icebox:   { bg: 'bg-slate-50',    border: 'border-slate-200',   dot: 'bg-slate-400',    label: 'text-slate-600',    count: 'bg-slate-100 text-slate-600'    },
};

const PRODUCT_COLORS = {
  'Shopify Widget':      'bg-violet-100 text-violet-700',
  'Merchant Dashboard':  'bg-blue-100 text-blue-700',
  'Negotiation API':     'bg-orange-100 text-orange-700',
  'Email & Notifications': 'bg-pink-100 text-pink-700',
  'Shopify App':         'bg-green-100 text-green-700',
  'Admin Dashboard':     'bg-red-100 text-red-700',
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
            <span className="text-xs text-gray-400">Last updated Apr 21, 2026</span>
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
