'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '../../lib/supabase';

const API = process.env.NEXT_PUBLIC_API_URL || 'https://api.botiga.ai';

// 4-step wizard: URL → Install → Bot persona → Live progress (auto-fires).
// Total target time: under 2 minutes. Step 4 is TurboTax-style live progress
// that runs the heavy lifting (bot setup, IG pull, auto-tag, feed widget)
// while the merchant watches it tick through, sequentially.
export default function OnboardingPage() {
  const router = useRouter();
  const supabase = createClient();
  const [user, setUser] = useState(null);
  const [merchant, setMerchant] = useState(null);
  const [step, setStep] = useState(1);

  // Step 1
  const [url, setUrl] = useState('');
  const [detecting, setDetecting] = useState(false);
  const [detected, setDetected] = useState(null);
  const [editIg, setEditIg] = useState(false);
  const [editName, setEditName] = useState(false);
  const [step1Error, setStep1Error] = useState(null);

  // Step 2
  const [installPath, setInstallPath] = useState(null);
  const [devStoreUrl, setDevStoreUrl] = useState('');
  const [installOpened, setInstallOpened] = useState(false);
  const installCheckInterval = useRef(null);

  // Step 3 — bot persona
  const [botName, setBotName] = useState('');
  const [botAvatar, setBotAvatar] = useState(PRESET_AVATARS[0].url);
  const [customAvatarUrl, setCustomAvatarUrl] = useState('');

  useEffect(() => {
    async function bootstrap() {
      const { data: { user: u } } = await supabase.auth.getUser();
      if (!u) { router.push('/login'); return; }
      setUser(u);
      const r = await fetch(`${API}/api/merchants/${u.id}`);
      if (r.ok) {
        const m = await r.json();
        setMerchant(m);
        if (m.onboarding_completed_at) { router.push('/dashboard'); return; }
        if (m.shopify_domain && m.shopify_access_token) setStep(3);
        else if (m.website_url) setStep(2);
        else setStep(1);
        if (m.website_url) setUrl(m.website_url);
      }
    }
    bootstrap();
    return () => { if (installCheckInterval.current) clearInterval(installCheckInterval.current); };
  }, []);

  // Default bot name from store name once detected
  useEffect(() => {
    if (!botName && (detected?.brand_name || merchant?.name)) {
      const brand = detected?.brand_name || merchant?.name || '';
      setBotName(brand ? `${brand.split(' ')[0]} Bot` : 'Shop Assistant');
    }
  }, [detected?.brand_name, merchant?.name]);

  function startInstallPolling() {
    if (installCheckInterval.current) clearInterval(installCheckInterval.current);
    installCheckInterval.current = setInterval(async () => {
      if (!user) return;
      const r = await fetch(`${API}/api/merchants/${user.id}`);
      if (!r.ok) return;
      const m = await r.json();
      if (m.shopify_access_token) {
        setMerchant(m);
        clearInterval(installCheckInterval.current);
        installCheckInterval.current = null;
        setStep(3);
      }
    }, 3000);
  }

  async function detectStore() {
    if (!url.trim()) return;
    setDetecting(true);
    setDetected(null);
    try {
      const r = await fetch(`${API}/api/onboarding/detect-store`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const data = await r.json();
      setDetected(data);
    } catch (err) {
      setDetected({ reachable: false, error: err.message });
    } finally {
      setDetecting(false);
    }
  }

  async function saveStep1AndContinue() {
    if (!user || !detected?.reachable) return;
    setStep1Error(null);
    try {
      const r = await fetch(`${API}/api/onboarding/save-step`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          merchant_id: user.id,
          step: 'install',
          data: {
            name: detected.brand_name,
            website_url: detected.url,
            source_url: detected.url,
            ig_handle: detected.ig_handle,
            logo_url: detected.logo_url,
            theme_color: detected.theme_color,
          },
        }),
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        const msg = data?.error || `Save failed (HTTP ${r.status})`;
        if (msg.toLowerCase().includes('column') || msg.toLowerCase().includes('does not exist')) {
          setStep1Error(`Database setup incomplete: ${msg}.`);
        } else {
          setStep1Error(msg);
        }
        return;
      }
      const r2 = await fetch(`${API}/api/merchants/${user.id}`);
      if (r2.ok) setMerchant(await r2.json());
      setStep(2);
    } catch (err) {
      setStep1Error(err.message);
    }
  }

  function startRealStoreInstall() {
    if (!user || !detected?.url) return;
    const shop = detected.url.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    const installUrl = `${API}/api/shopify/install?shop=${encodeURIComponent(shop)}&merchant_id=${user.id}`;
    window.open(installUrl, '_blank', 'noopener,noreferrer');
    setInstallOpened(true);
    startInstallPolling();
  }

  function startDevStoreInstall() {
    if (!user || !devStoreUrl.trim()) return;
    let shop = devStoreUrl.replace(/^https?:\/\//, '').replace(/\/.*$/, '').trim();
    if (!shop.includes('.')) shop += '.myshopify.com';
    const installUrl = `${API}/api/shopify/install?shop=${encodeURIComponent(shop)}&merchant_id=${user.id}`;
    window.open(installUrl, '_blank', 'noopener,noreferrer');
    setInstallOpened(true);
    startInstallPolling();
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-pink-50">
      <div className="max-w-2xl mx-auto px-6 pt-12 pb-24">
        <div className="text-center mb-8">
          <div className="text-2xl font-bold tracking-tight">
            <span className="bg-gradient-to-r from-indigo-600 to-pink-500 bg-clip-text text-transparent">
              botiga.ai
            </span>
          </div>
        </div>

        <ProgressDots current={step} total={4} />

        <div className="bg-white rounded-3xl shadow-xl shadow-indigo-100/50 border border-gray-100 mt-8 overflow-hidden">
          {step === 1 && (
            <Step1
              url={url}
              setUrl={setUrl}
              detecting={detecting}
              detected={detected}
              setDetected={setDetected}
              detect={detectStore}
              cont={saveStep1AndContinue}
              editIg={editIg}
              setEditIg={setEditIg}
              editName={editName}
              setEditName={setEditName}
              step1Error={step1Error}
            />
          )}
          {step === 2 && (
            <Step2
              brand={detected?.brand_name || merchant?.name || 'your store'}
              installPath={installPath}
              setInstallPath={setInstallPath}
              devStoreUrl={devStoreUrl}
              setDevStoreUrl={setDevStoreUrl}
              installOpened={installOpened}
              startRealStoreInstall={startRealStoreInstall}
              startDevStoreInstall={startDevStoreInstall}
              merchant={merchant}
              cont={() => setStep(3)}
              back={() => setStep(1)}
            />
          )}
          {step === 3 && (
            <Step3BotPersona
              brand={detected?.brand_name || merchant?.name || 'your store'}
              logoUrl={detected?.logo_url || merchant?.logo_url}
              botName={botName}
              setBotName={setBotName}
              botAvatar={botAvatar}
              setBotAvatar={setBotAvatar}
              customAvatarUrl={customAvatarUrl}
              setCustomAvatarUrl={setCustomAvatarUrl}
              cont={() => setStep(4)}
              back={() => setStep(2)}
            />
          )}
          {step === 4 && (
            <Step4LiveProgress
              user={user}
              merchant={merchant}
              detected={detected}
              botName={botName}
              botAvatar={customAvatarUrl.trim() || botAvatar}
              goToDashboard={() => router.push('/dashboard')}
            />
          )}
        </div>

        {step < 4 && (
          <p className="text-center mt-6 text-xs text-gray-400">
            Setting up Botiga • You can finish later from the dashboard
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Components ─────────────────────────────────────────────────────────────

function ProgressDots({ current, total }) {
  return (
    <div className="flex items-center justify-center gap-3">
      {Array.from({ length: total }).map((_, i) => {
        const n = i + 1;
        const active = n === current;
        const done = n < current;
        return (
          <div key={n} className="flex items-center gap-3">
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold transition-all duration-300 ${
                done
                  ? 'bg-indigo-600 text-white scale-100'
                  : active
                  ? 'bg-white border-2 border-indigo-600 text-indigo-600 ring-4 ring-indigo-100 scale-110'
                  : 'bg-gray-100 text-gray-400 scale-95'
              }`}
            >
              {done ? '✓' : n}
            </div>
            {n < total && (
              <div
                className={`w-10 h-0.5 transition-colors duration-500 ${
                  done ? 'bg-indigo-600' : 'bg-gray-200'
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function Step1({ url, setUrl, detecting, detected, setDetected, detect, cont, editIg, setEditIg, editName, setEditName, step1Error }) {
  return (
    <div className="p-10">
      <h2 className="text-3xl font-bold text-gray-900">Tell us about your store</h2>
      <p className="text-gray-500 mt-2 leading-relaxed">
        Paste your store URL — Botiga reads everything else from your live site so the bot
        knows your products, collections, promos, and policies without an install.
      </p>

      <div className="mt-8">
        <label className="block text-sm font-semibold text-gray-700 mb-2">Store URL</label>
        <div className="flex gap-2">
          <input
            type="text"
            value={url}
            onChange={e => { setUrl(e.target.value); setDetected(null); }}
            onKeyDown={e => e.key === 'Enter' && detect()}
            disabled={detecting}
            placeholder="shopwhb.com"
            className="flex-1 border border-gray-200 rounded-xl px-4 py-3 text-base focus:outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 transition-all"
          />
          <button
            onClick={detect}
            disabled={detecting || !url.trim()}
            className="px-5 py-3 bg-gray-900 hover:bg-gray-800 text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-40 whitespace-nowrap"
          >
            {detecting ? 'Looking…' : 'Find my store'}
          </button>
        </div>
      </div>

      {detected && !detected.reachable && (
        <div className="mt-6 p-4 bg-red-50 border border-red-100 rounded-xl text-sm text-red-700">
          Couldn't reach <strong>{detected.url || url}</strong>. Double-check the URL and try again.
        </div>
      )}

      {detected && detected.reachable && (
        <div className="mt-6 p-6 bg-gradient-to-br from-indigo-50 to-pink-50 border border-indigo-100 rounded-2xl">
          <div className="flex items-start gap-4">
            {detected.logo_url ? (
              <img src={detected.logo_url} alt="" className="w-14 h-14 rounded-xl object-cover bg-white shadow-sm" />
            ) : (
              <div className="w-14 h-14 rounded-xl bg-white shadow-sm flex items-center justify-center text-xl">
                🏪
              </div>
            )}
            <div className="flex-1 min-w-0">
              {editName ? (
                <input
                  autoFocus
                  type="text"
                  value={detected.brand_name || ''}
                  onChange={e => setDetected({ ...detected, brand_name: e.target.value })}
                  onBlur={() => setEditName(false)}
                  onKeyDown={e => e.key === 'Enter' && setEditName(false)}
                  className="w-full text-lg font-bold text-gray-900 bg-white border border-indigo-200 rounded px-2 py-0.5"
                />
              ) : (
                <button onClick={() => setEditName(true)} className="text-lg font-bold text-gray-900 truncate hover:underline">
                  {detected.brand_name || 'Untitled store'} <span className="text-xs text-gray-400 ml-1">edit</span>
                </button>
              )}
              <div className="text-sm text-gray-500 truncate">{detected.url}</div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4 mt-6">
            <Stat label="Products" value={detected.product_count ?? '—'} />
            <Stat label="Collections" value={detected.collection_count ?? '—'} />
            <Stat label="Instagram" value={detected.ig_handle ? `@${detected.ig_handle}` : '—'} />
          </div>

          {!detected.ig_handle && (
            <div className="mt-4 pt-4 border-t border-indigo-100">
              {editIg ? (
                <input
                  autoFocus
                  type="text"
                  placeholder="willow_house"
                  value={detected.ig_handle || ''}
                  onChange={e => setDetected({ ...detected, ig_handle: e.target.value.replace(/^@/, '') })}
                  onBlur={() => setEditIg(false)}
                  onKeyDown={e => e.key === 'Enter' && setEditIg(false)}
                  className="w-full text-sm bg-white border border-indigo-200 rounded px-3 py-2"
                />
              ) : (
                <button onClick={() => setEditIg(true)} className="text-sm text-indigo-600 hover:text-indigo-700 font-medium">
                  + Add Instagram handle (optional)
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {step1Error && (
        <div className="mt-6 p-4 bg-red-50 border border-red-100 rounded-xl text-sm text-red-700">
          <strong>Couldn't save:</strong> {step1Error}
        </div>
      )}

      <div className="mt-8 flex justify-end">
        <button
          onClick={cont}
          disabled={!detected?.reachable}
          className="px-6 py-3 bg-gradient-to-r from-indigo-600 to-pink-500 text-white text-sm font-semibold rounded-xl hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Continue →
        </button>
      </div>
    </div>
  );
}

function Step2({ brand, installPath, setInstallPath, devStoreUrl, setDevStoreUrl, installOpened, startRealStoreInstall, startDevStoreInstall, merchant, cont, back }) {
  const installed = !!merchant?.shopify_access_token;
  return (
    <div className="p-10">
      <h2 className="text-3xl font-bold text-gray-900">Install Botiga</h2>
      <p className="text-gray-500 mt-2 leading-relaxed">
        Botiga needs Shopify admin access to create draft orders and discount codes when
        shoppers negotiate. Read access to your products. Nothing else.
      </p>

      {!installPath && !installed && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-8">
          <button
            onClick={() => setInstallPath('real')}
            className="text-left p-6 border-2 border-gray-200 rounded-2xl hover:border-indigo-400 hover:shadow-md transition-all group"
          >
            <div className="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center text-xl mb-3 group-hover:bg-indigo-200 transition-colors">
              🚀
            </div>
            <div className="font-semibold text-gray-900">Install on {brand}</div>
            <div className="text-sm text-gray-500 mt-1">
              Live on your real Shopify store. The bot starts negotiating with real shoppers.
            </div>
            <div className="text-xs text-indigo-600 font-medium mt-3">Recommended →</div>
          </button>

          <button
            onClick={() => setInstallPath('dev')}
            className="text-left p-6 border-2 border-gray-200 rounded-2xl hover:border-indigo-400 hover:shadow-md transition-all group"
          >
            <div className="w-10 h-10 rounded-xl bg-pink-100 flex items-center justify-center text-xl mb-3 group-hover:bg-pink-200 transition-colors">
              🧪
            </div>
            <div className="font-semibold text-gray-900">Try on a dev store first</div>
            <div className="text-sm text-gray-500 mt-1">
              Test Botiga safely on a Shopify development store. No risk to your real store.
            </div>
            <div className="text-xs text-pink-600 font-medium mt-3">For demos & testing →</div>
          </button>
        </div>
      )}

      {installPath === 'real' && !installed && (
        <div className="mt-8 p-6 bg-indigo-50 border border-indigo-100 rounded-2xl">
          <div className="font-semibold text-gray-900">Connect to your Shopify admin</div>
          <p className="text-sm text-gray-600 mt-1">
            We'll open your Shopify admin in a new tab. Click <strong>Install app</strong> to grant access.
          </p>
          {!installOpened ? (
            <button
              onClick={startRealStoreInstall}
              className="mt-4 w-full py-3 bg-gradient-to-r from-indigo-600 to-pink-500 text-white text-sm font-semibold rounded-xl hover:opacity-90 transition-opacity"
            >
              Open Shopify install →
            </button>
          ) : (
            <div className="mt-4 flex items-center gap-3 text-sm text-indigo-700">
              <div className="w-4 h-4 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
              <span>Waiting for install to complete… checking every few seconds.</span>
            </div>
          )}
          <button onClick={() => setInstallPath(null)} className="mt-3 text-xs text-gray-500 hover:text-gray-700">
            ← Back to options
          </button>
        </div>
      )}

      {installPath === 'dev' && !installed && (
        <div className="mt-8 p-6 bg-pink-50 border border-pink-100 rounded-2xl">
          <div className="font-semibold text-gray-900">Connect a Shopify development store</div>
          <p className="text-sm text-gray-600 mt-1">
            Don't have one yet?{' '}
            <a href="https://partners.shopify.com/current/stores/new" target="_blank" rel="noreferrer" className="text-pink-600 font-medium hover:underline">
              Create a free dev store on Shopify Partners
            </a>{' '}
            (1 minute), then come back here.
          </p>
          <div className="mt-4 flex gap-2">
            <input
              type="text"
              value={devStoreUrl}
              onChange={e => setDevStoreUrl(e.target.value)}
              placeholder="my-dev-store.myshopify.com"
              className="flex-1 border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-pink-400 focus:ring-4 focus:ring-pink-100"
            />
            <button
              onClick={startDevStoreInstall}
              disabled={!devStoreUrl.trim()}
              className="px-5 py-3 bg-gradient-to-r from-pink-500 to-rose-500 text-white text-sm font-semibold rounded-xl hover:opacity-90 transition-opacity disabled:opacity-40"
            >
              Install →
            </button>
          </div>
          {installOpened && (
            <div className="mt-4 flex items-center gap-3 text-sm text-pink-700">
              <div className="w-4 h-4 border-2 border-pink-600 border-t-transparent rounded-full animate-spin" />
              <span>Waiting for install to complete… we'll auto-advance.</span>
            </div>
          )}
          <button onClick={() => setInstallPath(null)} className="mt-3 text-xs text-gray-500 hover:text-gray-700">
            ← Back to options
          </button>
        </div>
      )}

      {installed && (
        <div className="mt-8 p-6 bg-emerald-50 border border-emerald-100 rounded-2xl">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-emerald-500 text-white flex items-center justify-center text-sm font-bold">✓</div>
            <div>
              <div className="font-semibold text-emerald-900">Connected to {merchant.shopify_domain}</div>
              <div className="text-sm text-emerald-700">Botiga has the access it needs.</div>
            </div>
          </div>
        </div>
      )}

      <div className="mt-8 flex items-center justify-between">
        <button onClick={back} className="text-sm text-gray-500 hover:text-gray-700">
          ← Back
        </button>
        <div className="flex items-center gap-4">
          {!installed && (
            <button onClick={cont} className="text-sm text-gray-500 hover:text-gray-700">
              Skip for now
            </button>
          )}
          <button
            onClick={cont}
            disabled={!installed && !installPath}
            className={`px-6 py-3 text-sm font-semibold rounded-xl transition-opacity ${
              installed
                ? 'bg-gradient-to-r from-emerald-600 to-emerald-500 text-white hover:opacity-90'
                : 'bg-gradient-to-r from-indigo-600 to-pink-500 text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed'
            }`}
          >
            Continue →
          </button>
        </div>
      </div>
    </div>
  );
}

const PRESET_AVATARS = [
  { url: 'https://cdn.botiga.ai/avatars/sparkle.gif', label: 'Sparkle', emoji: '✨' },
  { url: 'https://cdn.botiga.ai/avatars/wave.gif',    label: 'Wave',    emoji: '👋' },
  { url: 'https://cdn.botiga.ai/avatars/heart.gif',   label: 'Heart',   emoji: '💗' },
  { url: 'https://cdn.botiga.ai/avatars/bot.gif',     label: 'Bot',     emoji: '🤖' },
  { url: 'https://cdn.botiga.ai/avatars/shop.gif',    label: 'Shop',    emoji: '🛍️' },
  { url: 'https://cdn.botiga.ai/avatars/star.gif',    label: 'Star',    emoji: '🌟' },
];

function Step3BotPersona({ brand, logoUrl, botName, setBotName, botAvatar, setBotAvatar, customAvatarUrl, setCustomAvatarUrl, cont, back }) {
  const previewAvatar = (customAvatarUrl.trim() || botAvatar);
  const previewIsPreset = PRESET_AVATARS.find(p => p.url === botAvatar) && !customAvatarUrl.trim();
  const previewEmoji = previewIsPreset ? PRESET_AVATARS.find(p => p.url === botAvatar)?.emoji : null;

  return (
    <div className="p-10">
      <h2 className="text-3xl font-bold text-gray-900">Meet your bot</h2>
      <p className="text-gray-500 mt-2 leading-relaxed">
        Give your shop assistant a name and a face. This is what shoppers see when the
        bot greets them on your storefront.
      </p>

      {/* Live preview chat bubble */}
      <div className="mt-6 p-5 bg-gradient-to-br from-indigo-50 to-pink-50 border border-indigo-100 rounded-2xl">
        <div className="flex items-start gap-3">
          <div className="w-12 h-12 rounded-full bg-white shadow-md border border-gray-100 flex items-center justify-center overflow-hidden flex-shrink-0">
            {previewEmoji ? (
              <span className="text-2xl">{previewEmoji}</span>
            ) : previewAvatar ? (
              <img src={previewAvatar} alt="" className="w-full h-full object-cover" onError={e => { e.target.style.display = 'none'; }} />
            ) : logoUrl ? (
              <img src={logoUrl} alt="" className="w-full h-full object-cover" />
            ) : (
              <span className="text-2xl">🤖</span>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-semibold text-gray-700 mb-1">
              {botName || 'Your bot'}
            </div>
            <div className="bg-white rounded-2xl rounded-tl-sm px-4 py-2.5 shadow-sm inline-block max-w-full">
              <p className="text-sm text-gray-800">
                Hi! 👋 Welcome to <strong>{brand}</strong> — looking for anything in particular?
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Bot name */}
      <div className="mt-6">
        <label className="block text-sm font-semibold text-gray-700 mb-2">Bot name</label>
        <input
          type="text"
          value={botName}
          onChange={e => setBotName(e.target.value)}
          placeholder="e.g. Willow Bot"
          className="w-full border border-gray-200 rounded-xl px-4 py-3 text-base focus:outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 transition-all"
        />
      </div>

      {/* Avatar picker */}
      <div className="mt-6">
        <label className="block text-sm font-semibold text-gray-700 mb-3">Avatar</label>
        <div className="grid grid-cols-6 gap-2">
          {PRESET_AVATARS.map(p => {
            const selected = botAvatar === p.url && !customAvatarUrl.trim();
            return (
              <button
                key={p.url}
                onClick={() => { setBotAvatar(p.url); setCustomAvatarUrl(''); }}
                className={`aspect-square rounded-xl flex items-center justify-center text-2xl transition-all ${
                  selected
                    ? 'bg-gradient-to-br from-indigo-100 to-pink-100 border-2 border-indigo-500 ring-4 ring-indigo-100 scale-105'
                    : 'bg-gray-50 border-2 border-transparent hover:bg-gray-100'
                }`}
                title={p.label}
              >
                {p.emoji}
              </button>
            );
          })}
        </div>

        <div className="mt-4">
          <label className="block text-xs font-medium text-gray-500 mb-1.5">Or paste a URL (GIF or image)</label>
          <input
            type="text"
            value={customAvatarUrl}
            onChange={e => setCustomAvatarUrl(e.target.value)}
            placeholder="https://…/avatar.gif"
            className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 transition-all"
          />
        </div>
      </div>

      <div className="mt-8 flex items-center justify-between">
        <button onClick={back} className="text-sm text-gray-500 hover:text-gray-700">
          ← Back
        </button>
        <button
          onClick={cont}
          disabled={!botName.trim()}
          className="px-6 py-3 bg-gradient-to-r from-indigo-600 to-pink-500 text-white text-sm font-semibold rounded-xl hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Looks good →
        </button>
      </div>
    </div>
  );
}

// ─── Step 4: TurboTax-style live progress ───────────────────────────────────
//
// Auto-fires on mount. Runs the heavy lifting sequentially while the merchant
// watches: each task animates in, gets a spinner while running, then morphs
// into a green check with a subtle scale-pop. The whole sequence should
// finish under ~60 seconds (mostly bounded by the IG fetch + auto-tag chunks).

const TASKS = [
  { id: 'store',        label: 'Store connected',          sub: 'Reading products, collections, policies' },
  { id: 'shopify',      label: 'Shopify installed',        sub: 'Draft orders + discount codes ready' },
  { id: 'persona',      label: 'Bot persona saved',        sub: 'Name + avatar applied' },
  { id: 'instagram',    label: 'Pulling Instagram videos', sub: 'Latest 20 reels' },
  { id: 'autotag',      label: 'Auto-tagging products',    sub: 'Vision AI matching frames to your catalog' },
  { id: 'feed',         label: 'Floating Feed widget',     sub: 'Shoppable feed live on your storefront' },
  { id: 'negotiation',  label: 'Negotiation defaults',     sub: 'Friendly tone, 20% max discount' },
  { id: 'concierge',    label: 'Concierge bot ready',      sub: 'Trained on your store voice' },
];

// Celebratory confetti burst when onboarding completes. CSS-only DOM
// particles — no extra dependency, no canvas. Three staggered bursts
// (left corner → right corner → center) so the moment lands without
// being a single quick pop. Brand-palette colors.
const _CONFETTI_COLORS = [
  '#FFC107', '#FF6B35', '#F72585', '#9C27B0',
  '#4F46E5', '#06B6D4', '#10B981', '#FACC15',
];
function fireConfetti() {
  if (typeof document === 'undefined') return;
  const bursts = [
    { x: 0.05, y: 0.65, count: 70, vx: [200, 600],  vy: [-700, -350] }, // left → up-right
    { x: 0.95, y: 0.65, count: 70, vx: [-600, -200], vy: [-700, -350] }, // right → up-left
    { x: 0.50, y: 0.45, count: 90, vx: [-400, 400], vy: [-800, -500] }, // center → up
  ];
  bursts.forEach((b, idx) => {
    setTimeout(() => spawnConfettiBurst(b), idx * 220);
  });
}
function spawnConfettiBurst({ x, y, count, vx, vy }) {
  const startX = window.innerWidth * x;
  const startY = window.innerHeight * y;
  for (let i = 0; i < count; i++) {
    const el = document.createElement('div');
    const isCircle = Math.random() < 0.3;
    const size = 6 + Math.random() * 10;
    const color = _CONFETTI_COLORS[Math.floor(Math.random() * _CONFETTI_COLORS.length)];
    const dx = vx[0] + Math.random() * (vx[1] - vx[0]);
    const dy = vy[0] + Math.random() * (vy[1] - vy[0]);
    const rotStart = (Math.random() * 360).toFixed(0);
    const rotEnd = (rotStart * 1 + 360 + Math.random() * 720).toFixed(0);
    const dur = (1.6 + Math.random() * 1.2).toFixed(2);
    el.style.cssText =
      `position:fixed;left:${startX}px;top:${startY}px;` +
      `width:${size}px;height:${size * (isCircle ? 1 : 0.5)}px;` +
      `background:${color};border-radius:${isCircle ? '50%' : '2px'};` +
      `pointer-events:none;z-index:9999;will-change:transform,opacity;` +
      `--dx:${dx}px;--dy:${dy}px;--rot-start:${rotStart}deg;--rot-end:${rotEnd}deg;--dur:${dur}s;` +
      `animation:_btg_confetti_fly var(--dur) cubic-bezier(.22,.61,.36,1) forwards;` +
      `box-shadow:0 1px 2px rgba(0,0,0,.08);`;
    document.body.appendChild(el);
    el.addEventListener('animationend', () => el.remove());
  }
}

function Step4LiveProgress({ user, merchant, detected, botName, botAvatar, goToDashboard }) {
  // taskState: id → 'pending' | 'active' | 'done' | 'error'
  const [state, setState] = useState(() => {
    const init = {};
    for (const t of TASKS) init[t.id] = 'pending';
    return init;
  });
  const [details, setDetails] = useState({}); // id → free-form sub override
  const [allDone, setAllDone] = useState(false);
  const [error, setError] = useState(null);
  const ranRef = useRef(false);
  const confettiFiredRef = useRef(false);

  // Fire the celebratory confetti exactly once when onboarding completes.
  // Guarded against re-renders (the simple useEffect dependency would
  // re-fire if a parent re-renders us).
  useEffect(() => {
    if (allDone && !confettiFiredRef.current) {
      confettiFiredRef.current = true;
      fireConfetti();
      // Encore burst 1.4s in to extend the moment as the user reads the list
      setTimeout(fireConfetti, 1400);
    }
  }, [allDone]);

  function setTask(id, status, sub) {
    setState(s => ({ ...s, [id]: status }));
    if (sub) setDetails(d => ({ ...d, [id]: sub }));
  }

  useEffect(() => {
    if (ranRef.current || !user) return;
    ranRef.current = true;

    (async () => {
      try {
        // Tasks 1 + 2 are already done from prior steps — show them as done
        // immediately so the merchant sees state on mount, then animate.
        await sleep(150);
        setTask('store', 'done');
        await sleep(200);
        setTask('shopify', merchant?.shopify_access_token ? 'done' : 'done', merchant?.shopify_access_token ? merchant.shopify_domain : 'Skipped — install later from dashboard');

        // Task 3: Save bot persona via /onboarding/save-step (name) +
        // /onboarding/auto-setup (avatar/personality + Floating Feed scaffold)
        await sleep(250);
        setTask('persona', 'active');
        const setupRes = await fetch(`${API}/api/onboarding/auto-setup`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            merchant_id: user.id,
            bot_name: botName,
            bot_avatar_url: botAvatar,
            bot_personality: 'friendly',
            bot_greeting: `Hi! 👋 Welcome to ${detected?.brand_name || merchant?.name || 'our shop'} — looking for anything in particular?`,
          }),
        });
        if (!setupRes.ok) {
          const e = await setupRes.json().catch(() => ({}));
          throw new Error(`bot_setup: ${e.error || setupRes.status}`);
        }
        const setupData = await setupRes.json();
        setTask('persona', 'done', `${botName} · ready`);

        // Task 4: IG pull via /complete (also marks completed_at)
        const igHandle = merchant?.ig_handle || detected?.ig_handle;
        await sleep(250);
        if (igHandle) {
          setTask('instagram', 'active', `Fetching @${igHandle}`);
        } else {
          setTask('instagram', 'active', 'No Instagram handle — skipping');
        }
        const completeRes = await fetch(`${API}/api/onboarding/complete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ merchant_id: user.id, fire_ig_pull: true, ig_limit: 20 }),
        });
        const completeData = await completeRes.json();
        const importMatch = String(completeData.ig_pull_status || '').match(/^imported_(\d+)/);
        const importedCount = importMatch ? parseInt(importMatch[1], 10) : 0;
        if (igHandle) {
          setTask('instagram', 'done', importedCount > 0 ? `${importedCount} reels imported` : prettyIgStatus(completeData.ig_pull_status));
        } else {
          setTask('instagram', 'done', 'Skipped — add IG handle in Settings later');
        }

        // Task 5: auto-tag in chunks (only if videos imported)
        await sleep(250);
        if (importedCount > 0) {
          setTask('autotag', 'active', `0 / ${importedCount}`);
          let tagged = 0;
          let safety = 30; // hard cap on chunk loop iterations
          while (safety-- > 0) {
            const tickRes = await fetch(`${API}/api/merchants/${user.id}/videos/auto-tag-tick`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ chunk_size: 5 }),
            });
            if (!tickRes.ok) break;
            const t = await tickRes.json();
            tagged += (t.auto_tagged || 0) + (t.pending_review || 0);
            setTask('autotag', 'active', `${tagged} / ${importedCount}`);
            if (!t.has_more) break;
          }
          setTask('autotag', 'done', `${tagged} of ${importedCount} tagged${tagged < importedCount ? ' — rest will keep tagging in dashboard' : ''}`);
        } else {
          setTask('autotag', 'done', 'No videos to tag yet');
        }

        // Task 6: Re-run auto-setup so Floating Feed picks up the newly imported videos
        await sleep(250);
        setTask('feed', 'active');
        const reseed = await fetch(`${API}/api/onboarding/auto-setup`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ merchant_id: user.id }),
        });
        const reseedData = await reseed.json().catch(() => ({}));
        setTask('feed', 'done', `${reseedData.video_count || 0} videos in feed`);

        // Tasks 7 + 8 — these defaults are applied via auto-setup + the merchant_settings
        // table-level defaults. Show them animating to give a clean wrap-up.
        await sleep(300);
        setTask('negotiation', 'active');
        await sleep(450);
        setTask('negotiation', 'done');

        await sleep(250);
        setTask('concierge', 'active');
        await sleep(450);
        setTask('concierge', 'done');

        await sleep(400);
        setAllDone(true);
      } catch (err) {
        setError(err.message);
        // Mark currently-active task as error so the row visibly shows it
        setState(s => {
          const out = { ...s };
          for (const t of TASKS) {
            if (out[t.id] === 'active') out[t.id] = 'error';
          }
          return out;
        });
      }
    })();
  }, [user]);

  const doneCount = TASKS.filter(t => state[t.id] === 'done').length;
  const pct = Math.round((doneCount / TASKS.length) * 100);

  return (
    <div className="p-10">
      {/* Keyframes for the confetti burst. Scoped global so DOM particles
          appended to document.body can resolve them. */}
      <style jsx global>{`
        @keyframes _btg_confetti_fly {
          0%   { transform: translate(0,0) rotate(var(--rot-start)); opacity: 1; }
          70%  { opacity: 1; }
          100% {
            transform: translate(var(--dx), calc(var(--dy) + 900px)) rotate(var(--rot-end));
            opacity: 0;
          }
        }
      `}</style>
      <div className="text-center">
        <div className={`text-5xl mb-3 transition-transform duration-500 ${allDone ? 'scale-110' : ''}`}>
          {allDone ? '🎉' : '✨'}
        </div>
        <h2 className="text-3xl font-bold text-gray-900">
          {allDone ? "You're live" : 'Setting up your shop'}
        </h2>
        <p className="text-gray-500 mt-2 leading-relaxed max-w-md mx-auto">
          {allDone
            ? "Botiga is ready. Your shop assistant is greeting customers, your shoppable feed is live, and your videos are tagged."
            : "Hang tight — Botiga is provisioning everything. This usually takes under a minute."}
        </p>
      </div>

      {/* Top progress bar */}
      <div className="mt-8 max-w-md mx-auto">
        <div className="flex items-center justify-between text-xs text-gray-500 mb-1.5">
          <span className="font-medium">{doneCount} of {TASKS.length} complete</span>
          <span className="font-semibold text-gray-700">{pct}%</span>
        </div>
        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-indigo-500 via-pink-500 to-rose-500 transition-all duration-500 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* Task timeline */}
      <ol className="mt-8 max-w-md mx-auto relative">
        {/* Vertical connector line */}
        <div className="absolute left-[15px] top-3 bottom-3 w-px bg-gray-200" aria-hidden />
        {TASKS.map((task, i) => (
          <TaskRow
            key={task.id}
            task={task}
            status={state[task.id]}
            subOverride={details[task.id]}
            index={i}
          />
        ))}
      </ol>

      {error && (
        <div className="mt-6 max-w-md mx-auto p-4 bg-red-50 border border-red-100 rounded-xl text-sm text-red-700">
          <strong>Hit a snag:</strong> {error}. The dashboard will keep finishing in the background.
        </div>
      )}

      <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
        {allDone && merchant?.shopify_domain && (
          <a
            href={`https://${merchant.shopify_domain.replace(/^https?:\/\//, '').replace(/\/$/, '')}/`}
            target="_blank"
            rel="noreferrer"
            className="px-8 py-3 text-base font-semibold rounded-xl bg-white border-2 border-gray-200 hover:border-gray-300 text-gray-800 transition-colors"
            title="Opens your storefront in a new tab — see what customers see"
          >
            See my live feed ↗
          </a>
        )}
        <button
          onClick={goToDashboard}
          disabled={!allDone && !error}
          className={`px-8 py-3 text-base font-semibold rounded-xl transition-all duration-300 ${
            allDone
              ? 'bg-gradient-to-r from-emerald-600 to-emerald-500 text-white hover:opacity-90 shadow-lg shadow-emerald-200 scale-100 hover:scale-105'
              : error
              ? 'bg-gray-900 text-white hover:bg-gray-800'
              : 'bg-gray-200 text-gray-400 cursor-not-allowed'
          }`}
        >
          {allDone ? 'Take me to my dashboard →' : error ? 'Continue to dashboard →' : 'Working…'}
        </button>
      </div>
    </div>
  );
}

function TaskRow({ task, status, subOverride, index }) {
  const sub = subOverride || task.sub;
  const isDone = status === 'done';
  const isActive = status === 'active';
  const isError = status === 'error';

  return (
    <li
      className={`relative flex items-start gap-4 py-3 px-2 rounded-xl transition-all duration-300 ${
        isActive ? 'bg-gradient-to-r from-indigo-50/80 to-pink-50/80' : ''
      }`}
      style={{
        animation: `fadeSlideIn 400ms ease-out ${index * 60}ms both`,
      }}
    >
      <div className="relative z-10">
        <StatusIcon status={status} />
      </div>
      <div className="flex-1 min-w-0 pt-0.5">
        <div className={`text-sm font-semibold transition-colors ${
          isDone ? 'text-gray-900' : isActive ? 'text-indigo-900' : isError ? 'text-red-700' : 'text-gray-400'
        }`}>
          {task.label}
        </div>
        <div className={`text-xs mt-0.5 transition-colors ${
          isDone ? 'text-emerald-700' : isActive ? 'text-indigo-600' : isError ? 'text-red-600' : 'text-gray-400'
        }`}>
          {sub}
        </div>
      </div>
      {/* Inline animation keyframes */}
      <style jsx>{`
        @keyframes fadeSlideIn {
          0%   { opacity: 0; transform: translateY(8px); }
          100% { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </li>
  );
}

function StatusIcon({ status }) {
  if (status === 'done') {
    return (
      <div
        className="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-500 to-emerald-600 text-white flex items-center justify-center text-sm font-bold shadow-md shadow-emerald-200"
        style={{ animation: 'popIn 400ms cubic-bezier(.34,1.56,.64,1)' }}
      >
        ✓
        <style jsx>{`
          @keyframes popIn {
            0%   { transform: scale(.4); opacity: 0; }
            70%  { transform: scale(1.15); opacity: 1; }
            100% { transform: scale(1); }
          }
        `}</style>
      </div>
    );
  }
  if (status === 'active') {
    return (
      <div className="w-8 h-8 rounded-full bg-white border-2 border-indigo-500 flex items-center justify-center ring-4 ring-indigo-100">
        <div className="w-3 h-3 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  if (status === 'error') {
    return (
      <div className="w-8 h-8 rounded-full bg-red-500 text-white flex items-center justify-center text-sm font-bold shadow-md shadow-red-200">
        !
      </div>
    );
  }
  return (
    <div className="w-8 h-8 rounded-full bg-gray-100 border-2 border-gray-200 flex items-center justify-center">
      <div className="w-1.5 h-1.5 rounded-full bg-gray-300" />
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="bg-white/70 rounded-xl p-3 text-center">
      <div className="text-xs text-gray-500 uppercase tracking-wide">{label}</div>
      <div className="text-base font-semibold text-gray-900 mt-0.5 truncate">{value}</div>
    </div>
  );
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function prettyIgStatus(status) {
  if (!status) return '';
  // imported_<n>_failed_<m> — partial success
  const partial = status.match(/^imported_(\d+)_failed_(\d+)/);
  if (partial) return `${partial[1]} imported, ${partial[2]} skipped`;
  if (status.startsWith('imported_')) return `${status.split('_')[1]} reels imported`;
  if (status === 'no_ig_handle') return 'No Instagram handle';
  if (status === 'no_rapidapi_key') return 'IG import not configured';
  if (status === 'no_posts_found') return 'No public posts found';
  if (status.startsWith('ig_preview_')) return `IG returned ${status.split('_')[2]}`;
  // db_<code> — Postgres error code. Most likely cause is a missing migration.
  if (status.startsWith('db_')) return `Database constraint blocked import (${status.slice(3)}). Ask admin to run latest migrations.`;
  if (status.startsWith('error:')) return status;
  return status;
}
