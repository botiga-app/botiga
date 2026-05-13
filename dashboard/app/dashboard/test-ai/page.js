'use client';
import { useEffect, useRef, useState } from 'react';
import { createClient } from '../../../lib/supabase';

const API = process.env.NEXT_PUBLIC_API_URL || 'https://api.botiga.ai';

// Test AI page — gives merchants a chat surface to validate their bot
// before customers see it. Mirrors Chatty's "Test AI" with a sources panel
// that shows exactly which products / directives / brand statements the
// AI reached for. The conversation hits the same /api/concierge/message
// endpoint the storefront widget uses, so what you see here is what
// shoppers will see live.
export default function TestAIPage() {
  const [merchantId, setMerchantId] = useState(null);
  const [apiKey, setApiKey] = useState(null);
  const [bootError, setBootError] = useState(null);
  const [messages, setMessages] = useState([]);  // { role: 'user'|'bot', content, sources?, matches? }
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [activeSourcesIdx, setActiveSourcesIdx] = useState(null);
  const sessionRef = useRef('test_' + Math.random().toString(36).slice(2));
  const scrollRef = useRef(null);
  const supabase = createClient();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || cancelled) return;
      setMerchantId(user.id);
      const r = await fetch(`${API}/api/merchants/${user.id}`);
      if (!r.ok || cancelled) { setBootError('Could not load merchant'); return; }
      const m = await r.json();
      if (!m.api_key) { setBootError('No API key — connect Shopify first.'); return; }
      setApiKey(m.api_key);
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  function newConversation() {
    setMessages([]);
    sessionRef.current = 'test_' + Math.random().toString(36).slice(2);
    setActiveSourcesIdx(null);
  }

  async function send() {
    const text = input.trim();
    if (!text || !apiKey || sending) return;
    setInput('');
    const userMsg = { role: 'user', content: text };
    setMessages(m => [...m, userMsg]);
    setSending(true);

    try {
      // Run product-search alongside concierge so the Sources panel can
      // show what products the AI saw — concierge/message doesn't always
      // return matches when the response is conversational.
      const [searchRes, replyRes] = await Promise.all([
        fetch(`${API}/api/widget/product-search`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ k: apiKey, query: text, limit: 6 }),
        }).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch(`${API}/api/concierge/message`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
          body: JSON.stringify({
            session_id: sessionRef.current,
            customer_message: text,
            trigger: 'user',
            page_context: { page_type: 'test' },
          }),
        }).then(r => r.json()).catch(err => ({ error: err.message })),
      ]);

      const botContent = replyRes?.reply || replyRes?.error || "(No reply)";
      const sources = {
        matches: replyRes?.matches || [],
        featured_deal: replyRes?.featured_deal || null,
        searched_products: searchRes?.products || [],
        catalog_total: searchRes?.diagnostics?.catalog_total ?? null,
        catalog_in_stock: searchRes?.diagnostics?.catalog_in_stock ?? null,
        directives_active: searchRes?.diagnostics?.directives_active ?? null,
        filter: searchRes?.filter || null,
      };
      setMessages(m => [...m, { role: 'bot', content: botContent, sources }]);
    } catch (err) {
      setMessages(m => [...m, { role: 'bot', content: 'Error: ' + err.message, sources: null }]);
    } finally {
      setSending(false);
    }
  }

  function onKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  }

  if (bootError) {
    return (
      <div className="p-8 max-w-3xl">
        <h2 className="text-xl font-bold text-gray-900 mb-2">Test AI</h2>
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
          {bootError} <a href="/dashboard/install" className="underline font-semibold">Open Install →</a>
        </div>
      </div>
    );
  }

  const STARTER_PROMPTS = [
    'What\'s recommended?',
    'Show me dresses under $100',
    'Do you have anything in red?',
    'What\'s on sale?',
    'Track my order',
  ];

  return (
    <div className="p-8 max-w-6xl space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Test AI</h2>
          <p className="text-sm text-gray-500">Chat with your storefront concierge. Click <span className="font-semibold">Review sources</span> on any reply to see exactly what the AI looked at.</p>
        </div>
        <button
          onClick={newConversation}
          className="flex-shrink-0 px-4 py-2 border border-gray-200 hover:bg-gray-50 text-gray-700 text-sm font-medium rounded-lg transition-colors"
        >
          🔄 New conversation
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4">
        {/* Chat surface */}
        <div className="bg-white rounded-xl border border-gray-100 flex flex-col" style={{ height: '70vh', minHeight: 480 }}>
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-5 space-y-3">
            {messages.length === 0 && (
              <div className="text-center py-8 space-y-4">
                <div className="text-4xl">💬</div>
                <div className="text-sm text-gray-500">Try a starter prompt or type your own.</div>
                <div className="flex flex-wrap gap-2 justify-center">
                  {STARTER_PROMPTS.map(p => (
                    <button
                      key={p}
                      onClick={() => { setInput(p); setTimeout(send, 0); }}
                      className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs rounded-full"
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] ${m.role === 'user' ? '' : 'space-y-1.5'}`}>
                  <div
                    className={`px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
                      m.role === 'user'
                        ? 'bg-indigo-600 text-white rounded-br-md'
                        : 'bg-gray-100 text-gray-900 rounded-bl-md'
                    }`}
                  >
                    {m.content}
                  </div>
                  {m.role === 'bot' && m.sources && <InlineProductCards sources={m.sources} />}
                  {m.role === 'bot' && m.sources && (
                    <button
                      onClick={() => setActiveSourcesIdx(activeSourcesIdx === i ? null : i)}
                      className="text-xs text-indigo-600 hover:text-indigo-700 px-1 font-medium"
                    >
                      {activeSourcesIdx === i ? 'Hide sources ↑' : 'Review sources ↓'}
                    </button>
                  )}
                </div>
              </div>
            ))}
            {sending && (
              <div className="flex justify-start">
                <div className="bg-gray-100 rounded-2xl px-3.5 py-2.5 rounded-bl-md">
                  <Dots />
                </div>
              </div>
            )}
          </div>
          {/* Input */}
          <div className="border-t border-gray-100 p-3 flex items-center gap-2">
            <input
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={onKey}
              placeholder="Type a customer message…"
              disabled={sending || !apiKey}
              className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500 disabled:bg-gray-50"
            />
            <button
              onClick={send}
              disabled={sending || !input.trim() || !apiKey}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white text-sm font-medium rounded-lg"
            >
              Send
            </button>
          </div>
        </div>

        {/* Sources panel */}
        <div className="bg-white rounded-xl border border-gray-100 p-5 overflow-y-auto" style={{ height: '70vh', minHeight: 480 }}>
          {activeSourcesIdx === null || !messages[activeSourcesIdx]?.sources ? (
            <div className="text-center text-gray-400 text-sm pt-12 space-y-3">
              <div className="text-3xl">🔎</div>
              <div>Click <span className="font-semibold text-gray-600">Review sources</span> on any reply to see what the AI used to answer.</div>
            </div>
          ) : (
            <SourcesPanel sources={messages[activeSourcesIdx].sources} />
          )}
        </div>
      </div>
    </div>
  );
}

function SourcesPanel({ sources }) {
  return (
    <div className="space-y-5">
      <div>
        <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Catalog</div>
        <div className="text-sm text-gray-700 mt-1">
          {sources.catalog_in_stock ?? '—'} of {sources.catalog_total ?? '—'} products available · {sources.directives_active ?? 0} active directive{sources.directives_active === 1 ? '' : 's'}
        </div>
      </div>

      {sources.filter && Object.keys(sources.filter).length > 0 && (
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Parsed query</div>
          <pre className="text-xs bg-gray-50 rounded-lg p-3 mt-1 overflow-x-auto text-gray-700 font-mono">
{JSON.stringify(sources.filter, null, 2)}
          </pre>
        </div>
      )}

      {sources.featured_deal && (
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Featured deal cited</div>
          <div className="mt-1 p-3 bg-amber-50 border border-amber-100 rounded-lg flex gap-3 items-center">
            {sources.featured_deal.image_url && (
              <img src={sources.featured_deal.image_url} alt="" className="w-12 h-12 rounded object-cover flex-shrink-0" />
            )}
            <div className="min-w-0">
              <div className="text-sm font-medium text-gray-900 truncate">{sources.featured_deal.title || sources.featured_deal.name}</div>
              <div className="text-xs text-gray-500">${Number(sources.featured_deal.price || 0).toFixed(0)}</div>
            </div>
          </div>
        </div>
      )}

      {sources.searched_products && sources.searched_products.length > 0 && (
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Top products considered ({sources.searched_products.length})</div>
          <div className="space-y-1.5 mt-1">
            {sources.searched_products.slice(0, 6).map(p => (
              <div key={p.id} className="flex items-center gap-2.5 p-2 bg-gray-50 rounded-lg">
                {p.image_url ? <img src={p.image_url} alt="" className="w-9 h-9 rounded object-cover flex-shrink-0" /> : <div className="w-9 h-9 rounded bg-gray-200 flex-shrink-0" />}
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-gray-900 truncate">{p.title}</div>
                  <div className="text-[11px] text-gray-500 truncate">${Number(p.price || 0).toFixed(0)} · {p.product_type || 'product'}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {sources.matches && sources.matches.length > 0 && (
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">LLM-matched products ({sources.matches.length})</div>
          <div className="space-y-1.5 mt-1">
            {sources.matches.slice(0, 6).map((m, i) => (
              <div key={i} className="text-xs text-gray-700 p-2 bg-emerald-50 rounded-lg">
                {m.title || m.name || JSON.stringify(m)}
              </div>
            ))}
          </div>
        </div>
      )}

      {(!sources.searched_products || sources.searched_products.length === 0) &&
       (!sources.matches || sources.matches.length === 0) &&
       !sources.featured_deal && (
        <div className="text-xs text-gray-400 italic">
          No products were referenced for this reply — likely a conversational/utility answer (greeting, capture, track-order, etc.).
        </div>
      )}
    </div>
  );
}

// Inline product cards beneath bot replies — mirrors the storefront widget's
// horizontal carousel so merchants can see what customers actually see.
// Prefers what the bot chose to surface (featured_deal + matches). Falls
// back to product-search results so the test surface still signals
// retrievable products even when the bot's reply skipped them.
function InlineProductCards({ sources }) {
  const primary = [];
  if (sources.featured_deal) primary.push(sources.featured_deal);
  (sources.matches || []).forEach(p => primary.push(p));
  const withData = primary.filter(p => p.image_url || p.image || p.price);
  const fallback = (sources.searched_products || []).filter(p => p.image_url || p.image);

  const cards = withData.length ? withData : fallback;
  const isFallback = !withData.length && fallback.length > 0;
  if (!cards.length) return null;

  return (
    <div className="space-y-1">
      {isFallback && (
        <div className="text-[10px] text-amber-700 italic">
          Bot didn't surface these — showing retrievable products
        </div>
      )}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {cards.slice(0, 6).map((p, i) => <InlineProductCard key={p.id || p.shopify_product_id || i} p={p} />)}
      </div>
    </div>
  );
}

function InlineProductCard({ p }) {
  const img = p.image_url || p.image;
  const title = p.title || p.product_name || p.name || '';
  const price = Number(p.price || 0);
  const compare = Number(p.compare_at_price || 0);
  const onSale = compare > price && compare > 0;
  const pct = onSale ? Math.round((1 - price / compare) * 100) : 0;
  const href = p.product_url || p.url || (p.handle ? `/products/${p.handle}` : null);

  const inner = (
    <>
      {img ? (
        <img src={img} alt="" className="w-full h-32 object-cover" />
      ) : (
        <div className="w-full h-32 bg-gray-100" />
      )}
      <div className="p-2">
        <div className="text-xs font-medium text-gray-900 leading-snug line-clamp-2" style={{ minHeight: '2.4em' }}>
          {title}
        </div>
        <div className="mt-1 flex items-baseline gap-1.5">
          <span className="text-xs font-semibold text-gray-900">${price.toFixed(0)}</span>
          {onSale && <span className="text-[10px] text-gray-400 line-through">${compare.toFixed(0)}</span>}
          {onSale && <span className="text-[10px] font-semibold text-emerald-600">−{pct}%</span>}
        </div>
      </div>
    </>
  );

  const cls = "flex-shrink-0 w-36 bg-white border border-gray-200 rounded-xl overflow-hidden hover:border-indigo-300 transition-colors";
  return href
    ? <a href={href} target="_blank" rel="noreferrer" className={cls}>{inner}</a>
    : <div className={cls}>{inner}</div>;
}

function Dots() {
  return (
    <span className="inline-flex gap-1 items-end h-4">
      <span className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
      <span className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '120ms' }} />
      <span className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '240ms' }} />
    </span>
  );
}
