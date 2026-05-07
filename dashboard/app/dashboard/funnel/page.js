'use client';
import { useEffect, useState } from 'react';
import { createClient } from '../../../lib/supabase';

const API = process.env.NEXT_PUBLIC_API_URL || 'https://api.botiga.ai';

const STAGE_LABELS = {
  arrived:     '👋 Arrived',
  engaged:     '💬 Engaged',
  captured:    '📧 Captured',
  discovered:  '🔍 Discovered',
  negotiated:  '🤝 Negotiated',
  held:        '🔖 Held',
  won:         '🏆 Won',
  checked_out: '✅ Checked out',
  lost:        '🚪 Lost',
};

const STAGE_ORDER = ['arrived','engaged','captured','discovered','negotiated','held','won','checked_out'];
const STAGE_BADGE = {
  arrived:     'bg-gray-100 text-gray-700',
  engaged:     'bg-blue-100 text-blue-700',
  captured:    'bg-purple-100 text-purple-700',
  discovered:  'bg-cyan-100 text-cyan-700',
  negotiated:  'bg-amber-100 text-amber-700',
  held:        'bg-orange-100 text-orange-700',
  won:         'bg-emerald-100 text-emerald-700',
  checked_out: 'bg-green-100 text-green-700',
  lost:        'bg-red-50 text-red-500',
};

function timeAgo(iso) {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'just now';
  if (ms < 3_600_000) return Math.round(ms / 60_000) + 'm ago';
  if (ms < 86_400_000) return Math.round(ms / 3_600_000) + 'h ago';
  return Math.round(ms / 86_400_000) + 'd ago';
}

function fmt$(n) { if (n == null) return '—'; return '$' + Math.round(Number(n)).toLocaleString(); }

