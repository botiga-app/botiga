'use client';
import { useEffect, useRef, useState } from 'react';
import { createClient } from '../../../lib/supabase';

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
        widget_theme: null,
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

      {/* Widget theme — per-merchant colors that paint the chat widget */}
      <WidgetThemeSection theme={settings.widget_theme} botName={settings.bot_name} botAvatar={settings.bot_avatar_url} update={t => update({ widget_theme: t })} />

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

    </div>
  );
}

// ─── Widget theme — per-merchant colors painted onto the storefront widget
// via CSS custom properties. Saved as JSONB on merchant_settings.widget_theme;
// /api/widget/config returns it; the widget reads it at boot. Mirrors REP
// AI's white-label theming (Couture Candy red, Bluecorn dark/cream).
const THEME_PRESETS = [
  {
    name: 'Botiga (default)',
    theme: null, // null = built-in dark default
    swatch: 'linear-gradient(135deg,#6366f1,#ec4899)',
  },
  {
    name: 'Couture coral',
    theme: {
      primary: '#dc6b6b',
      primary_text: '#ffffff',
      surface: '#ffffff',
      surface_text: '#1f2937',
      bot_bubble_bg: '#f3f4f6',
      bot_bubble_text: '#1f2937',
      header_bg: '#dc6b6b',
      header_text: '#ffffff',
    },
    swatch: '#dc6b6b',
  },
  {
    name: 'Boutique cream',
    theme: {
      primary: '#1f2937',
      primary_text: '#ffffff',
      surface: '#fefcf6',
      surface_text: '#1f2937',
      bot_bubble_bg: '#f3eee0',
      bot_bubble_text: '#1f2937',
      header_bg: '#1f2937',
      header_text: '#fefcf6',
    },
    swatch: 'linear-gradient(135deg,#1f2937,#fefcf6)',
  },
  {
    name: 'Forest sage',
    theme: {
      primary: '#3f6f4e',
      primary_text: '#ffffff',
      surface: '#ffffff',
      surface_text: '#1f2937',
      bot_bubble_bg: '#eef4ef',
      bot_bubble_text: '#1f2937',
      header_bg: '#3f6f4e',
      header_text: '#ffffff',
    },
    swatch: '#3f6f4e',
  },
  {
    name: 'Indigo',
    theme: {
      primary: '#4f46e5',
      primary_text: '#ffffff',
      surface: '#ffffff',
      surface_text: '#1f2937',
      bot_bubble_bg: '#eef2ff',
      bot_bubble_text: '#1f2937',
      header_bg: '#4f46e5',
      header_text: '#ffffff',
    },
    swatch: '#4f46e5',
  },
];

