'use client';
import { useEffect, useState } from 'react';
import { createClient } from '../../../lib/supabase';
import TonePicker from '../../../components/TonePicker';
import ButtonCustomizer from '../../../components/ButtonCustomizer';
import BrokerFeeBreakdown from '../../../components/BrokerFeeBreakdown';

const API = process.env.NEXT_PUBLIC_API_URL || 'https://api.botiga.ai';

function Section({ title, children }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-6 space-y-4">
      <h3 className="font-semibold text-gray-900">{title}</h3>
      {children}
    </div>
  );
}

export default function SettingsPage() {
  const [settings, setSettings] = useState(null);
  const [merchantId, setMerchantId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const supabase = createClient();

  // Example prices for fee calc
  const [exampleList, setExampleList] = useState(89);
  const [exampleFloor, setExampleFloor] = useState(72);

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setMerchantId(user.id);
      const res = await fetch(`${API}/api/merchants/${user.id}`);
      if (res.ok) {
        const data = await res.json();
        setSettings(data.merchant_settings || {
          tone: 'friendly',
          button_label: 'Make an offer',
          button_color: null,
          button_text_color: null,
          button_position: 'below-cart',
          max_discount_pct: 20,
          floor_price_pct: null,
          floor_price_fixed: null,
          broker_fee_pct: 25,
          negotiate_on_product: true,
          negotiate_on_cart: true,
          recovery_enabled: true,
          recovery_channel: 'whatsapp',
          dwell_time_seconds: 30
        });
      }
    }
    load();
  }, []);

  async function save() {
    if (!merchantId || !settings) return;
    setSaving(true);
    const res = await fetch(`${API}/api/merchants/${merchantId}/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings)
    });
    setSaving(false);
    if (res.ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    }
  }

  function update(patch) {
    setSettings(s => ({ ...s, ...patch }));
  }

  if (!settings) {
    return <div className="p-8 text-gray-400 text-sm">Loading settings...</div>;
  }

  return (
    <div className="p-8 max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Bot Settings</h2>
          <p className="text-sm text-gray-500">Configure your negotiation bot</p>
        </div>
        <button onClick={save} disabled={saving}
          className="bg-indigo-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-60">
          {saving ? 'Saving...' : saved ? '✓ Saved' : 'Save changes'}
        </button>
      </div>

      {/* Bot Personality */}
      <Section title="Bot Personality">
        <TonePicker value={settings.tone} onChange={tone => update({ tone })} />
      </Section>

      {/* Button Customization */}
      <Section title="Button Customization">
        <ButtonCustomizer
          label={settings.button_label}
          color={settings.button_color}
          textColor={settings.button_text_color}
          onChange={patch => update({
            ...(patch.label !== undefined ? { button_label: patch.label } : {}),
            ...(patch.color !== undefined ? { button_color: patch.color } : {}),
            ...(patch.textColor !== undefined ? { button_text_color: patch.textColor } : {}),
            ...(patch.position !== undefined ? { button_position: patch.position } : {})
          })}
        />
      </Section>

      {/* Pricing Rules */}
      <Section title="Pricing Rules">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Max discount % <span className="text-gray-400 font-normal">(off list price)</span>
            </label>
            <div className="flex items-center gap-3">
              <input type="range" min={0} max={50} step={1}
                value={settings.max_discount_pct || 20}
                onChange={e => update({ max_discount_pct: Number(e.target.value) })}
                className="flex-1" />
              <span className="text-sm font-semibold w-10 text-right">{settings.max_discount_pct || 20}%</span>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Floor price — fixed $</label>
            <input type="number" min={0} step={0.01}
              value={settings.floor_price_fixed || ''}
              onChange={e => update({ floor_price_fixed: e.target.value ? Number(e.target.value) : null })}
              placeholder="e.g. 49.99"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500" />
          </div>
        </div>

        <div className="mt-4">
          <p className="text-xs text-gray-500 mb-3 font-medium uppercase tracking-wide">Broker fee calculator</p>
          <div className="grid grid-cols-2 gap-4 mb-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Example list price ($)</label>
              <input type="number" value={exampleList} onChange={e => setExampleList(Number(e.target.value))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Example floor price ($)</label>
              <input type="number" value={exampleFloor} onChange={e => setExampleFloor(Number(e.target.value))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500" />
            </div>
          </div>
          <BrokerFeeBreakdown
            listPrice={exampleList}
            floorPrice={exampleFloor}
            brokerFeePct={settings.broker_fee_pct || 25}
          />
        </div>
      </Section>

      {/* Triggers */}
      <Section title="Triggers & Recovery">
        <div className="space-y-4">
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" checked={settings.negotiate_on_product}
              onChange={e => update({ negotiate_on_product: e.target.checked })}
              className="w-4 h-4 rounded text-indigo-600" />
            <div>
              <div className="text-sm font-medium text-gray-700">Show on product pages</div>
              <div className="text-xs text-gray-400">Inject button on individual product pages</div>
            </div>
          </label>

          <div className="pl-7">
            <label className="block text-sm text-gray-600 mb-1">
              Dwell time before button appears: <strong>{settings.dwell_time_seconds}s</strong>
            </label>
            <input type="range" min={0} max={120} step={5}
              value={settings.dwell_time_seconds || 30}
              onChange={e => update({ dwell_time_seconds: Number(e.target.value) })}
              className="w-full max-w-xs" />
          </div>

          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" checked={settings.negotiate_on_cart}
              onChange={e => update({ negotiate_on_cart: e.target.checked })}
              className="w-4 h-4 rounded text-indigo-600" />
            <div>
              <div className="text-sm font-medium text-gray-700">Show on cart page</div>
              <div className="text-xs text-gray-400">Allow negotiations on the cart page</div>
            </div>
          </label>

          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" checked={settings.recovery_enabled}
              onChange={e => update({ recovery_enabled: e.target.checked })}
              className="w-4 h-4 rounded text-indigo-600" />
            <div>
              <div className="text-sm font-medium text-gray-700">Abandoned deal recovery</div>
              <div className="text-xs text-gray-400">Send follow-up messages when deals are abandoned</div>
            </div>
          </label>

          {settings.recovery_enabled && (
            <div className="pl-7">
              <label className="block text-sm text-gray-600 mb-2">Recovery channel</label>
              <div className="flex gap-3">
                {['whatsapp', 'email', 'both'].map(ch => (
                  <label key={ch} className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" name="recovery_channel" value={ch}
                      checked={settings.recovery_channel === ch}
                      onChange={() => update({ recovery_channel: ch })}
                      className="text-indigo-600" />
                    <span className="text-sm text-gray-600 capitalize">{ch === 'both' ? 'WhatsApp + Email' : ch}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
      </Section>
    </div>
  );
}