function FunnelBar({ reach, total, days }) {
  const stages = STAGE_ORDER;
  const max = Math.max(total, 1);
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-gray-900">Funnel · last {days}d</h3>
        <span className="text-xs text-gray-500">{total} unique visitors</span>
      </div>
      <div className="space-y-2">
        {stages.map((s, i) => {
          const count = reach[s] || 0;
          const pct = max ? Math.round((count / max) * 100) : 0;
          const dropFromPrev = i > 0 && (reach[stages[i - 1]] || 0) > 0
            ? Math.round((1 - count / (reach[stages[i - 1]] || 1)) * 100)
            : 0;
          return (
            <div key={s} className="flex items-center gap-3">
              <div className="w-32 text-xs font-medium text-gray-700 flex-shrink-0">{STAGE_LABELS[s]}</div>
              <div className="flex-1 bg-gray-50 rounded-md h-7 relative overflow-hidden">
                <div
                  className="absolute inset-y-0 left-0 bg-gradient-to-r from-indigo-400 to-purple-500"
                  style={{ width: pct + '%' }}
                />
                <div className="absolute inset-0 flex items-center justify-end pr-2 text-xs font-medium text-gray-900">
                  {count}
                </div>
              </div>
              <div className="w-14 text-right text-[11px] text-gray-400 flex-shrink-0">
                {i > 0 && dropFromPrev > 0 ? `−${dropFromPrev}%` : ''}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function VisitorRow({ v }) {
  const stages = (v.stages || []).slice().sort((a, b) => STAGE_ORDER.indexOf(a) - STAGE_ORDER.indexOf(b));
  const dwell = v.dwell || [];
  const totalDwell = dwell.reduce((s, d) => s + (d.seconds || 0), 0);
  return (
    <div className="px-5 py-3 border-b border-gray-50">
      <div className="flex items-center gap-3">
        <span className={`text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full ${STAGE_BADGE[v.max_stage] || 'bg-gray-100'}`}>
          {STAGE_LABELS[v.max_stage] || v.max_stage}
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-xs text-gray-700 font-mono truncate">{v.session_id.slice(0, 14)}…</div>
          <div className="text-[11px] text-gray-400 mt-0.5">
            {stages.length} stages · {totalDwell > 0 ? `${totalDwell}s dwell` : 'no dwell'} · {timeAgo(v.last_seen)}
          </div>
        </div>
        {dwell.length > 0 && (
          <div className="hidden md:flex items-center gap-1.5 max-w-[40%] overflow-hidden">
            {dwell.slice(0, 3).map((d, i) => (
              <span key={i} className="text-[11px] bg-gray-50 border border-gray-100 rounded px-2 py-0.5 truncate" title={d.handle}>
                {d.handle.slice(0, 18)} <span className="text-gray-400">{d.seconds}s</span>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function FunnelPage() {
  const [data, setData] = useState(null);
  const [merchantId, setMerchantId] = useState(null);
  const [days, setDays] = useState(7);
  const [error, setError] = useState(null);
  const supabase = createClient();

  async function load(id, d) {
    setError(null);
    try {
      const res = await fetch(`${API}/api/merchants/${id}/funnel?days=${d}`);
      if (!res.ok) {
        setError(`API ${res.status}: ${(await res.text()).slice(0, 200)}`);
        return;
      }
      setData(await res.json());
    } catch (e) { setError(e.message); }
  }

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setMerchantId(user.id);
      load(user.id, days);
    })();
  }, []);

  useEffect(() => { if (merchantId) load(merchantId, days); }, [days]);

  if (error) {
    return (
      <div className="p-8">
        <h2 className="text-lg font-bold text-red-700 mb-2">Funnel API failed</h2>
        <pre className="text-xs bg-red-50 border border-red-200 p-3 rounded text-red-900 whitespace-pre-wrap break-all">{error}</pre>
      </div>
    );
  }

  if (!data) return <div className="p-8 text-sm text-gray-400">Loading funnel…</div>;

  const total = data.total_visitors || 0;
  const captured = data.reach?.captured || 0;
  const negotiated = data.reach?.negotiated || 0;
  const won = data.reach?.won || 0;
  const earnable = data.earnable_pending || 0;

  return (
    <div className="p-8 max-w-5xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Visitor funnel</h2>
          <p className="text-sm text-gray-500">Where shoppers drop off — and how much you could earn back.</p>
        </div>
        <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
          {[1, 7, 30, 90].map(d => (
            <button key={d} onClick={() => setDays(d)}
              className={`px-3 py-1.5 text-xs rounded-md ${days === d ? 'bg-white shadow-sm font-medium text-gray-900' : 'text-gray-500'}`}>
              {d}d
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-4 gap-3 mb-6">
        <div className="bg-white rounded-lg border border-gray-100 p-4">
          <div className="text-[10px] uppercase tracking-wider text-gray-400">Visitors</div>
          <div className="text-2xl font-bold text-gray-900 mt-1">{total}</div>
        </div>
        <div className="bg-white rounded-lg border border-gray-100 p-4">
          <div className="text-[10px] uppercase tracking-wider text-gray-400">Captured</div>
          <div className="text-2xl font-bold text-purple-700 mt-1">{captured}</div>
          <div className="text-[10px] text-gray-400 mt-0.5">{total ? Math.round((captured / total) * 100) : 0}% of visitors</div>
        </div>
        <div className="bg-white rounded-lg border border-gray-100 p-4">
          <div className="text-[10px] uppercase tracking-wider text-gray-400">Negotiated</div>
          <div className="text-2xl font-bold text-amber-700 mt-1">{negotiated}</div>
          <div className="text-[10px] text-gray-400 mt-0.5">{captured ? Math.round((negotiated / captured) * 100) : 0}% of captured</div>
        </div>
        <div className="bg-white rounded-lg border border-gray-100 p-4">
          <div className="text-[10px] uppercase tracking-wider text-gray-400">You could earn</div>
          <div className="text-2xl font-bold text-emerald-600 mt-1">{fmt$(earnable)}</div>
          <div className="text-[10px] text-gray-400 mt-0.5">in pending leads</div>
        </div>
      </div>

      <div className="mb-6">
        <FunnelBar reach={data.reach || {}} total={total} days={days} />
      </div>

      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-50 flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">Recent visitors</h3>
          <span className="text-xs text-gray-500">{(data.visitors || []).length} shown</span>
        </div>
        {(data.visitors || []).length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-gray-400">No visitors yet in this window.</div>
        ) : (
          <div>
            {(data.visitors || []).map(v => <VisitorRow key={v.session_id} v={v} />)}
          </div>
        )}
      </div>
    </div>
  );
}