function WidgetThemeSection({ theme, botName, botAvatar, update }) {
  const t = theme || {};
  const isCustom = theme && !THEME_PRESETS.some(p => JSON.stringify(p.theme) === JSON.stringify(theme));
  const activePreset = isCustom ? null : THEME_PRESETS.find(p => JSON.stringify(p.theme) === JSON.stringify(theme)) || THEME_PRESETS[0];

  function setField(k, v) {
    const next = { ...(theme || {}) };
    if (v == null || v === '') delete next[k];
    else next[k] = v;
    update(Object.keys(next).length ? next : null);
  }

  return (
    <Section title="Widget theme">
      <p className="text-xs text-gray-500 -mt-2">
        Brand colors painted onto your storefront chat widget. Pick a preset or customize each surface — changes apply on next page load for shoppers.
      </p>

      {/* Preset row */}
      <div>
        <label className="block text-xs font-semibold text-gray-600 mb-2">Preset</label>
        <div className="grid grid-cols-5 gap-2">
          {THEME_PRESETS.map(p => {
            const active = activePreset && p.name === activePreset.name;
            return (
              <button
                key={p.name}
                onClick={() => update(p.theme)}
                className={`p-2 rounded-xl border-2 text-left transition-all ${active ? 'border-indigo-500 bg-indigo-50' : 'border-gray-100 hover:border-gray-200'}`}
              >
                <div className="w-full h-8 rounded-lg mb-2" style={{ background: p.swatch }} />
                <div className="text-[11px] font-medium text-gray-800 leading-tight">{p.name}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Custom color pickers */}
      <div className="grid grid-cols-2 gap-3 pt-2">
        <ColorField label="Primary (buttons + your bubbles)" value={t.primary || ''} onChange={v => setField('primary', v)} placeholder="#dc6b6b" />
        <ColorField label="Primary text (on buttons)" value={t.primary_text || ''} onChange={v => setField('primary_text', v)} placeholder="#ffffff" />
        <ColorField label="Header background" value={t.header_bg || ''} onChange={v => setField('header_bg', v)} placeholder="#dc6b6b" />
        <ColorField label="Header text" value={t.header_text || ''} onChange={v => setField('header_text', v)} placeholder="#ffffff" />
        <ColorField label="Bot bubble background" value={t.bot_bubble_bg || ''} onChange={v => setField('bot_bubble_bg', v)} placeholder="#f3f4f6" />
        <ColorField label="Bot bubble text" value={t.bot_bubble_text || ''} onChange={v => setField('bot_bubble_text', v)} placeholder="#1f2937" />
        <ColorField label="Widget background" value={t.surface || ''} onChange={v => setField('surface', v)} placeholder="#ffffff" />
        <ColorField label="Widget text" value={t.surface_text || ''} onChange={v => setField('surface_text', v)} placeholder="#1f2937" />
      </div>

      <div className="pt-2">
        <label className="block text-xs font-semibold text-gray-600 mb-1">Font family (optional)</label>
        <input
          type="text"
          value={t.font_family || ''}
          onChange={e => setField('font_family', e.target.value)}
          placeholder="system-ui, -apple-system, sans-serif"
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
        />
        <p className="text-xs text-gray-400 mt-1">CSS font-family stack. Leave blank for the system default.</p>
      </div>

      {/* Live preview */}
      <div className="pt-3">
        <label className="block text-xs font-semibold text-gray-600 mb-2">Preview</label>
        <ThemePreview theme={t} botName={botName || 'Botiga'} botAvatar={botAvatar} />
      </div>
    </Section>
  );
}

function ColorField({ label, value, onChange, placeholder }) {
  // Color input requires a 7-char hex. Keep two inputs synchronized:
  // a swatch (color picker) and a text field (so users can paste/clear).
  const safe = /^#[0-9a-f]{6}$/i.test(value || '') ? value : '#ffffff';
  return (
    <div>
      <label className="block text-xs font-semibold text-gray-600 mb-1">{label}</label>
      <div className="flex gap-2 items-center">
        <input
          type="color"
          value={safe}
          onChange={e => onChange(e.target.value)}
          className="w-10 h-9 border border-gray-200 rounded-lg cursor-pointer"
        />
        <input
          type="text"
          value={value || ''}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-indigo-500"
        />
      </div>
    </div>
  );
}

// Mini-replica of the storefront concierge widget — header + two bubbles +
// a chip + send button — painted with the current theme tokens. Lets the
// merchant see the result without leaving the page.
function ThemePreview({ theme, botName, botAvatar }) {
  const t = theme || {};
  const primary = t.primary || 'linear-gradient(135deg,#6366f1,#ec4899)';
  const primaryText = t.primary_text || '#ffffff';
  const surface = t.surface || '#0c0c14';
  const surfaceText = t.surface_text || '#ffffff';
  const headerBg = t.header_bg || 'transparent';
  const headerText = t.header_text || surfaceText;
  const botBg = t.bot_bubble_bg || 'rgba(255,255,255,.07)';
  const botText = t.bot_bubble_text || surfaceText;
  const fontFamily = t.font_family || 'system-ui, -apple-system, sans-serif';

  return (
    <div
      style={{
        width: 320,
        background: surface,
        color: surfaceText,
        borderRadius: 16,
        border: '1px solid rgba(0,0,0,.06)',
        boxShadow: '0 12px 32px rgba(0,0,0,.08)',
        overflow: 'hidden',
        fontFamily,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', background: headerBg, color: headerText, borderBottom: '1px solid rgba(0,0,0,.05)' }}>
        <div style={{ width: 32, height: 32, borderRadius: '50%', background: primary, color: primaryText, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, overflow: 'hidden' }}>
          {botAvatar ? <img src={botAvatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : '🛍️'}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, fontWeight: 700 }}>{botName}</div>
          <div style={{ fontSize: 10, opacity: .65 }}>Here to help you shop</div>
        </div>
      </div>
      <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 8, minHeight: 140 }}>
        <div style={{ alignSelf: 'flex-start', background: botBg, color: botText, padding: '8px 12px', borderRadius: '14px 14px 14px 4px', fontSize: 12, maxWidth: '85%' }}>
          Hey there! What are you looking for today? ✨
        </div>
        <div style={{ alignSelf: 'flex-end', background: primary, color: primaryText, padding: '8px 12px', borderRadius: '14px 14px 4px 14px', fontSize: 12, maxWidth: '85%' }}>
          Show me dresses under $100
        </div>
        <div style={{ alignSelf: 'flex-start', background: botBg, color: botText, padding: '8px 12px', borderRadius: '14px 14px 14px 4px', fontSize: 12, maxWidth: '85%' }}>
          On it. <span style={{ fontStyle: 'italic', opacity: .65 }}>Searching the catalog…</span>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderTop: '1px solid rgba(0,0,0,.05)' }}>
        <div style={{ flex: 1, background: 'rgba(0,0,0,.04)', color: surfaceText, padding: '7px 10px', borderRadius: 12, fontSize: 12, opacity: .55 }}>Type anything here…</div>
        <div style={{ width: 30, height: 30, borderRadius: '50%', background: primary, color: primaryText, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13 }}>➤</div>
      </div>
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
