'use client';
import { useState } from 'react';

const PLATFORMS = ['Shopify', 'Any Website', 'WordPress', 'WIX'];

export default function InstallScript({ apiKey }) {
  const [copied, setCopied] = useState(false);
  const [platform, setPlatform] = useState('Shopify');
  const [testMode, setTestMode] = useState(false);

  // Widget files (n.js, video.js, confetti.js) are served exclusively by the
  // API server. The dashboard is a Next.js app and doesn't serve them.
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'https://botiga-api-two.vercel.app';
  const widgetUrl = apiUrl;
  const k = `${apiKey}${testMode ? '&test=1' : ''}`;

  // Per-platform install snippets. The ideal pattern is:
  //   - video.js loads on every page (drives the floating launcher, deep-link
  //     ?btgv=<id> auto-open feed, concierge bubble)
  //   - n.js loads only on /products/* and /cart pages (it's the negotiate
  //     widget; self-gates internally too, but loading it everywhere wastes
  //     bandwidth)
  // Shopify supports the conditional via Liquid {% if template == 'product' %}.
  // Other platforms get unconditional loads since they don't have template
  // detection — n.js's internal page-detection still keeps it from doing
  // anything on irrelevant pages.

  const shopifyScript = `<script src="${widgetUrl}/video.js?k=${k}"></script>
{% if template == 'product' or template contains 'cart' %}
  <script src="${widgetUrl}/n.js?k=${k}" data-api="${apiUrl}"></script>
{% endif %}`;

  const universalScript = `<script src="${widgetUrl}/video.js?k=${k}"></script>
<script src="${widgetUrl}/n.js?k=${k}" data-api="${apiUrl}"></script>`;

  const scriptToShow = platform === 'Shopify' ? shopifyScript : universalScript;

  function copy() {
    navigator.clipboard.writeText(scriptToShow);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const instructions = {
    'Shopify': [
      'Go to Online Store → Themes',
      'Click "Actions" → "Edit code" on your active theme',
      'Open theme.liquid',
      'Find </body> near the bottom of the file',
      'Paste the snippet just before </body>',
      'Click Save',
    ],
    'Any Website': [
      "Open your website's HTML file",
      'Find the closing </body> tag',
      'Paste both lines just before </body>',
      'Save and publish — widgets appear automatically',
    ],
    'WordPress': [
      'Go to Appearance → Theme Editor',
      'Open footer.php',
      'Find </body> near the bottom',
      'Paste both lines just before </body>',
      'Click Update File',
    ],
    'WIX': [
      'Go to Settings → Custom Code',
      'Click "+ Add Custom Code"',
      'Paste both lines',
      'Set placement to "Body — End"',
      'Click Apply',
    ],
  };

  return (
    <div className="space-y-6">
      {/* Platform tabs — Shopify is now the default since merchants are likely Shopify-based */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-lg w-fit">
        {PLATFORMS.map(p => (
          <button
            key={p}
            onClick={() => setPlatform(p)}
            className={`px-3 py-1.5 text-sm rounded-md transition-all ${
              platform === p ? 'bg-white shadow-sm font-medium text-gray-900' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {p}
          </button>
        ))}
      </div>

      {/* Script code block */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm font-medium text-gray-700">
            Install snippet
            {platform === 'Shopify' && (
              <span className="text-xs text-gray-500 font-normal ml-1.5">
                · video feed everywhere, negotiate on product + cart only
              </span>
            )}
          </label>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
              <input
                type="checkbox"
                checked={testMode}
                onChange={e => setTestMode(e.target.checked)}
                className="rounded"
              />
              Test mode (no fees)
            </label>
            <button
              onClick={copy}
              className="text-xs bg-indigo-600 text-white px-3 py-1.5 rounded-lg hover:bg-indigo-700 transition-colors"
            >
              {copied ? '✓ Copied!' : 'Copy'}
            </button>
          </div>
        </div>
        <pre className="bg-gray-900 text-green-400 text-xs p-4 rounded-xl overflow-x-auto font-mono whitespace-pre">{scriptToShow}</pre>
      </div>

      {/* Step-by-step instructions */}
      <div>
        <ol className="space-y-2">
          {instructions[platform].map((step, i) => (
            <li key={i} className="flex items-start gap-3 text-sm text-gray-700">
              <span className="flex-shrink-0 w-5 h-5 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center text-xs font-bold mt-0.5">
                {i + 1}
              </span>
              {step}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
