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
  const [openingPortal, setOpeningPortal] = useState(false);
  const supabase = createClient();

  async function refresh() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setMerchantId(user.id);
    const res = await fetch(`${API}/api/merchants/${user.id}/billing/status`);
    if (res.ok) setStatus(await res.json());
  }

  useEffect(() => {
    refresh();
    // Handle return from Stripe Checkout — strip the query param and re-fetch
    const params = new URLSearchParams(window.location.search);
    if (params.get('billing_success') || params.get('billing_canceled')) {
      window.history.replaceState({}, '', '/dashboard/billing');
      // Refresh after a tick in case the webhook is still mid-flight
      setTimeout(refresh, 1200);
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
        // Redirect to Stripe Checkout
        window.location.href = data.confirmation_url;
      } else if (data.ok) {
        // Free plan downgrade — re-fetch status
        await refresh();
      } else if (data.error) {
        alert('Billing error: ' + (data.detail || data.error));
      }
    } catch (err) {
      alert('Billing error: ' + err.message);
    }
    setSubscribing(null);
  }

  async function openPortal() {
    if (!merchantId) return;
    setOpeningPortal(true);
    try {
      const res = await fetch(`${API}/api/merchants/${merchantId}/billing/portal`, { method: 'POST' });
      const data = await res.json();
      if (data.url) window.location.href = data.url;
      else alert('Could not open billing portal: ' + (data.error || 'unknown error'));
    } catch (err) {
      alert('Portal error: ' + err.message);
    }
    setOpeningPortal(false);
  }

  const currentPlan = status?.plan || 'free';
  const usagePct = status?.negotiations_limit
    ? Math.min(100, Math.round(((status.negotiations_this_month || 0) / status.negotiations_limit) * 100))
    : 0;

  return (
    <div className="p-8 max-w-5xl space-y-8">
      <div>
        <h2 className="text-xl font-bold text-gray-900">Plans & Billing</h2>
        <p className="text-sm text-gray-500 mt-0.5">Billing is handled securely through Stripe. Cancel anytime from the portal.</p>
      </div>

      {/* 80% / hard-stop warning banner */}
      {status?.negotiations_limit && usagePct >= 80 && (
        <div className={`rounded-xl border p-4 flex items-start justify-between gap-4 ${
          usagePct >= 100 ? 'bg-red-50 border-red-200 text-red-800' : 'bg-amber-50 border-amber-200 text-amber-900'
        }`}>
          <div className="text-sm">
            {usagePct >= 100 ? (
              <>
                <strong>You've hit your monthly limit.</strong> New negotiations are paused until you upgrade or the month resets.
              </>
            ) : (
              <>
                <strong>You're at {usagePct}% of your monthly negotiations.</strong> Upgrade to keep the widget running once you hit the cap.
              </>
            )}
          </div>
          <button
            onClick={() => subscribe('growth')}
            className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg flex-shrink-0"
          >
            Upgrade to Growth
          </button>
        </div>
      )}

      {/* Current usage */}
      {status && (
        <div className="bg-white border border-gray-100 rounded-xl p-6 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-700">Current plan: <span className="text-indigo-600 font-semibold capitalize">{status.plan_name}</span></p>
              {status.subscription_status && status.subscription_status !== 'active' && (
                <p className="text-xs mt-0.5 capitalize">
                  <span className={`px-2 py-0.5 rounded ${
                    status.subscription_status === 'trialing' ? 'bg-indigo-50 text-indigo-700' :
                    status.subscription_status === 'past_due' ? 'bg-red-50 text-red-700' :
                    'bg-gray-100 text-gray-600'
                  }`}>
                    {status.subscription_status.replace('_', ' ')}
                  </span>
                </p>
              )}
              {status.plan_period_end && (
                <p className="text-xs text-gray-400 mt-0.5">Renews {new Date(status.plan_period_end).toLocaleDateString()}</p>
              )}
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
          {status.has_subscription && (
            <div className="pt-3 border-t border-gray-50 flex justify-end">
              <button
                onClick={openPortal}
                disabled={openingPortal}
                className="text-sm text-indigo-600 hover:text-indigo-700 font-medium disabled:opacity-50"
              >
                {openingPortal ? 'Opening Stripe…' : 'Manage subscription →'}
              </button>
            </div>
          )}
        </div>
      )}

      {!status?.stripe_configured && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-900">
          <strong>Stripe not configured yet.</strong> Set <code>STRIPE_SECRET_KEY</code>, <code>STRIPE_WEBHOOK_SECRET</code>, and <code>STRIPE_PRICE_STARTER/GROWTH/PRO</code> in the API environment to enable paid plans.
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
        All plans billed monthly through Stripe — flat rate, per conversation, never per visitor. 14-day free trial. Cancel anytime.
      </p>
    </div>
  );
}
