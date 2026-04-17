'use client';
import { useEffect, useState } from 'react';
import { createClient } from '../../../lib/supabase';

const API = process.env.NEXT_PUBLIC_API_URL || 'https://api.botiga.ai';

const PLANS = [
  {
    key: 'free',
    name: 'Free',
    price: 0,
    priceLabel: 'Free forever',
    negotiations: '50 / month',
    fee: null,
    features: ['Basic friendly tone', 'Product rules', 'Botiga branding'],
    highlight: false
  },
  {
    key: 'starter',
    name: 'Starter',
    price: 29,
    priceLabel: '$29 / month',
    trial: '14-day free trial',
    negotiations: '500 / month',
    fee: '1% on closed deals',
    features: ['All tones + brand voice', 'Product & tag rules', 'Email recovery'],
    highlight: false
  },
  {
    key: 'growth',
    name: 'Growth',
    price: 79,
    priceLabel: '$79 / month',
    trial: '14-day free trial',
    negotiations: 'Unlimited',
    fee: '0.5% on closed deals',
    features: ['Everything in Starter', 'Cart bundle negotiation', 'WhatsApp + email recovery', 'Collection rules'],
    highlight: true
  },
  {
    key: 'pro',
    name: 'Pro',
    price: 199,
    priceLabel: '$199 / month',
    trial: '14-day free trial',
    negotiations: 'Unlimited',
    fee: 'No transaction fees',
    features: ['Everything in Growth', 'Shoppable video widget', 'White-label (no Botiga branding)', 'Priority support'],
    highlight: false
  }
];

export default function BillingPage() {
  const [merchantId, setMerchantId] = useState(null);
  const [status, setStatus] = useState(null);
  const [subscribing, setSubscribing] = useState(null);
  const supabase = createClient();

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setMerchantId(user.id);
      const res = await fetch(`${API}/api/merchants/${user.id}/billing/status`);
      if (res.ok) setStatus(await res.json());
    }
    load();

    // Handle return from Shopify billing confirmation
    const params = new URLSearchParams(window.location.search);
    if (params.get('billing_success')) {
      window.history.replaceState({}, '', '/dashboard/billing');
    }
  }, []);

  async function subscribe(planKey) {
    if (!merchantId) return;
    setSubscribing(planKey);
    try {
      const res = await fetch(`${API}/api/merchants/${merchantId}/billing/subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: planKey })
      });
      const data = await res.json();
      if (data.confirmation_url) {
        // Redirect to Shopify billing confirmation page
        window.location.href = data.confirmation_url;
      } else if (data.ok) {
        // Free plan downgrade
        const statusRes = await fetch(`${API}/api/merchants/${merchantId}/billing/status`);
        if (statusRes.ok) setStatus(await statusRes.json());
      }
    } catch (err) {
      alert('Billing error: ' + err.message);
    }
    setSubscribing(null);
  }

  const currentPlan = status?.plan || 'free';
  const usagePct = status?.negotiations_limit
    ? Math.min(100, Math.round(((status.negotiations_this_month || 0) / status.negotiations_limit) * 100))
    : 0;

  return (
    <div className="p-8 max-w-5xl space-y-8">
      <div>
        <h2 className="text-xl font-bold text-gray-900">Plans & Billing</h2>
        <p className="text-sm text-gray-500 mt-0.5">Billing is handled securely through Shopify.</p>
      </div>

      {/* Current usage */}
      {status && (
        <div className="bg-white border border-gray-100 rounded-xl p-6 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-700">Current plan: <span className="text-indigo-600 font-semibold capitalize">{status.plan_name}</span></p>
              {status.transaction_fee_pct > 0 && (
                <p className="text-xs text-gray-400 mt-0.5">{status.transaction_fee_pct}% transaction fee on closed deals</p>
              )}
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold text-gray-900">{status.negotiations_this_month ?? 0}</p>
              <p className="text-xs text-gray-400">{status.negotiations_limit ? `of ${status.negotiations_limit}` : 'unlimited'} negotiations this month</p>
            </div>
          </div>
          {status.negotiations_limit && (
            <div className="w-full bg-gray-100 rounded-full h-2">
              <div
                className={`h-2 rounded-full transition-all ${usagePct >= 90 ? 'bg-red-500' : usagePct >= 70 ? 'bg-yellow-500' : 'bg-indigo-600'}`}
                style={{ width: `${usagePct}%` }}
              />
            </div>
          )}
        </div>
      )}

      {/* Plan cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {PLANS.map(plan => {
          const isCurrent = currentPlan === plan.key;
          const isLoading = subscribing === plan.key;

          return (
            <div key={plan.key}
              className={`relative bg-white rounded-xl border p-5 flex flex-col ${plan.highlight ? 'border-indigo-500 shadow-md' : 'border-gray-100'}`}>
              {plan.highlight && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-indigo-600 text-white text-xs font-semibold px-3 py-1 rounded-full">
                  Most popular
                </div>
              )}
              {isCurrent && (
                <div className="absolute -top-3 right-4 bg-green-600 text-white text-xs font-semibold px-3 py-1 rounded-full">
                  Current
                </div>
              )}

              <div className="mb-4">
                <h3 className="font-bold text-gray-900">{plan.name}</h3>
                <p className="text-2xl font-bold text-gray-900 mt-1">{plan.priceLabel}</p>
                {plan.trial && <p className="text-xs text-indigo-600 mt-0.5">{plan.trial}</p>}
              </div>

              <div className="space-y-1.5 flex-1 mb-5">
                <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Included</div>
                <div className="text-sm text-gray-700">
                  <span className="font-medium">{plan.negotiations}</span> negotiations
                </div>
                {plan.fee && (
                  <div className="text-sm text-gray-500">{plan.fee}</div>
                )}
                <div className="border-t border-gray-50 pt-2 mt-2 space-y-1">
                  {plan.features.map(f => (
                    <div key={f} className="flex items-start gap-1.5 text-sm text-gray-600">
                      <span className="text-green-500 mt-0.5 flex-shrink-0">✓</span>
                      {f}
                    </div>
                  ))}
                </div>
              </div>

              <button
                disabled={isCurrent || isLoading}
                onClick={() => subscribe(plan.key)}
                className={`w-full py-2 rounded-lg text-sm font-medium transition-colors ${
                  isCurrent
                    ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                    : plan.highlight
                    ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                    : 'border border-gray-200 text-gray-700 hover:bg-gray-50'
                }`}
              >
                {isLoading ? 'Redirecting...' : isCurrent ? 'Current plan' : plan.key === 'free' ? 'Downgrade to Free' : `Upgrade to ${plan.name}`}
              </button>
            </div>
          );
        })}
      </div>

      <p className="text-xs text-gray-400 text-center">
        All plans billed monthly through Shopify. Cancel anytime. Shopify takes 20% of app revenue.
      </p>
    </div>
  );
}
