'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '../../lib/supabase';

const API = process.env.NEXT_PUBLIC_API_URL || 'https://api.botiga.ai';

export default function OnboardingPage() {
  const router = useRouter();
  const supabase = createClient();
  const [user, setUser] = useState(null);
  const [merchant, setMerchant] = useState(null);
  const [step, setStep] = useState(1); // 1: store URL, 2: install, 3: live

  // Step 1 state
  const [url, setUrl] = useState('');
  const [detecting, setDetecting] = useState(false);
  const [detected, setDetected] = useState(null);
  const [editIg, setEditIg] = useState(false);
  const [editName, setEditName] = useState(false);

  // Step 2 state
  const [installPath, setInstallPath] = useState(null); // null | 'real' | 'dev'
  const [devStoreUrl, setDevStoreUrl] = useState('');
  const [installOpened, setInstallOpened] = useState(false);
  const installCheckInterval = useRef(null);

  // Step 3 state
  const [completing, setCompleting] = useState(false);
  const [completePhase, setCompletePhase] = useState(null); // 'saving' | 'pulling' | 'tagging' | 'done'
  const [completeMsg, setCompleteMsg] = useState('');
  const [igStatus, setIgStatus] = useState(null);
  const [tagProgress, setTagProgress] = useState({ tagged: 0, total: 0 });

  // Bootstrap: ensure logged in, load merchant, jump to right step
  useEffect(() => {
    async function bootstrap() {
      const { data: { user: u } } = await supabase.auth.getUser();
      if (!u) { router.push('/login'); return; }
      setUser(u);
      const r = await fetch(`${API}/api/merchants/${u.id}`);
      if (r.ok) {
        const m = await r.json();
        setMerchant(m);
        // Resume mid-flow if partially complete
        if (m.shopify_domain && m.shopify_access_token) setStep(3);
        else if (m.website_url) setStep(2);
        else setStep(1);
        if (m.website_url) setUrl(m.website_url);
        if (m.onboarding_completed_at) router.push('/dashboard');
      }
    }
    bootstrap();
    return () => { if (installCheckInterval.current) clearInterval(installCheckInterval.current); };
  }, []);

  // Step 2: poll for shopify_access_token to detect install completion
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
        // Auto-advance
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

  const [step1Error, setStep1Error] = useState(null);

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
        // Common case: missing column from a not-run migration
        if (msg.toLowerCase().includes('column') || msg.toLowerCase().includes('does not exist')) {
          setStep1Error(`Database setup incomplete: ${msg}. Ask your admin to run the latest migrations (likely 027 ig_handle).`);
        } else {
          setStep1Error(msg);
        }
        return;
      }
      // Refetch merchant so Step 3 sees the saved values
      const r2 = await fetch(`${API}/api/merchants/${user.id}`);
      if (r2.ok) setMerchant(await r2.json());
      setStep(2);
    } catch (err) {
      setStep1Error(err.message);
    }
  }

  function startRealStoreInstall() {
    if (!user || !detected?.url) return;
    // Strip protocol from URL to get the bare domain for Shopify OAuth
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

  async function complete() {
    if (!user) return;
    setCompleting(true);
    // First visible phase. The /complete API call below will hold this
    // for the full IG fetch duration (5-30s), so the merchant actually
    // reads it. The earlier "saving → pulling" two-phase flip got
    // batched by React and the saving message never appeared.
    setCompletePhase('pulling');
    setCompleteMsg(merchant?.ig_handle
      ? 'Pulling your latest Instagram posts…'
      : 'Finalizing your setup…');

    try {
      const r = await fetch(`${API}/api/onboarding/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ merchant_id: user.id, fire_ig_pull: true, ig_limit: 20 }),
      });
      const data = await r.json();
      setIgStatus(data.ig_pull_status);

      const importMatch = String(data.ig_pull_status || '').match(/^imported_(\d+)/);
      const importedCount = importMatch ? parseInt(importMatch[1], 10) : 0;

      if (importedCount > 0) {
        setCompletePhase('tagging');
        setCompleteMsg(`Imported ${importedCount} posts. Auto-tagging products…`);
        setTagProgress({ tagged: 0, total: importedCount });
        let tagged = 0;
        while (true) {
          const tickRes = await fetch(`${API}/api/merchants/${user.id}/videos/auto-tag-tick`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chunk_size: 5 }),
          });
          if (!tickRes.ok) break;
          const t = await tickRes.json();
          tagged += (t.auto_tagged || 0) + (t.pending_review || 0);
          setTagProgress({ tagged, total: importedCount });
          setCompleteMsg(`Auto-tagging: ${tagged}/${importedCount}`);
          if (!t.has_more) break;
        }
      }

      // Done — wait for merchant to click Continue (no auto-redirect).
      // The success state persists until they're ready to proceed.
      setCompletePhase('done');
      setCompleteMsg(importedCount > 0
        ? `✨ ${importedCount} posts ready in your shop feed.`
        : '✨ Setup complete.');
    } catch (err) {
      setCompletePhase('done');
      setCompleteMsg('Setup complete (with a small hiccup). Click below to continue.');
    }
  }

  function skipInstall() {
    setStep(3);
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-pink-50">
      <div className="max-w-2xl mx-auto px-6 pt-12 pb-24">
        {/* Brand mark */}
        <div className="text-center mb-8">
          <div className="text-2xl font-bold tracking-tight">
            <span className="bg-gradient-to-r from-indigo-600 to-pink-500 bg-clip-text text-transparent">
              botiga.ai
            </span>
          </div>
        </div>

        {/* Progress dots */}
        <ProgressDots current={step} total={3} />

        {/* Step content */}
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
              skip={skipInstall}
              back={() => setStep(1)}
            />
          )}
          {step === 3 && (
            <Step3
              merchant={merchant}
              detected={detected}
              completing={completing}
              completePhase={completePhase}
              completeMsg={completeMsg}
              tagProgress={tagProgress}
              igStatus={igStatus}
              complete={complete}
              goToDashboard={() => router.push('/dashboard')}
            />
          )}
        </div>

        {/* Skip-all escape hatch */}
        {step < 3 && (
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
              className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold transition-all ${
                done
                  ? 'bg-indigo-600 text-white'
                  : active
                  ? 'bg-white border-2 border-indigo-600 text-indigo-600 ring-4 ring-indigo-100'
                  : 'bg-gray-100 text-gray-400'
              }`}
            >
              {done ? '✓' : n}
            </div>
            {n < total && (
              <div className={`w-12 h-0.5 ${done ? 'bg-indigo-600' : 'bg-gray-200'}`} />
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
            <Stat
              label="Instagram"
              value={detected.ig_handle ? `@${detected.ig_handle}` : '—'}
            />
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

function Step2({ brand, installPath, setInstallPath, devStoreUrl, setDevStoreUrl, installOpened, startRealStoreInstall, startDevStoreInstall, merchant, skip, back }) {
  const installed = !!merchant?.shopify_access_token;
  return (
    <div className="p-10">
      <h2 className="text-3xl font-bold text-gray-900">Install Botiga</h2>
      <p className="text-gray-500 mt-2 leading-relaxed">
        Botiga needs Shopify admin access to create draft orders and discount codes when
        shoppers negotiate. Read access to your products. Nothing else.
      </p>

      {!installPath && (
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
            <button onClick={skip} className="text-sm text-gray-500 hover:text-gray-700">
              Skip for now
            </button>
          )}
          <button
            onClick={skip}
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

function Step3({ merchant, detected, completing, completePhase, completeMsg, tagProgress, igStatus, complete, goToDashboard }) {
  const igHandle = merchant?.ig_handle || detected?.ig_handle;
  const installed = !!merchant?.shopify_access_token;
  const tagPct = tagProgress?.total > 0 ? Math.round((tagProgress.tagged / tagProgress.total) * 100) : 0;

  return (
    <div className="p-10 text-center">
      <div className="text-5xl mb-3">{completePhase === 'done' ? '🎉' : '✨'}</div>
      <h2 className="text-3xl font-bold text-gray-900">
        {completePhase === 'done' ? "You're live" : "You're all set"}
      </h2>
      <p className="text-gray-500 mt-2 leading-relaxed max-w-md mx-auto">
        Botiga is ready to negotiate with shoppers, suggest products from collections, and
        answer questions using your store's real policies.
      </p>

      <div className="mt-8 max-w-md mx-auto space-y-3 text-left">
        <Checklist
          done={!!detected?.url || !!merchant?.website_url}
          label="Store connected"
          sub={detected?.url || merchant?.website_url}
        />
        <Checklist
          done={installed}
          label="Shopify installed"
          sub={installed ? merchant.shopify_domain : 'Skipped — install later from the dashboard'}
        />
        <Checklist
          done={!!igHandle}
          label={`Instagram${igHandle ? ` (@${igHandle})` : ''}`}
          sub={igHandle ? `Pulling 20 latest reels — they'll appear in your video feed shortly` : 'Skipped — add later from settings'}
        />
        <Checklist
          done={true}
          label="Negotiation tone"
          sub="Defaults loaded — friendly, 20% max discount. Tune anytime in Settings."
        />
      </div>

      {/* Live status panel — visible while complete() is running */}
      {completing && completePhase && (
        <div className="mt-8 max-w-md mx-auto p-4 bg-gradient-to-br from-indigo-50 to-pink-50 border border-indigo-100 rounded-2xl">
          <div className="flex items-center gap-3 text-sm text-gray-800">
            {completePhase !== 'done' && (
              <div className="w-4 h-4 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin flex-shrink-0" />
            )}
            {completePhase === 'done' && <span className="text-emerald-600">✓</span>}
            <span className="font-medium">{completeMsg}</span>
          </div>
          {completePhase === 'tagging' && tagProgress.total > 0 && (
            <div className="mt-3 h-1.5 bg-white rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-indigo-500 to-pink-500 transition-all"
                style={{ width: `${tagPct}%` }}
              />
            </div>
          )}
        </div>
      )}

      {!completing && igStatus && (
        <div className="mt-6 inline-flex items-center gap-2 px-4 py-2 bg-indigo-50 border border-indigo-100 rounded-full text-xs text-indigo-700">
          <span>📸</span>
          <span>{prettyIgStatus(igStatus)}</span>
        </div>
      )}

      <button
        onClick={completePhase === 'done' ? goToDashboard : complete}
        disabled={completing && completePhase !== 'done'}
        className={`mt-10 px-8 py-3 text-base font-semibold rounded-xl transition-opacity disabled:opacity-60 ${
          completePhase === 'done'
            ? 'bg-gradient-to-r from-emerald-600 to-emerald-500 hover:opacity-90 text-white'
            : 'bg-gradient-to-r from-indigo-600 to-pink-500 hover:opacity-90 text-white'
        }`}
      >
        {completePhase === 'done'
          ? 'Take me to my dashboard →'
          : completing
          ? 'Working…'
          : 'Finish setup →'}
      </button>
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

function Checklist({ done, label, sub }) {
  return (
    <div className="flex items-start gap-3 p-3 rounded-xl bg-gray-50">
      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold mt-0.5 ${done ? 'bg-emerald-500 text-white' : 'bg-gray-300 text-gray-500'}`}>
        {done ? '✓' : '–'}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-gray-900">{label}</div>
        {sub && <div className="text-xs text-gray-500 mt-0.5 truncate">{sub}</div>}
      </div>
    </div>
  );
}

function prettyIgStatus(status) {
  if (!status) return '';
  if (status.startsWith('imported_')) return `Imported ${status.split('_')[1]} reels — auto-tagging now.`;
  if (status === 'no_ig_handle') return 'No Instagram handle yet — add one anytime from Settings.';
  if (status === 'no_rapidapi_key') return 'Instagram import not configured yet.';
  if (status === 'no_reels_found') return 'No public reels found for this handle.';
  if (status.startsWith('ig_preview_')) return `Instagram preview returned ${status.split('_')[2]} — try again from /dashboard/videos.`;
  if (status.startsWith('error:')) return status;
  return status;
}
