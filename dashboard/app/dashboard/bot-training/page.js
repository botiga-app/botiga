'use client';
import { useEffect, useState } from 'react';
import { createClient } from '../../../lib/supabase';

const API = process.env.NEXT_PUBLIC_API_URL || 'https://api.botiga.ai';

function timeAgo(iso) {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'just now';
  if (ms < 3_600_000) return Math.round(ms / 60_000) + 'm ago';
  if (ms < 86_400_000) return Math.round(ms / 3_600_000) + 'h ago';
  return Math.round(ms / 86_400_000) + 'd ago';
}

const TYPE_BADGE = {
  boost:    { label: '↑ Boost',    cls: 'bg-emerald-100 text-emerald-700' },
  suppress: { label: '↓ Suppress', cls: 'bg-red-100 text-red-700' },
  context_phrase: { label: '💬 Context', cls: 'bg-blue-100 text-blue-700' },
  claim:    { label: '🏷️ Claim', cls: 'bg-amber-100 text-amber-700' },
};

function Directives({ directives }) {
  if (!Array.isArray(directives) || directives.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {directives.map((d, i) => {
        const meta = TYPE_BADGE[d.type] || { label: d.type, cls: 'bg-gray-100 text-gray-700' };
        const value = d.target_value || d.value || '';
        return (
          <span key={i} className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${meta.cls}`}>
            {meta.label}{value ? ` · ${value}` : ''}{d.weight ? ` · ${d.weight}×` : ''}
          </span>
        );
      })}
    </div>
  );
}

export default function BotTrainingPage() {
  const [merchantId, setMerchantId] = useState(null);
  const [items, setItems] = useState([]);
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const supabase = createClient();

  async function load(id) {
    setError(null);
    try {
      const res = await fetch(`${API}/api/merchants/${id}/bot-instructions`);
      if (!res.ok) {
        setError(`API ${res.status}: ${(await res.text()).slice(0, 200)}`);
        return;
      }
      const data = await res.json();
      setItems(data.instructions || []);
    } catch (e) { setError(e.message); }
  }

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setMerchantId(user.id);
      await load(user.id);
    })();
  }, []);

  async function save() {
    if (!text.trim() || !merchantId) return;
    setSaving(true);
    try {
      const res = await fetch(`${API}/api/merchants/${merchantId}/bot-instructions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instruction_text: text }),
      });
      if (res.ok) {
        setText('');
        load(merchantId);
      }
    } finally { setSaving(false); }
  }

  async function toggle(id, active) {
    await fetch(`${API}/api/bot-instructions/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active }),
    });
    load(merchantId);
  }

  async function remove(id) {
    if (!confirm('Delete this instruction?')) return;
    await fetch(`${API}/api/bot-instructions/${id}`, { method: 'DELETE' });
    load(merchantId);
  }

  return (
    <div className="p-8 max-w-4xl">
      <div className="mb-6">
        <h2 className="text-xl font-bold text-gray-900">Bot training</h2>
        <p className="text-sm text-gray-500 mt-1">
          Tell your bot what to push. Like a sales manager briefing your team — what's on sale, what's hot,
          what to mention. The bot weaves these into chats and boosts matching products.
        </p>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 p-4 mb-8">
        <textarea
          rows={3}
          value={text}
          onChange={e => setText(e.target.value)}
          maxLength={500}
          placeholder='e.g. "4th of July coming up — promote our patriot collection" or "Mention free shipping over $75"'
          className="w-full text-sm text-gray-900 border border-gray-200 rounded-lg p-3 outline-none focus:border-indigo-400 resize-none"
        />
        <div className="flex items-center justify-between mt-2">
          <span className="text-[11px] text-gray-400">{text.length}/500 · parsed once on save</span>
          <button
            onClick={save}
            disabled={saving || !text.trim()}
            className="text-sm px-4 py-2 rounded-lg bg-gray-900 text-white font-medium disabled:opacity-40">
            {saving ? 'Saving…' : 'Add instruction'}
          </button>
        </div>
      </div>

      {error && (
        <pre className="text-xs text-red-700 bg-red-50 border border-red-200 p-3 rounded-lg mb-4 whitespace-pre-wrap break-all">{error}</pre>
      )}

      <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">Active and history</h3>
      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        {items.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-gray-400">
            No instructions yet. Add one above and the bot will start using it on the next conversation.
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {items.map(it => (
              <div key={it.id} className={`px-5 py-4 ${it.active ? '' : 'opacity-50'}`}>
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-900">{it.instruction_text}</p>
                    <Directives directives={it.directives} />
                    <p className="text-[11px] text-gray-400 mt-2">
                      {timeAgo(it.created_at)}{it.expires_at ? ` · expires ${new Date(it.expires_at).toLocaleDateString()}` : ''}
                      {!it.active && ' · paused'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {it.active ? (
                      <button onClick={() => toggle(it.id, false)} className="text-xs px-3 py-1.5 rounded-md border border-gray-200 hover:bg-gray-50">
                        Pause
                      </button>
                    ) : (
                      <button onClick={() => toggle(it.id, true)} className="text-xs px-3 py-1.5 rounded-md bg-gray-900 text-white">
                        Resume
                      </button>
                    )}
                    <button onClick={() => remove(it.id)} className="text-xs text-gray-400 px-2 py-1.5 hover:text-red-600">
                      ✕
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
