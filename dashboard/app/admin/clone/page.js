'use client';
import { useEffect, useRef, useState } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL || 'https://api.botiga.ai';
const ADMIN_SECRET = process.env.NEXT_PUBLIC_ADMIN_SECRET || '';

const PHASE_LABEL = {
  products: 'Products',
  policies: 'Policies',
  pages: 'Pages',
  done: 'Done',
};

export default function AdminClonePage() {
  const [targets, setTargets] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [sourceUrl, setSourceUrl] = useState('');
  const [targetId, setTargetId] = useState('');
  const [activeJob, setActiveJob] = useState(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState(null);
  const stopRef = useRef(false);

  const headers = { 'x-admin-secret': ADMIN_SECRET };

  async function loadTargets() {
    const res = await fetch(`${API}/api/admin/clone/targets`, { headers });
    if (res.ok) setTargets(await res.json());
  }
  async function loadJobs() {
    const res = await fetch(`${API}/api/admin/clone/jobs`, { headers });
    if (res.ok) setJobs(await res.json());
  }
  useEffect(() => { loadTargets(); loadJobs(); }, []);

  async function startClone() {
    setError(null);
    if (!sourceUrl || !targetId) { setError('Pick a target and enter a source URL'); return; }
    const res = await fetch(`${API}/api/admin/clone/start`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ source_url: sourceUrl, target_merchant_id: targetId }),
    });
    const data = await res.json();
    if (!res.ok) { setError(data.error || 'Failed to start'); return; }
    setActiveJob(data.job);
    runTickLoop(data.job_id);
  }

  async function resumeJob(job) {
    setError(null);
    setActiveJob(job);
    runTickLoop(job.id);
  }

  async function runTickLoop(jobId) {
    setRunning(true);
    stopRef.current = false;
    try {
      while (!stopRef.current) {
        const res = await fetch(`${API}/api/admin/clone/tick?job_id=${jobId}`, {
          method: 'POST', headers,
        });
        const data = await res.json();
        if (!res.ok) { setError(data.error || 'tick failed'); break; }
        setActiveJob(data.job);
        if (!data.has_more) break;
      }
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setRunning(false);
      loadJobs();
    }
  }

  function stopLoop() {
    stopRef.current = true;
  }

  return (
    <div className="p-8">
      <div className="mb-6">
        <h2 className="text-xl font-bold text-gray-900">Clone a real storefront</h2>
        <p className="text-sm text-gray-500 mt-1">
          Pulls a public Shopify storefront's catalog + policies + pages into one
          of our dev stores. Use this to build a real-shaped sandbox for concierge
          eval testing. Idempotent — re-running a job skips items already imported.
        </p>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 p-5 mb-6">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Start a new clone</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Source URL</label>
            <input type="text" value={sourceUrl}
              onChange={e => setSourceUrl(e.target.value)}
              placeholder="https://shopwhb.com"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Target dev store</label>
            <select value={targetId}
              onChange={e => setTargetId(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white">
              <option value="">Select…</option>
              {targets.map(t => (
                <option key={t.id} value={t.id}>
                  [{t.kind}] {t.shopify_domain || t.name || t.id.slice(0, 8)}
                  {t.source_url ? ` (was: ${shortUrl(t.source_url)})` : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <button onClick={startClone} disabled={running}
              className="px-4 py-2 bg-gray-900 text-white text-sm rounded-lg hover:bg-gray-800 disabled:bg-gray-400">
              {running ? 'Running…' : 'Start clone'}
            </button>
            {running && (
              <button onClick={stopLoop}
                className="ml-2 px-4 py-2 bg-white border border-gray-200 text-sm rounded-lg hover:bg-gray-50">
                Pause
              </button>
            )}
          </div>
        </div>
        {error && <div className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</div>}
      </div>

      {activeJob && <ActiveJobPanel job={activeJob} running={running} />}

      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100">
          <h3 className="text-sm font-semibold text-gray-700">Recent clone jobs</h3>
        </div>
        <div className="divide-y divide-gray-50">
          {jobs.length === 0 && (
            <div className="p-6 text-center text-sm text-gray-400">No clone jobs yet.</div>
          )}
          {jobs.map(j => (
            <div key={j.id} className="px-5 py-3 flex items-center gap-4 text-sm">
              <StatusPill status={j.status} />
              <div className="flex-1 min-w-0">
                <p className="font-medium text-gray-900 truncate">{j.source_url}</p>
                <p className="text-xs text-gray-400">
                  → {j.merchants?.shopify_domain || j.merchant_id.slice(0, 8)} ·
                  {' '}{j.products_imported} products · {j.policies_imported} policies · {j.pages_imported} pages
                  {j.last_error && <span className="text-red-500"> · {j.last_error.slice(0, 80)}</span>}
                </p>
              </div>
              <div className="text-xs text-gray-400">{relTime(j.started_at)}</div>
              {(j.status === 'pending' || j.status === 'running' || j.status === 'error') && (
                <button onClick={() => resumeJob(j)} disabled={running}
                  className="px-3 py-1 text-xs bg-gray-100 hover:bg-gray-200 rounded-lg disabled:opacity-50">
                  {j.status === 'error' ? 'Retry' : 'Resume'}
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ActiveJobPanel({ job, running }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-5 mb-6">
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-sm font-semibold text-gray-900">{job.source_url}</p>
          <p className="text-xs text-gray-400">Job {job.id.slice(0, 8)} · phase: {PHASE_LABEL[job.current_phase] || job.current_phase}</p>
        </div>
        <StatusPill status={job.status} />
      </div>
      <div className="grid grid-cols-3 gap-3 mb-3 text-sm">
        <Stat label="Products imported" value={job.products_imported} sub={job.current_phase === 'products' ? `page ${job.products_page}, offset ${job.products_offset}` : null} />
        <Stat label="Policies imported" value={job.policies_imported} />
        <Stat label="Pages imported" value={`${job.pages_imported}${job.pages_queue?.length ? ` / ${job.pages_queue.length}` : ''}`} />
      </div>
      {Array.isArray(job.log) && job.log.length > 0 && (
        <div className="mt-3 max-h-48 overflow-auto bg-gray-900 text-gray-200 text-xs font-mono rounded-lg p-3">
          {job.log.slice(-30).map((entry, i) => (
            <div key={i} className={entry.level === 'error' ? 'text-red-300' : entry.level === 'warn' ? 'text-yellow-300' : 'text-gray-300'}>
              <span className="text-gray-500">{entry.ts?.slice(11, 19)} </span>
              {entry.msg}
            </div>
          ))}
        </div>
      )}
      {running && <p className="mt-2 text-xs text-gray-400">Polling tick endpoint until done…</p>}
    </div>
  );
}

function Stat({ label, value, sub }) {
  return (
    <div className="bg-gray-50 rounded-lg p-3">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-lg font-semibold text-gray-900">{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  );
}

function StatusPill({ status }) {
  const map = {
    pending: 'bg-gray-100 text-gray-700',
    running: 'bg-blue-100 text-blue-700',
    done:    'bg-green-100 text-green-700',
    error:   'bg-red-100 text-red-700',
  };
  return <span className={`text-xs px-2 py-1 rounded-full ${map[status] || map.pending}`}>{status}</span>;
}

function shortUrl(u) {
  try { return new URL(u).hostname; } catch { return u; }
}

function relTime(ts) {
  if (!ts) return '';
  const diff = Date.now() - new Date(ts).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s/60)}m ago`;
  if (s < 86400) return `${Math.floor(s/3600)}h ago`;
  return `${Math.floor(s/86400)}d ago`;
}
