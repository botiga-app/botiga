'use client';
import { useEffect, useState } from 'react';
import Script from 'next/script';

const API = process.env.NEXT_PUBLIC_API_URL || 'https://api.botiga.ai';

// Public, shareable preview — anyone with this URL can see the merchant's
// shoppable video feed exactly as customers would. Drops in the same widget
// script the storefront uses, so the experience is 1:1 with production.
export default function PreviewPage({ params }) {
  const { merchantId } = params;
  const [merchant, setMerchant] = useState(null);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API}/api/merchants/${merchantId}`)
      .then(r => r.ok ? r.json() : Promise.reject(new Error('Merchant not found')))
      .then(m => { if (!cancelled) setMerchant(m); })
      .catch(err => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
  }, [merchantId]);

  const previewUrl = typeof window !== 'undefined' ? window.location.href : '';

  function copyShareLink() {
    if (typeof navigator === 'undefined') return;
    navigator.clipboard.writeText(previewUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="text-center">
          <div className="text-3xl mb-3">😕</div>
          <p className="text-gray-700 font-medium">Couldn't load preview</p>
          <p className="text-gray-500 text-sm mt-1">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-100 to-white">
      {/* Top bar — visible only in preview, not on real storefront */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-5 py-3 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            {merchant?.logo_url && (
              <img src={merchant.logo_url} alt="" className="w-8 h-8 rounded object-cover bg-white border border-gray-100 flex-shrink-0" />
            )}
            <div className="min-w-0">
              <div className="text-sm font-semibold text-gray-900 truncate">
                {merchant?.name || 'Preview'}
              </div>
              <div className="text-xs text-gray-500 truncate">
                Customer view · Botiga shoppable feed
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={copyShareLink}
              className="text-xs font-medium px-3.5 py-2 rounded-full bg-gradient-to-r from-amber-400 via-orange-500 via-pink-500 to-purple-600 text-white hover:opacity-90 transition-opacity flex items-center gap-1.5"
              title="Copy a public link to share with customers"
            >
              <span>🔗</span>
              {copied ? 'Copied!' : 'Copy share link'}
            </button>
            <a
              href="/dashboard/videos"
              className="text-xs font-medium px-3.5 py-2 rounded-full bg-gray-900 hover:bg-gray-800 text-white transition-colors"
            >
              ← Dashboard
            </a>
          </div>
        </div>
      </div>

      {/* Centered phone-like frame so the widget renders in mobile width */}
      <div className="py-10 px-4">
        <div className="max-w-md mx-auto">
          {merchant?.api_key ? (
            <>
              <p className="text-center text-xs text-gray-500 mb-4">
                This is exactly what your customers will see on your storefront.
              </p>
              <div className="bg-white rounded-3xl shadow-2xl shadow-gray-300/40 border border-gray-200 overflow-hidden min-h-[600px] relative">
                {/* Embed the widget — it self-mounts to body via Shadow DOM */}
                <Script
                  src={`${API}/n.js?k=${merchant.api_key}`}
                  strategy="afterInteractive"
                />
                {/* Fallback content while widget loads */}
                <div id="botiga-preview-shell" className="p-12 text-center text-gray-400 text-sm">
                  Loading shoppable feed…
                </div>
              </div>
            </>
          ) : (
            <div className="text-center text-gray-400 text-sm py-12">Loading preview…</div>
          )}
        </div>
      </div>
    </div>
  );
}
