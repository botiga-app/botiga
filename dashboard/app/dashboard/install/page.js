'use client';
import { useEffect, useState } from 'react';
import { createClient } from '../../../lib/supabase';
import InstallScript from '../../../components/InstallScript';

const API = process.env.NEXT_PUBLIC_API_URL || 'https://api.botiga.ai';

export default function InstallPage() {
  const [apiKey, setApiKey] = useState(null);
  const [rotating, setRotating] = useState(false);
  const [merchantId, setMerchantId] = useState(null);
  const [shopDomain, setShopDomain] = useState('');
  const [shopifyConnected, setShopifyConnected] = useState(false);
  // Per-script install state for Shopify-connected merchants.
  // Shape: { all_installed: bool, scripts: [{name, src, installed}] } | null
  const [scriptStatus, setScriptStatus] = useState(null);
  const [reinstalling, setReinstalling] = useState(false);
  const supabase = createClient();

  const [justInstalled, setJustInstalled] = useState(false);

  // Pull script-tag install state from /api/setup/script-tag
  async function checkScriptStatus(key) {
    if (!key) return;
    try {
      const r = await fetch(`${API}/api/setup/script-tag?api_key=${encodeURIComponent(key)}`);
      const data = await r.json().catch(() => ({}));
      if (r.ok) {
        setScriptStatus(data);
      } else {
        // Surface the error so we can show a clear CTA — most common case
        // is the merchant's OAuth token doesn't have write_script_tags
        // scope and needs to reinstall the Shopify app.
        const isScopeIssue = String(data.error || '').includes('read_script_tags') ||
                             String(data.error || '').includes('write_script_tags') ||
                             String(data.error || '').includes('403');
        setScriptStatus({ error: data.error || `HTTP ${r.status}`, scope_issue: isScopeIssue, scripts: [] });
      }
    } catch (err) {
      setScriptStatus({ error: err.message, scope_issue: false, scripts: [] });
    }
  }

  async function reinstallScripts() {
    if (!apiKey || reinstalling) return;
    setReinstalling(true);
    try {
      await fetch(`${API}/api/setup/script-tag`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: apiKey }),
      });
      await checkScriptStatus(apiKey);
    } finally {
      setReinstalling(false);
    }
  }

  useEffect(() => {
    // Detect App Store install redirect
    const params = new URLSearchParams(window.location.search);
    if (params.get('shop_connected')) {
      setJustInstalled(true);
      window.history.replaceState({}, '', '/dashboard/install');
    }

    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setMerchantId(user.id);
      const res = await fetch(`${API}/api/merchants/${user.id}`);
      if (res.ok) {
        const data = await res.json();
        setApiKey(data.api_key);
        if (data.shopify_domain) {
          setShopDomain(data.shopify_domain);
          setShopifyConnected(true);
          // Fire-and-forget — show actual storefront install state
          checkScriptStatus(data.api_key);
        }
      }
    }
    load();
  }, []);

  function connectShopify() {
    if (!shopDomain.trim() || !merchantId) return;
    const domain = shopDomain.trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
    const shop = domain.includes('.myshopify.com') ? domain : `${domain}.myshopify.com`;
    window.location.href = `${API}/api/shopify/install?shop=${encodeURIComponent(shop)}&merchant_id=${merchantId}`;
  }

  async function rotateKey() {
    if (!merchantId || !confirm('Rotate API key? Your current install script will stop working until you update it.')) return;
    setRotating(true);
    const res = await fetch(`${API}/api/merchants/${merchantId}/rotate-key`, { method: 'POST' });
    if (res.ok) {
      const data = await res.json();
      setApiKey(data.api_key);
    }
    setRotating(false);
  }

  return (
    <div className="p-8 max-w-3xl">
      {justInstalled && (
        <div className="mb-6 bg-green-50 border border-green-100 rounded-xl p-4 flex items-start gap-3">
          <span className="text-green-500 text-lg">✓</span>
          <div>
            <p className="text-sm font-medium text-green-800">Shopify connected successfully!</p>
            <p className="text-xs text-green-600 mt-0.5">Check your email — we sent you a link to set your password and access the dashboard.</p>
          </div>
        </div>
      )}
      <div className="mb-6">
        <h2 className="text-xl font-bold text-gray-900">Install Botiga</h2>
        <p className="text-sm text-gray-500">One line of code — works on any website</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 p-6">
        {apiKey ? (
          <InstallScript apiKey={apiKey} />
        ) : (
          <p className="text-sm text-gray-400">Loading your install script...</p>
        )}
      </div>

      {/* Shopify connect */}
      <div className="mt-6 bg-white rounded-xl border border-gray-100 p-6">
        <h3 className="font-semibold text-gray-900 mb-1">Connect Shopify</h3>
        <p className="text-sm text-gray-500 mb-4">
          Required for automatic discount codes at checkout when a deal is struck.
        </p>
        {shopifyConnected ? (
          <div className="flex items-center gap-3">
            <span className="text-green-600 text-sm font-medium">✓ Connected: {shopDomain}</span>
            <button onClick={() => setShopifyConnected(false)}
              className="text-xs text-gray-400 underline">Change</button>
          </div>
        ) : (
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="your-store.myshopify.com"
              value={shopDomain}
              onChange={e => setShopDomain(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && connectShopify()}
              className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
            />
            <button onClick={connectShopify} disabled={!shopDomain.trim() || !merchantId}
              className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50">
              Connect
            </button>
          </div>
        )}
      </div>

      {/* Storefront widget install state — only shown when Shopify is connected.
          Reflects what's actually live on the merchant's theme via Shopify's
          Script Tags API. Three states:
          - scope_issue: the merchant's OAuth token is missing write_script_tags;
            they need to reinstall the Shopify app to grant the new scope.
          - error (other): generic failure — show the message + a retry button.
          - normal: per-script install state with Reinstall CTA. */}
      {shopifyConnected && scriptStatus && scriptStatus.scope_issue && (
        <div className="mt-6 bg-amber-50 rounded-xl border border-amber-200 p-6">
          <h3 className="font-semibold text-amber-900">Reconnect Shopify to finish setup</h3>
          <p className="text-sm text-amber-800 mt-1">
            Your Shopify app needs the <code className="text-xs bg-amber-100 px-1 py-0.5 rounded">write_script_tags</code> permission so we can install the Botiga widget on your theme automatically. Reinstalling the Shopify app grants this — your data stays put.
          </p>
          <button
            onClick={connectShopify}
            className="mt-4 text-sm bg-amber-600 hover:bg-amber-700 text-white font-medium px-4 py-2 rounded-lg whitespace-nowrap"
          >
            Reinstall Shopify app →
          </button>
        </div>
      )}
      {shopifyConnected && scriptStatus && scriptStatus.error && !scriptStatus.scope_issue && (
        <div className="mt-6 bg-red-50 rounded-xl border border-red-200 p-6">
          <h3 className="font-semibold text-red-900">Couldn't check storefront install status</h3>
          <p className="text-sm text-red-800 mt-1">{scriptStatus.error}</p>
          <button
            onClick={() => checkScriptStatus(apiKey)}
            className="mt-3 text-sm bg-red-600 hover:bg-red-700 text-white font-medium px-3 py-1.5 rounded-lg"
          >
            Retry
          </button>
        </div>
      )}
      {shopifyConnected && scriptStatus && !scriptStatus.error && (
        <div className="mt-6 bg-white rounded-xl border border-gray-100 p-6">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div>
              <h3 className="font-semibold text-gray-900">Storefront widgets</h3>
              <p className="text-sm text-gray-500 mt-0.5">
                {scriptStatus.all_installed
                  ? 'All widgets are live on your storefront. Customers can negotiate, watch, and chat.'
                  : 'Some widgets are missing from your theme — click Reinstall to fix.'}
              </p>
            </div>
            <button
              onClick={reinstallScripts}
              disabled={reinstalling}
              className="text-sm bg-gray-900 hover:bg-gray-800 text-white font-medium px-3 py-1.5 rounded-lg disabled:opacity-60 whitespace-nowrap"
            >
              {reinstalling ? 'Reinstalling…' : (scriptStatus.all_installed ? 'Reinstall' : 'Install missing')}
            </button>
          </div>
          <div className="space-y-1.5">
            {scriptStatus.scripts.map(s => (
              <div key={s.name} className="flex items-center gap-2 text-sm">
                <span className={s.installed ? 'text-emerald-600' : 'text-gray-300'}>
                  {s.installed ? '✓' : '○'}
                </span>
                <span className="font-medium text-gray-900">
                  {s.name === 'video' ? 'Video feed + concierge bot' :
                   s.name === 'n' ? 'Negotiate widget (Make an offer)' :
                   s.name === 'confetti' ? 'Confetti effect on deal close' :
                   s.name}
                </span>
                <span className={`text-xs ${s.installed ? 'text-emerald-600' : 'text-gray-400'}`}>
                  {s.installed ? 'Installed' : 'Missing'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-4 flex items-center justify-between bg-yellow-50 border border-yellow-100 rounded-xl p-4">
        <div>
          <p className="text-sm font-medium text-yellow-800">Rotate API key</p>
          <p className="text-xs text-yellow-600 mt-0.5">Generate a new key and update your install script</p>
        </div>
        <button onClick={rotateKey} disabled={rotating}
          className="text-sm text-yellow-700 border border-yellow-300 px-3 py-1.5 rounded-lg hover:bg-yellow-100 disabled:opacity-60">
          {rotating ? 'Rotating...' : 'Rotate key'}
        </button>
      </div>
    </div>
  );
}
