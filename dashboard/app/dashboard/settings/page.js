'use client';
import { useEffect, useRef, useState } from 'react';
import { createClient } from '../../../lib/supabase';
import TonePicker from '../../../components/TonePicker';
import ButtonCustomizer from '../../../components/ButtonCustomizer';
import BrokerFeeBreakdown from '../../../components/BrokerFeeBreakdown';

const API = process.env.NEXT_PUBLIC_API_URL || 'https://api.botiga.ai';

function Section({ title, children }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-6 space-y-4">
      <h3 className="font-semibold text-gray-900">{title}</h3>
      {children}
    </div>
  );
}

export default function SettingsPage() {
  const [settings, setSettings] = useState(null);
  const [savedSettings, setSavedSettings] = useState(null); // last persisted snapshot
  const [merchantId, setMerchantId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [aboutText, setAboutText] = useState('');
  const [generating, setGenerating] = useState(false);
  const supabase = createClient();

  const [exampleList, setExampleList] = useState(89);
  const [exampleFloor, setExampleFloor] = useState(72);

  const isDirty = settings && savedSettings &&
    JSON.stringify(settings) !== JSON.stringify(savedSettings);

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setMerchantId(user.id);
      const res = await fetch(`${API}/api/merchants/${user.id}`);
      if (res.ok) {
        const data = await res.json();
        const s = data.merchant_settings || {
          tone: 'friendly',
          button_label: 'Make an offer',
          button_color: null,
          button_text_color: null,
          button_position: 'below-cart',
          max_discount_pct: 20,
          floor_price_pct: null,
          floor_price_fixed: null,
          broker_fee_pct: 25,
          negotiate_on_product: true,
          negotiate_on_cart: true,
          recovery_enabled: true,
          recovery_channel: 'whatsapp',
          dwell_time_seconds: 30,
          proactive_delay: 7,
          proactive_message: '',
          auto_open_delay: 0,
          widget_type: 'bubble',
          show_trigger: 'always',
          chat_popup_delay: 0,
          cart_trigger: 'always',
          brand_value_statements: ['', '', '', '', ''],
          bot_name: null,
          bot_greeting: null,
          bot_avatar_url: null,
          bot_personality: 'salesy'
        };
        setSettings(s);
        setSavedSettings(s);
      }
    }
    load();
  }, []);

  async function save() {
    if (!isDirty || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`${API}/api/merchants/${merchantId}/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings)
      });
      if (res.ok) {
        setSavedSettings(settings);
        setJustSaved(true);
        setTimeout(() => setJustSaved(false), 2500);
      } else {
        const err = await res.json().catch(() => ({}));
        setSaveError(err.error || 'Save failed');
        setTimeout(() => setSaveError(null), 4000);
      }
    } catch {
      setSaveError('Network error');
      setTimeout(() => setSaveError(null), 4000);
    } finally {
      setSaving(false);
    }
  }

  function discard() {
    setSettings(savedSettings);
  }

  async function generateStatements() {
    if (!aboutText.trim()) return;
    setGenerating(true);
    try {
      const res = await fetch(`${API}/api/merchants/${merchantId}/generate-statements`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ about_text: aboutText })
      });
      if (res.ok) {
        const { statements } = await res.json();
        update({ brand_value_statements: statements });
      }
    } finally {
      setGenerating(false);
    }
  }

  function update(patch) {
    setSettings(s => ({ ...s, ...patch }));
  }

  if (!settings) {
    return <div className="p-8 text-gray-400 text-sm">Loading settings...</div>;
  }

  return (
    <div className="p-8 max-w-3xl space-y-6">

      {/* Floating unsaved-changes bar */}
      <div style={{
        position: 'fixed', top: 20, left: '50%',
        transform: `translateX(-50%) translateY(${isDirty || justSaved || saveError ? '0' : '-80px'})`,
        opacity: isDirty || justSaved || saveError ? 1 : 0,
        transition: 'transform .4s cubic-bezier(.34,1.56,.64,1), opacity .3s',
        background: justSaved ? '#16a34a' : saveError ? '#dc2626' : '#1a1a1a',
        color: 'white',
        padding: '10px 14px 10px 20px',
        borderRadius: 40,
        fontSize: 13, fontWeight: 500,
        display: 'flex', alignItems: 'center', gap: 10,
        boxShadow: '0 8px 32px rgba(0,0,0,.28)',
        zIndex: 9999, whiteSpace: 'nowrap',
        pointerEvents: isDirty || justSaved || saveError ? 'auto' : 'none'
      }}>
        {justSaved ? (
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>✓</span> Settings saved
          </span>
        ) : saveError ? (
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            ⚠ {saveError} — <button onClick={save} style={{ background: 'none', border: 'none', color: 'white', fontWeight: 700, cursor: 'pointer', textDecoration: 'underline', padding: 0 }}>Retry</button>
          </span>
        ) : (
          <>
            <span style={{ color: '#aaa' }}>Unsaved changes</span>
            <button onClick={discard} style={{
              background: 'rgba(255,255,255,.12)', border: 'none', color: 'white',
              padding: '5px 14px', borderRadius: 20, fontSize: 12, fontWeight: 600,
              cursor: 'pointer'
            }}>Discard</button>
            <button onClick={save} disabled={saving} style={{
              background: 'white', border: 'none', color: '#1a1a1a',
              padding: '5px 18px', borderRadius: 20, fontSize: 12, fontWeight: 700,
              cursor: saving ? 'default' : 'pointer', opacity: saving ? .7 : 1,
              display: 'flex', alignItems: 'center', gap: 6
            }}>
              {saving ? <><span style={{
                width: 10, height: 10, border: '2px solid #999',
                borderTopColor: '#333', borderRadius: '50%', display: 'inline-block',
                animation: 'bspin .7s linear infinite'
              }}/>Saving…</> : 'Save'}
            </button>
          </>
        )}
      </div>
      <style>{`@keyframes bspin { to { transform: rotate(360deg); } }`}</style>

      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Bot Settings</h2>
          <p className="text-sm text-gray-500">Configure your negotiation bot</p>
        </div>
      </div>

      {/* AI Shopping Assistant */}
      <Section title="AI Shopping Assistant">
        <div className="space-y-4">
          <div className="flex gap-4 items-start">
            {settings.bot_avatar_url ? (
              <img src={settings.bot_avatar_url} alt="" className="w-14 h-14 rounded-full object-cover border-2 border-indigo-100 flex-shrink-0" />
            ) : (
              <div className="w-14 h-14 rounded-full bg-gradient-to-br from-indigo-500 to-pink-500 flex items-center justify-center text-2xl flex-shrink-0">🛍️</div>
            )}
            <div className="flex-1 space-y-3">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Avatar image URL</label>
                <input type="url" value={settings.bot_avatar_url || ''} onChange={e => update({ bot_avatar_url: e.target.value || null })}
                  placeholder="https://your-store.com/logo.png" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500" />
                <p className="text-xs text-gray-400 mt-1">Paste your store logo URL. Will appear as a circular avatar next to the chat.</p>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Bot name</label>
                <input type="text" value={settings.bot_name || ''} onChange={e => update({ bot_name: e.target.value || null })}
                  placeholder="e.g. Lily, Max, Sage…" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500" />
              </div>
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Opening greeting</label>
            <textarea value={settings.bot_greeting || ''} onChange={e => update({ bot_greeting: e.target.value || null })} rows={2}
              placeholder="Hi! 👋 What can I help you find today?" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500 resize-none" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-2">Chat personality</label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { value: 'salesy', label: '🔥 Salesy', sub: 'Enthusiastic, highlights benefits, creates urgency' },
                { value: 'friendly', label: '😊 Friendly', sub: 'Warm, helpful, conversational' },
                { value: 'expert', label: '🎓 Expert', sub: 'Knowledgeable, precise, trusted advisor' },
                { value: 'playful', label: '✨ Playful', sub: 'Fun, upbeat, light humor' },
              ].map(opt => (
                <button key={opt.value} onClick={() => update({ bot_personality: opt.value })}
                  className={`p-3 rounded-xl border-2 text-left transition-all ${(settings.bot_personality || 'salesy') === opt.value ? 'border-indigo-500 bg-indigo-50' : 'border-gray-100 hover:border-gray-200'}`}>
                  <div className="text-sm font-semibold text-gray-800">{opt.label}</div>
                  <div className="text-xs text-gray-400 mt-0.5">{opt.sub}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </Section>

      {/* Bot Personality */}
      <Section title="Negotiation Bot Personality">
        <TonePicker value={settings.tone} onChange={tone => update({ tone })} />
      </Section>

      {/* Button Customization */}
      <Section title="Button Customization">
        <ButtonCustomizer
          label={settings.button_label}
          color={settings.button_color}
          textColor={settings.button_text_color}
          position={settings.button_position}
          onChange={patch => update({
            ...(patch.label !== undefined ? { button_label: patch.label } : {}),
            ...(patch.color !== undefined ? { button_color: patch.color } : {}),
            ...(patch.textColor !== undefined ? { button_text_color: patch.textColor } : {}),
            ...(patch.position !== undefined ? { button_position: patch.position } : {})
          })}
        />
      </Section>

      {/* Pricing Rules */}
      <Section title="Pricing Rules">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Max discount % <span className="text-gray-400 font-normal">(off list price)</span>
            </label>
            <div className="flex items-center gap-3">
              <input type="range" min={0} max={50} step={1}
                value={settings.max_discount_pct || 20}
                onChange={e => update({ max_discount_pct: Number(e.target.value) })}
                className="flex-1" />
              <span className="text-sm font-semibold w-10 text-right">{settings.max_discount_pct || 20}%</span>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Floor price — fixed $</label>
            <input type="number" min={0} step={0.01}
              value={settings.floor_price_fixed || ''}
              onChange={e => update({ floor_price_fixed: e.target.value ? Number(e.target.value) : null })}
              placeholder="e.g. 49.99"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500" />
          </div>
        </div>

        <div className="mt-4">
          <p className="text-xs text-gray-500 mb-3 font-medium uppercase tracking-wide">Broker fee calculator</p>
          <div className="grid grid-cols-2 gap-4 mb-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Example list price ($)</label>
              <input type="number" value={exampleList} onChange={e => setExampleList(Number(e.target.value))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Example floor price ($)</label>
              <input type="number" value={exampleFloor} onChange={e => setExampleFloor(Number(e.target.value))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500" />
            </div>
          </div>
          <BrokerFeeBreakdown
            listPrice={exampleList}
            floorPrice={exampleFloor}
            brokerFeePct={settings.broker_fee_pct || 25}
          />
        </div>
      </Section>

      {/* Brand Story */}
      <Section title="Your brand story">
        <p className="text-xs text-gray-500">Write 3–5 reasons why customers should pay full price. The bot uses these as justifications when making offers — e.g. "I can do $199 — <em>hand-finished by artisans, not mass produced</em>."</p>
        <div className="space-y-2">
          {(settings.brand_value_statements || ['', '', '', '', '']).map((s, i) => (
            <input
              key={i}
              type="text"
              value={s}
              onChange={e => {
                const arr = [...(settings.brand_value_statements || ['', '', '', '', ''])];
                arr[i] = e.target.value;
                update({ brand_value_statements: arr });
              }}
              placeholder={[
                'Hand-finished by artisans — not mass produced',
                'Free returns within 30 days, no questions asked',
                'Only 3 left in this size',
                'Ships within 24 hours from our warehouse',
                'Sustainably sourced fabric, certified ethical'
              ][i]}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
            />
          ))}
        </div>
        <div className="pt-2 border-t border-gray-100">
          <p className="text-xs text-gray-500 mb-2">Or paste your About Us page and auto-generate:</p>
          <textarea
            value={aboutText}
            onChange={e => setAboutText(e.target.value)}
            placeholder="Paste your About Us page text here..."
            rows={3}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500 resize-none"
          />
          <button
            onClick={generateStatements}
            disabled={generating || !aboutText.trim()}
            className="mt-2 text-sm bg-indigo-50 text-indigo-700 border border-indigo-200 px-4 py-2 rounded-lg hover:bg-indigo-100 disabled:opacity-50"
          >
            {generating ? 'Generating...' : '✨ Auto-generate from text'}
          </button>
          {settings.brand_value_statements?.filter(Boolean).length > 0 && (
            <div className="mt-3 p-3 bg-gray-50 rounded-lg">
              <p className="text-xs font-medium text-gray-600 mb-1">Preview in bot message:</p>
              <p className="text-xs text-gray-500 italic">
                "I can do $199 — {settings.brand_value_statements.find(Boolean)}."
              </p>
            </div>
          )}
        </div>
      </Section>

      {/* Widget behaviour */}
      <Section title="Widget behaviour">
        <div className="space-y-6">

          {/* Type */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">How it looks</label>
            <div className="grid grid-cols-3 gap-3">
              {[
                { value: 'bubble', label: '💬 Bubble', sub: 'Floating circle, bottom right' },
                { value: 'button', label: '🔘 Button', sub: 'Sits below Add to Cart' },
                { value: 'banner', label: '📢 Banner', sub: 'Pinned bar across the top' },
              ].map(opt => (
                <button key={opt.value} onClick={() => update({ widget_type: opt.value })}
                  className={`p-3 rounded-xl border-2 text-left transition-all ${settings.widget_type === opt.value ? 'border-indigo-500 bg-indigo-50' : 'border-gray-100 hover:border-gray-200'}`}>
                  <div className="text-sm font-semibold text-gray-800">{opt.label}</div>
                  <div className="text-xs text-gray-400 mt-0.5">{opt.sub}</div>
                </button>
              ))}
            </div>
          </div>

          {/* When the chat opens */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">When the chat opens</label>
            <div className="grid grid-cols-2 gap-3">
              {[
                { value: 0, label: 'Right away', sub: 'Chat opens the moment the widget appears' },
                { value: -1, label: 'After a delay', sub: 'Widget appears first, then typing animation, then chat' },
              ].map(opt => (
                <button key={opt.value} onClick={() => update({ chat_popup_delay: opt.value === -1 ? (settings.chat_popup_delay > 0 ? settings.chat_popup_delay : 10) : 0 })}
                  className={`p-3 rounded-xl border-2 text-left transition-all ${(opt.value === 0 ? settings.chat_popup_delay === 0 : settings.chat_popup_delay > 0) ? 'border-indigo-500 bg-indigo-50' : 'border-gray-100 hover:border-gray-200'}`}>
                  <div className="text-sm font-semibold text-gray-800">{opt.label}</div>
                  <div className="text-xs text-gray-400 mt-0.5">{opt.sub}</div>
                </button>
              ))}
            </div>
            {settings.chat_popup_delay > 0 && (
              <div className="mt-3 pl-1">
                <label className="text-xs text-gray-500">Open after <strong>{settings.chat_popup_delay}s</strong></label>
                <input type="range" min={3} max={60} step={1}
                  value={settings.chat_popup_delay}
                  onChange={e => update({ chat_popup_delay: Number(e.target.value) })}
                  className="w-full max-w-xs mt-1" />
              </div>
            )}
          </div>

          {/* When to appear */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">When to appear</label>
            <div className="grid grid-cols-2 gap-3">
              {[
                { value: 'always',   label: 'Right away',           sub: 'Shows as soon as the page loads' },
                { value: 'on_scroll', label: 'When they\'ve read enough', sub: 'Appears after scrolling 60% down' },
                { value: 'on_exit',  label: 'When they\'re leaving', sub: 'Last chance before they close the tab' },
                { value: 'on_click', label: 'Only when tapped',     sub: 'Visible but opens only on click' },
              ].map(opt => (
                <button key={opt.value} onClick={() => update({ show_trigger: opt.value })}
                  className={`p-3 rounded-xl border-2 text-left transition-all ${settings.show_trigger === opt.value ? 'border-indigo-500 bg-indigo-50' : 'border-gray-100 hover:border-gray-200'}`}>
                  <div className="text-sm font-semibold text-gray-800">{opt.label}</div>
                  <div className="text-xs text-gray-400 mt-0.5">{opt.sub}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Opening message */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">What to say when the widget opens</label>
            <input
              type="text"
              value={settings.proactive_message || ''}
              onChange={e => update({ proactive_message: e.target.value })}
              placeholder="Still eyeing this? I might be able to work on the price…"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
            />
            <p className="text-xs text-gray-400 mt-1">Shown as the first message when the chat opens. Leave blank for the default greeting.</p>
          </div>

          {/* CTA label */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Button label</label>
            <input
              type="text"
              value={settings.button_label || ''}
              onChange={e => update({ button_label: e.target.value })}
              placeholder="Make an offer"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
            />
            <p className="text-xs text-gray-400 mt-1">The text on the negotiate button customers see on product pages.</p>
          </div>

          {/* On cart */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">On the cart page</label>
            <div className="grid grid-cols-2 gap-3">
              {[
                { value: 'always',   label: 'Always show',         sub: 'Widget appears whenever they visit cart' },
                { value: 'on_exit',  label: 'Only when leaving',   sub: 'Last chance to save the sale' },
              ].map(opt => (
                <button key={opt.value} onClick={() => update({ cart_trigger: opt.value })}
                  className={`p-3 rounded-xl border-2 text-left transition-all ${settings.cart_trigger === opt.value ? 'border-indigo-500 bg-indigo-50' : 'border-gray-100 hover:border-gray-200'}`}>
                  <div className="text-sm font-semibold text-gray-800">{opt.label}</div>
                  <div className="text-xs text-gray-400 mt-0.5">{opt.sub}</div>
                </button>
              ))}
            </div>
            {settings.cart_trigger === 'always' && (
              <div className="mt-3 pl-1">
                <label className="text-xs text-gray-500">Cart max discount: <strong>{settings.cart_max_discount_pct || 10}%</strong></label>
                <input type="range" min={1} max={30} step={1}
                  value={settings.cart_max_discount_pct || 10}
                  onChange={e => update({ cart_max_discount_pct: Number(e.target.value) })}
                  className="w-full max-w-xs mt-1" />
              </div>
            )}
          </div>

        </div>
      </Section>

      {/* Recovery */}
      <Section title="Abandoned deal recovery">
        <div className="space-y-4">
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" checked={settings.recovery_enabled}
              onChange={e => update({ recovery_enabled: e.target.checked })}
              className="w-4 h-4 rounded text-indigo-600" />
            <div>
              <div className="text-sm font-medium text-gray-700">Send follow-ups when a deal is left at checkout</div>
              <div className="text-xs text-gray-400">Customer got a price but didn't complete the order</div>
            </div>
          </label>
          {settings.recovery_enabled && (
            <div className="pl-7">
              <label className="block text-sm text-gray-600 mb-2">Send via</label>
              <div className="flex gap-3">
                {['whatsapp', 'email', 'both'].map(ch => (
                  <label key={ch} className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" name="recovery_channel" value={ch}
                      checked={settings.recovery_channel === ch}
                      onChange={() => update({ recovery_channel: ch })}
                      className="text-indigo-600" />
                    <span className="text-sm text-gray-600 capitalize">{ch === 'both' ? 'WhatsApp + Email' : ch}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
      </Section>
    </div>
  );
}
