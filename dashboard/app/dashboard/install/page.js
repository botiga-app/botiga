'use client';
import { useEffect, useState } from 'react';
import { createClient } from '../../../lib/supabase';
import InstallScript from '../../../components/InstallScript';

const API = process.env.NEXT_PUBLIC_API_URL || 'https://api.botiga.ai';

export default function InstallPage() {
  const [apiKey, setApiKey] = useState(null);
  const [rotating, setRotating] = useState(false);
  const [merchantId, setMerchantId] = useState(null);
  const supabase = createClient();

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setMerchantId(user.id);
      const res = await fetch(`${API}/api/merchants/${user.id}`);
      if (res.ok) {
        const data = await res.json();
        setApiKey(data.api_key);
      }
    }
    load();
  }, []);

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
