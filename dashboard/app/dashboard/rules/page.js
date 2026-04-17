'use client';
import { useEffect, useState } from 'react';
import { createClient } from '../../../lib/supabase';

const API = process.env.NEXT_PUBLIC_API_URL || 'https://api.botiga.ai';

const RULE_TYPE_LABELS = { product: 'Product', tag: 'Tag' };

function Badge({ negotiable }) {
  return negotiable
    ? <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-50 text-green-700">Negotiable</span>
    : <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-50 text-red-700">Blocked</span>;
}

function AddRuleModal({ onClose, onSave }) {
  const [form, setForm] = useState({
    rule_type: 'product',
    entity_id: '',
    entity_name: '',
    negotiable: true,
    max_discount_pct: '',
    floor_price_fixed: ''
  });
  const [saving, setSaving] = useState(false);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  async function handleSave() {
    if (!form.entity_id.trim()) return;
    setSaving(true);
    await onSave({
      ...form,
      entity_id: form.entity_id.trim().toLowerCase(),
      entity_name: form.entity_name.trim() || form.entity_id.trim(),
      max_discount_pct: form.max_discount_pct ? parseInt(form.max_discount_pct) : null,
      floor_price_fixed: form.floor_price_fixed ? parseFloat(form.floor_price_fixed) : null
    });
    setSaving(false);
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-gray-900 text-lg">Add rule</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Rule type</label>
            <select
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
              value={form.rule_type}
              onChange={e => set('rule_type', e.target.value)}
            >
              <option value="product">Product (by handle)</option>
              <option value="tag">Tag</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              {form.rule_type === 'product' ? 'Product handle' : 'Tag name'}
            </label>
            <input
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
              placeholder={form.rule_type === 'product' ? 'e.g. pearl-bridal-hair-vine' : 'e.g. sale, clearance'}
              value={form.entity_id}
              onChange={e => set('entity_id', e.target.value)}
            />
            {form.rule_type === 'product' && (
              <p className="text-xs text-gray-400 mt-1">Find the handle in the product URL: /products/<strong>handle</strong></p>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Display name (optional)</label>
            <input
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
              placeholder="Friendly label for this rule"
              value={form.entity_name}
              onChange={e => set('entity_name', e.target.value)}
            />
          </div>

          <div className="flex items-center gap-3 pt-1">
            <label className="text-sm font-medium text-gray-700">Allow negotiation</label>
            <button
              onClick={() => set('negotiable', !form.negotiable)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${form.negotiable ? 'bg-indigo-600' : 'bg-gray-200'}`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${form.negotiable ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
          </div>

          {form.negotiable && (
            <div className="grid grid-cols-2 gap-3 pt-1">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Max discount %</label>
                <input
                  type="number" min="0" max="100"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                  placeholder="e.g. 15 (global default if blank)"
                  value={form.max_discount_pct}
                  onChange={e => set('max_discount_pct', e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Floor price $</label>
                <input
                  type="number" min="0"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                  placeholder="e.g. 45 (global default if blank)"
                  value={form.floor_price_fixed}
                  onChange={e => set('floor_price_fixed', e.target.value)}
                />
              </div>
            </div>
          )}
        </div>

        <div className="flex gap-2 pt-2">
          <button onClick={onClose} className="flex-1 px-4 py-2 text-sm border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !form.entity_id.trim()}
            className="flex-1 px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save rule'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function RulesPage() {
  const [merchantId, setMerchantId] = useState(null);
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const supabase = createClient();

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setMerchantId(user.id);
      const res = await fetch(`${API}/api/merchants/${user.id}/rules`);
      if (res.ok) setRules(await res.json());
      setLoading(false);
    }
    load();
  }, []);

  async function handleSave(form) {
    const res = await fetch(`${API}/api/merchants/${merchantId}/rules`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form)
    });
    if (res.ok) {
      const rule = await res.json();
      setRules(prev => [rule, ...prev.filter(r => r.id !== rule.id)]);
    }
    setShowAdd(false);
  }

  async function toggleNegotiable(rule) {
    const res = await fetch(`${API}/api/merchants/${merchantId}/rules/${rule.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ negotiable: !rule.negotiable })
    });
    if (res.ok) {
      const updated = await res.json();
      setRules(prev => prev.map(r => r.id === updated.id ? updated : r));
    }
  }

  async function deleteRule(ruleId) {
    await fetch(`${API}/api/merchants/${merchantId}/rules/${ruleId}`, { method: 'DELETE' });
    setRules(prev => prev.filter(r => r.id !== ruleId));
  }

  return (
    <div className="p-8 max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Product rules</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Control which products are negotiable and set per-product discount limits.
            Rules apply in order: product → tag → global default.
          </p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700"
        >
          + Add rule
        </button>
      </div>

      {/* Cart negotiation callout */}
      <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-4 text-sm text-indigo-800">
        <strong>Cart negotiation</strong> is independent of product rules — it's controlled by the
        &ldquo;Negotiate on cart&rdquo; toggle in{' '}
        <a href="/dashboard/settings" className="underline">Settings</a>.
      </div>

      {loading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : rules.length === 0 ? (
        <div className="bg-white border border-gray-100 rounded-xl p-10 text-center">
          <p className="text-gray-500 text-sm">No rules yet — all products use the global settings.</p>
          <button onClick={() => setShowAdd(true)} className="mt-3 text-indigo-600 text-sm font-medium hover:underline">
            Add your first rule →
          </button>
        </div>
      ) : (
        <div className="bg-white border border-gray-100 rounded-xl divide-y divide-gray-50">
          {rules.map(rule => (
            <div key={rule.id} className="flex items-center justify-between px-5 py-4">
              <div className="flex items-center gap-3 min-w-0">
                <span className="text-xs font-medium text-gray-400 uppercase tracking-wide w-14 flex-shrink-0">
                  {RULE_TYPE_LABELS[rule.rule_type]}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{rule.entity_name}</p>
                  <p className="text-xs text-gray-400 font-mono truncate">{rule.entity_id}</p>
                </div>
              </div>
              <div className="flex items-center gap-4 flex-shrink-0 ml-4">
                {rule.negotiable && (rule.max_discount_pct || rule.floor_price_fixed) && (
                  <span className="text-xs text-gray-400">
                    {rule.max_discount_pct ? `max ${rule.max_discount_pct}%` : ''}
                    {rule.max_discount_pct && rule.floor_price_fixed ? ' · ' : ''}
                    {rule.floor_price_fixed ? `floor $${rule.floor_price_fixed}` : ''}
                  </span>
                )}
                <button onClick={() => toggleNegotiable(rule)} title="Toggle negotiable">
                  <Badge negotiable={rule.negotiable} />
                </button>
                <button
                  onClick={() => deleteRule(rule.id)}
                  className="text-gray-300 hover:text-red-400 text-sm transition-colors"
                  title="Delete rule"
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showAdd && <AddRuleModal onClose={() => setShowAdd(false)} onSave={handleSave} />}
    </div>
  );
}
