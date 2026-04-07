'use client';
import { useState } from 'react';

const PLATFORMS = ['Any Website', 'Shopify', 'WordPress', 'WIX'];

export default function InstallScript({ apiKey }) {
  const [copied, setCopied] = useState(false);
  const [platform, setPlatform] = useState('Any Website');
  const [testMode, setTestMode] = useState(false);

  const widgetUrl = process.env.NEXT_PUBLIC_WIDGET_URL || 'https://botiga-dashboard-gamma.vercel.app';
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'https://botiga-api-two.vercel.app';
  const scriptTag = `<script src="${widgetUrl}/n.js?k=${apiKey}${testMode ? '&test=1' : ''}" data-api="${apiUrl}"></script>`;

  const fullScript = `<script
  src="${widgetUrl}/n.js?k=${apiKey}${testMode ? '&test=1' : ''}"
  data-api="${apiUrl}"
  data-label="Make an offer"
  data-position="below-cart">
</script>`;

  function copy() {
    navigator.clipboard.writeText(scriptTag);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const instructions = {
    'Any Website': [
      'Open your website\'s HTML file',
      'Find the closing </body> tag',
      'Paste the script just before </body>',
      'Save and publish — the button will appear automatically'
    ],
    'Shopify': [
      'Go to Online Store → Themes',
      'Click "Actions" → "Edit code" on your active theme',
      'Open theme.liquid',
      'Find </body> near the bottom',
      'Paste the script just before </body>',
      'Click Save'
    ],
    'WordPress': [
      'Go to Appearance → Theme Editor',
      'Open footer.php',
      'Find </body> near the bottom',
      'Paste the script just before </body>',
      'Click Update File'
    ],
    'WIX': [
      'Go to Settings → Custom Code',
      'Click "+ Add Custom Code"',
      'Paste the script',
      'Set placement to "Body — End"',
      'Click Apply'
    ]
  };

  return (
    <div className="space-y-6">
      {/* Script code block */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm font-medium text-gray-700">Your install script</label>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
              <input type="checkbox" checked={testMode} onChange={e => setTestMode(e.target.checked)}
                className="rounded" />
              Test mode (no fees)
            </label>
            <button onClick={copy}
              className="text-xs bg-indigo-600 text-white px-3 py-1.5 rounded-lg hover:bg-indigo-700 transition-colors">
              {copied ? '✓ Copied!' : 'Copy'}
            </button>
          </div>
        </div>
        <pre className="bg-gray-900 text-green-400 text-xs p-4 rounded-xl overflow-x-auto font-mono">
          {scriptTag}
        </pre>
        <details className="mt-2">
          <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-700">Show with optional attributes</summary>
          <pre className="mt-2 bg-gray-900 text-green-400 text-xs p-4 rounded-xl overflow-x-auto font-mono">
            {fullScript}
          </pre>
        </details>
      </div>

      {/* Platform tabs */}
      <div>
        <div className="flex gap-1 bg-gray-100 p-1 rounded-lg w-fit mb-4">
          {PLATFORMS.map(p => (
            <button key={p} onClick={() => setPlatform(p)}
              className={`px-3 py-1.5 text-sm rounded-md transition-all ${
                platform === p ? 'bg-white shadow-sm font-medium text-gray-900' : 'text-gray-500 hover:text-gray-700'
              }`}>
              {p}
            </button>
          ))}
        </div>
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
