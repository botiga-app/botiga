'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '../../../lib/supabase';

const API = process.env.NEXT_PUBLIC_API_URL || 'https://api.botiga.ai';

const TIER_BADGE = {
  hot:  { emoji: '🔥', label: 'Hot',  className: 'bg-red-100 text-red-700' },
  warm: { emoji: '🌡️', label: 'Warm', className: 'bg-amber-100 text-amber-700' },
  cold: { emoji: '🌱', label: 'Cold', className: 'bg-blue-100 text-blue-700' },
};

const STATUS_LABEL = {
  human_escalated: 'Reached floor — go close it',
  won_abandoned:   'Won deal — never checked out',
  cold_lead:       'Captured on arrival',
  active:          'Active',
};

function timeAgo(iso) {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'just now';
  if (ms < 3_600_000) return Math.round(ms / 60_000) + 'm ago';
  if (ms < 86_400_000) return Math.round(ms / 3_600_000) + 'h ago';
  return Math.round(ms / 86_400_000) + 'd ago';
}

function fmt$(n) {
  if (n == null) return '—';
  return '$' + Math.round(Number(n)).toLocaleString();
}

function LeadRow({ lead, onMark }) {
  const tier = TIER_BADGE[lead.lead_tier] || TIER_BADGE.cold;
  const contact = lead.customer_email || lead.customer_whatsapp || '—';
  const contacted = !!lead.merchant_contacted_at;

  const mailto = lead.customer_email
    ? `mailto:${lead.customer_email}?subject=${encodeURIComponent(`About your ${lead.product_name || 'order'}`)}`
    : null;

  return (
    <div className={`px-5 py-4 flex items-center gap-4 border-b border-gray-50 ${contacted ? 'opacity-60' : ''}`}>
      <span className={`text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full ${tier.className}`}>
        {tier.emoji} {tier.label}
      </span>
      <div className="flex-1 min-w-0">
        <p className="font-medium text-gray-900 truncate">{lead.product_name || 'Unknown product'}</p>
        <p className="text-xs text-gray-400 mt-0.5">
          {STATUS_LABEL[lead.status] || lead.status} · {timeAgo(lead.last_message_at)}
        </p>
      </div>
      <div className="text-sm text-gray-600 w-40 truncate">
        <div className="text-xs text-gray-400">Contact</div>
        <div className="font-medium text-gray-900 truncate">{lead.customer_name ? `${lead.customer_name} · ` : ''}{contact}</div>
      </div>
      <div className="text-sm w-28 text-right">
        <div className="text-xs text-gray-400">You earn</div>
        <div className="font-semibold text-emerald-600">{fmt$(lead.earnable)}</div>
      </div>
      <div className="flex gap-2">
        {mailto && (
          <a href={mailto} className="text-xs px-3 py-1.5 rounded-md bg-gray-900 text-white hover:bg-black">
            Email
          </a>
        )}
        {!contacted ? (
          <button onClick={() => onMark(lead.id, 'contacted')}
            className="text-xs px-3 py-1.5 rounded-md border border-gray-200 hover:bg-gray-50">
            Mark contacted
          </button>
        ) : (
          <button onClick={() => onMark(lead.id, 'new')}
            className="text-xs px-3 py-1.5 rounded-md border border-gray-200 text-gray-500">
            Reopen
          </button>
        )}
        <button onClick={() => onMark(lead.id, 'dismissed')}
          className="text-xs px-2 py-1.5 rounded-md text-gray-400 hover:text-gray-600">
          Dismiss
        </button>
      </div>
    </div>
  );
}

function UpgradeBanner({ lockedCount, plan, tier }) {
  if (!lockedCount) return null;
  const next = plan === 'free' ? 'Starter' : 'Pro';
  return (
    <div className="px-5 py-3 bg-gradient-to-r from-amber-50 to-orange-50 border-t border-amber-100 text-sm flex items-center justify-between">
      <span className="text-amber-900">
        🔒 +{lockedCount} more {tier} {lockedCount === 1 ? 'lead' : 'leads'} locked.
        <span className="text-amber-700 ml-1">Upgrade to {next} to see them all.</span>
      </span>
      <Link href="/dashboard/billing" className="text-xs px-3 py-1.5 rounded-md bg-amber-600 text-white hover:bg-amber-700 font-medium">
        Upgrade
      </Link>
    </div>
  );
}

function Section({ title, leads, lockedCount, plan, tier, onMark, emptyHint }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 overflow-hidden mb-6">
      <div className="px-5 py-3 border-b border-gray-50 flex items-center justify-between">
        <h3 className="font-semibold text-gray-900">{title}</h3>
        <span className="text-xs text-gray-500">{leads.length}{lockedCount ? ` of ${leads.length + lockedCount}` : ''}</span>
      </div>
      {leads.length === 0 ? (
        <div className="px-5 py-8 text-center text-sm text-gray-400">{emptyHint}</div>
      ) : (
        <div className="divide-y divide-gray-50">
          {leads.map(l => <LeadRow key={l.id} lead={l} onMark={onMark} />)}
        </div>
      )}
      <UpgradeBanner lockedCount={lockedCount} plan={plan} tier={tier} />
    </div>
  );
}

export default function LeadsPage() {
  const [data, setData] = useState(null);
  const [merchantId, setMerchantId] = useState(null);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  async function load(id) {
    const res = await fetch(`${API}/api/leads/${id}`);
    if (res.ok) setData(await res.json());
    setLoading(false);
  }

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setMerchantId(user.id);
      await load(user.id);
    })();
  }, []);

  async function mark(id, lead_status) {
    await fetch(`${API}/api/leads/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lead_status }),
    });
    if (merchantId) load(merchantId);
  }

  if (loading) {
    return <div className="p-8 text-sm text-gray-400">Loading leads…</div>;
  }
  if (!data) {
    return <div className="p-8 text-sm text-gray-400">No leads yet.</div>;
  }

  const totalLeads = data.counts.hot + data.counts.warm + data.counts.cold;

  return (
    <div className="p-8 max-w-5xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Leads</h2>
          <p className="text-sm text-gray-500">Customers your bot couldn't quite close — go win them back.</p>
        </div>
        <div className="text-right">
          <div className="text-xs text-gray-400 uppercase tracking-wider">You could earn</div>
          <div className="text-2xl font-bold text-emerald-600">{fmt$(data.total_earnable)}</div>
          <div className="text-xs text-gray-400">across {totalLeads} {totalLeads === 1 ? 'lead' : 'leads'} · {data.plan} plan</div>
        </div>
      </div>

      <Section
        title="🔥 Hot — reach out today"
        leads={data.hot}
        lockedCount={data.locked_counts.hot}
        plan={data.plan}
        tier="hot"
        onMark={mark}
        emptyHint="No hot leads right now. They show up when a customer reaches your floor and goes quiet, or when a deal is won but never checked out."
      />

      <Section
        title="🌡️ Warm — engaged but didn't reach the floor"
        leads={data.warm}
        lockedCount={data.locked_counts.warm}
        plan={data.plan}
        tier="warm"
        onMark={mark}
        emptyHint="No warm leads yet."
      />

      <Section
        title="🌱 Cold — captured on arrival"
        leads={data.cold}
        lockedCount={data.locked_counts.cold}
        plan={data.plan}
        tier="cold"
        onMark={mark}
        emptyHint="No cold leads yet. The concierge captures these when shoppers drop their email on first arrival."
      />
    </div>
  );
}
