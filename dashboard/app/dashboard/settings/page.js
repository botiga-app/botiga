'use client';
import { useEffect, useRef, useState } from 'react';
import { createClient } from '../../../lib/supabase';
import ButtonCustomizer from '../../../components/ButtonCustomizer';

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
  const supabase = createClient();


  const isDirty = settings && savedSettings &&
    JSON.stringify(settings) !== JSON.stringify(savedSettings);

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setMerchantId(user.id);

      const DEFAULTS = {
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
        bot_personality: 'salesy',
      };

      try {
        const res = await fetch(`${API}/api/merchants/${user.id}`);
        if (res.ok) {
          const data = await res.json();
          // merchant_settings can come back as an object, an array of one, or null/undefined
          const raw = Array.isArray(data.merchant_settings)
            ? data.merchant_settings[0]
            : data.merchant_settings;
          const s = { ...DEFAULTS, ...(raw || {}) };
          setSettings(s);
          setSavedSettings(s);
          return;
        }
      } catch (err) {
        console.warn('[settings] load failed, using defaults:', err.message);
      }
      // Fallback: load defaults so the page is interactive even if API is down
      setSettings(DEFAULTS);
      setSavedSettings(DEFAULTS);
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
          <h2 className="text-xl font-bold text-gray-900">Concierge bot</h2>
          <p className="text-sm text-gray-500">Bot persona, widget appearance, and proactive trigger behavior.</p>
        </div>
      </div>

      {/* Brand profile — captured during onboarding, editable here */}
      {merchantId && <BrandProfileSection merchantId={merchantId} />}

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

      {/* Negotiation settings moved — pointer card */}
      <a href="/dashboard/rules" className="block bg-gradient-to-br from-amber-50 to-orange-50 border border-amber-200 rounded-2xl p-5 hover:from-amber-100 hover:to-orange-100 transition-colors">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-bold text-gray-900 flex items-center gap-2">
              <span>🤝</span> Negotiation settings have moved
            </div>
            <div className="text-xs text-gray-600 mt-1">
              Tone, max discount, floor price, broker fee, brand-story justifications, recovery, and per-product rules now live under <strong>Negotiation bot</strong>.
            </div>
          </div>
          <span className="text-amber-700 font-semibold text-sm flex-shrink-0">Open →</span>
        </div>
      </a>

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

    </div>
  );
}

// ─── Brand profile (merchant table fields, captured during onboarding) ──────
function BrandProfileSection({ merchantId }) {
  const [profile, setProfile] = useState(null);
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await fetch(`${API}/api/merchants/${merchantId}`);
      if (!r.ok || cancelled) return;
      const m = await r.json();
      const p = {
        name: m.name || '',
        website_url: m.website_url || '',
        ig_handle: m.ig_handle || '',
        shopify_domain: m.shopify_domain || '',
        shopify_connected: !!m.shopify_access_token,
      };
      setProfile(p);
      setDraft(p);
    })();
    return () => { cancelled = true; };
  }, [merchantId]);

  const isDirty = profile && draft && (
    profile.name !== draft.name ||
    profile.website_url !== draft.website_url ||
    profile.ig_handle !== draft.ig_handle
  );

  async function save() {
    if (!isDirty || saving) return;
    setSaving(true);
    setError(null);
    try {
      const r = await fetch(`${API}/api/onboarding/save-step`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          merchant_id: merchantId,
          data: {
            name: draft.name,
            website_url: draft.website_url,
            source_url: draft.website_url, // mirror for storeContext
            ig_handle: draft.ig_handle.replace(/^@/, ''),
          },
        }),
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${r.status}`);
      }
      setProfile(draft);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1800);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (!profile) {
    return (
      <Section title="Brand profile">
        <div className="text-sm text-gray-400">Loading…</div>
      </Section>
    );
  }

  return (
    <Section title="Brand profile">
      <p className="text-xs text-gray-500 -mt-2 mb-2">
        Captured during onboarding. The bot uses your store URL to read collections, promos, and policies live.
      </p>
      <div className="space-y-4">
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">Brand name</label>
          <input
            type="text"
            value={draft.name}
            onChange={e => setDraft({ ...draft, name: e.target.value })}
            placeholder="Willow House"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">Store URL</label>
          <input
            type="url"
            value={draft.website_url}
            onChange={e => setDraft({ ...draft, website_url: e.target.value })}
            placeholder="https://yourstore.com"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">Instagram handle</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">@</span>
            <input
              type="text"
              value={draft.ig_handle.replace(/^@/, '')}
              onChange={e => setDraft({ ...draft, ig_handle: e.target.value })}
              placeholder="willow_house"
              className="w-full border border-gray-200 rounded-lg pl-7 pr-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
            />
          </div>
          <p className="text-xs text-gray-400 mt-1">Powers the one-click Auto-import latest reels button on the Videos page.</p>
        </div>
        <div className="pt-3 border-t border-gray-100">
          <label className="block text-xs font-semibold text-gray-600 mb-1">Shopify connection</label>
          {profile.shopify_connected ? (
            <div className="flex items-center gap-2 text-sm">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              <span className="text-gray-700 font-medium">{profile.shopify_domain}</span>
              <span className="text-xs text-gray-400">— connected</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm">
              <span className="w-2 h-2 rounded-full bg-gray-300" />
              <span className="text-gray-500">Not connected</span>
              <a href="/onboarding" className="text-xs text-indigo-600 hover:underline ml-2">Connect now →</a>
            </div>
          )}
        </div>
        <div className="flex items-center gap-3 pt-2">
          <button
            onClick={save}
            disabled={!isDirty || saving}
            className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-40"
          >
            {saving ? 'Saving…' : 'Save brand profile'}
          </button>
          {savedFlash && <span className="text-xs text-emerald-600 font-medium">✓ Saved</span>}
          {error && <span className="text-xs text-red-600">{error}</span>}
        </div>
      </div>
    </Section>
  );
}
