import React, { useEffect, useState } from 'react';
import {
  Building,
  Check,
  CheckCircle2,
  CreditCard,
  Lock,
  ShieldCheck,
  Smartphone,
  Wallet,
  X,
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import { formatINR } from '../lib/finance';
import { useToast } from './Toast';
import type { BusinessSubscription, SubscriptionPlan } from '../lib/types';

interface BillingHistoryRow {
  id: string;
  plan_id: string;
  amount_inr: number;
  status: string;
  mode: string;
  razorpay_payment_id: string | null;
  created_at: string;
}

interface RazorpayOrderResponse {
  orderId: string;
  amountPaise: number;
  amountInr: number;
  currency: string;
  mode: 'test' | 'live';
  keyId: string;
  plan: SubscriptionPlan;
  prefill: {
    name: string;
    email: string;
    contact: string;
  };
}

type PayMethod = 'upi' | 'card' | 'netbanking' | 'wallet';

export function BillingView({
  onPlanChanged,
}: {
  onPlanChanged: () => void;
}) {
  const { notify } = useToast();
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [currentSub, setCurrentSub] = useState<BusinessSubscription | null>(null);
  const [currentPlan, setCurrentPlan] = useState<SubscriptionPlan | null>(null);
  const [history, setHistory] = useState<BillingHistoryRow[]>([]);
  const [businessInfo, setBusinessInfo] = useState<{ name: string; email: string; phone: string }>({
    name: 'FlowGuard Workspace',
    email: '',
    phone: '',
  });
  const [razorpayConfigured, setRazorpayConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [openingOrderFor, setOpeningOrderFor] = useState<string | null>(null);

  // Razorpay Payment Window state
  const [checkoutOrder, setCheckoutOrder] = useState<RazorpayOrderResponse | null>(null);
  const [payMethod, setPayMethod] = useState<PayMethod>('upi');
  const [upiId, setUpiId] = useState('success@razorpay');
  const [cardNumber, setCardNumber] = useState('4111 1111 1111 1111');
  const [cardExpiry, setCardExpiry] = useState('12/29');
  const [cardCvv, setCardCvv] = useState('123');
  const [cardHolder, setCardHolder] = useState('');
  const [selectedBank, setSelectedBank] = useState('HDFC Bank');
  const [selectedWallet, setSelectedWallet] = useState('Paytm');
  const [paying, setPaying] = useState(false);
  const [paymentReceipt, setPaymentReceipt] = useState<{
    paymentId: string;
    planName: string;
    amountInr: number;
    methodLabel: string;
  } | null>(null);

  async function loadBilling() {
    setLoading(true);
    try {
      const [plansRes, subRes] = await Promise.all([
        apiFetch<{ plans: SubscriptionPlan[] }>('/api/billing/plans'),
        apiFetch<{
          subscription: BusinessSubscription;
          plan: SubscriptionPlan;
          history: BillingHistoryRow[];
          businessName?: string;
          businessEmail?: string;
          businessPhone?: string;
          razorpayConfigured?: boolean;
        }>('/api/billing/subscription'),
      ]);
      setPlans(plansRes.plans);
      setCurrentSub(subRes.subscription);
      setCurrentPlan(subRes.plan);
      setHistory(subRes.history);
      setBusinessInfo({
        name: subRes.businessName || 'FlowGuard Workspace',
        email: subRes.businessEmail || '',
        phone: subRes.businessPhone || '',
      });
      setCardHolder(subRes.businessName || 'Authorized Signatory');
      setRazorpayConfigured(Boolean(subRes.razorpayConfigured));
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to load billing', 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadBilling();
  }, []);

  async function openRazorpayWindow(plan: SubscriptionPlan) {
    setOpeningOrderFor(plan.id);
    setPaymentReceipt(null);
    try {
      const order = await apiFetch<RazorpayOrderResponse>('/api/billing/create-order', {
        method: 'POST',
        body: JSON.stringify({ planId: plan.id }),
      });
      setCheckoutOrder(order);
      setPayMethod('upi');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Unable to open Razorpay payment window', 'error');
    } finally {
      setOpeningOrderFor(null);
    }
  }

  async function confirmRazorpayPayment(e: React.FormEvent) {
    e.preventDefault();
    if (!checkoutOrder) return;

    const targetPlan = checkoutOrder.plan;
    let methodLabel = 'Free Tier Switch';
    let detailMasked = 'free';

    if (targetPlan.monthlyPriceInr > 0) {
      if (payMethod === 'upi') {
        if (!upiId.includes('@')) {
          notify('Please enter a valid UPI ID (e.g. success@razorpay).', 'error');
          return;
        }
        methodLabel = `UPI (${upiId})`;
        detailMasked = upiId;
      } else if (payMethod === 'card') {
        const digits = cardNumber.replace(/\s+/g, '');
        if (digits.length < 12) {
          notify('Please enter a valid 16-digit test card number.', 'error');
          return;
        }
        methodLabel = `Card •••• ${digits.slice(-4)}`;
        detailMasked = `card_${digits.slice(-4)}`;
      } else if (payMethod === 'netbanking') {
        methodLabel = `Netbanking (${selectedBank})`;
        detailMasked = selectedBank;
      } else {
        methodLabel = `Wallet (${selectedWallet})`;
        detailMasked = selectedWallet;
      }
    }

    setPaying(true);
    try {
      const res = await apiFetch<{ paymentId: string; mode: string }>('/api/billing/checkout', {
        method: 'POST',
        body: JSON.stringify({
          planId: targetPlan.id,
          orderId: checkoutOrder.orderId,
          paymentMethod: targetPlan.monthlyPriceInr === 0 ? 'free_tier' : payMethod,
          paymentDetail: detailMasked,
        }),
      });

      setPaymentReceipt({
        paymentId: res.paymentId,
        planName: targetPlan.name,
        amountInr: targetPlan.monthlyPriceInr,
        methodLabel,
      });

      notify(
        targetPlan.monthlyPriceInr === 0
          ? `Switched workspace to Free plan.`
          : `Razorpay payment completed for ${targetPlan.name} plan (Ref: ${res.paymentId}).`,
        'success'
      );
      await loadBilling();
      onPlanChanged();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Payment failed', 'error');
    } finally {
      setPaying(false);
    }
  }

  async function handleCancel() {
    try {
      await apiFetch('/api/billing/cancel', { method: 'POST' });
      notify('Subscription marked as cancelled at end of period.', 'info');
      await loadBilling();
      onPlanChanged();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Cancellation failed', 'error');
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-bold text-slate-900">
            Subscription Plans & Billing
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            {razorpayConfigured
              ? 'Razorpay Live Merchant Checkout connected. Switch or upgrade your plan anytime.'
              : 'Razorpay Test Mode Sandbox active. Switch plans anytime through the Razorpay Payment Window.'}
          </p>
        </div>
      </div>

      {/* Current Subscription Summary */}
      {currentSub && currentPlan && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="text-xs font-semibold text-slate-500">
              Active Subscription · RAZORPAY {currentSub.mode.toUpperCase()} MODE · Status: {currentSub.status.toUpperCase()}
            </div>
            <div className="font-display text-lg font-bold text-slate-900 mt-1">
              {currentPlan.name} Plan — {formatINR(currentPlan.monthlyPriceInr)}/month
            </div>
            <div className="text-xs text-slate-600 mt-0.5 font-mono">
              Limit: {currentPlan.invoiceLimitPerMonth} invoices/month · {currentPlan.teamSeats} team seat(s) · Period ends{' '}
              {currentSub.currentPeriodEnd.slice(0, 10)}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {plans
              .filter((p) => p.id !== currentPlan.id)
              .slice(0, 1)
              .map((alt) => (
                <button
                  key={alt.id}
                  type="button"
                  onClick={() => openRazorpayWindow(alt)}
                  className="rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold px-3.5 py-2 whitespace-nowrap"
                >
                  Change Plan
                </button>
              ))}
            {currentSub.status === 'active' && currentPlan.monthlyPriceInr > 0 && (
              <button
                type="button"
                onClick={handleCancel}
                className="rounded-lg border border-red-200 hover:bg-red-50 text-red-700 text-xs font-semibold px-3.5 py-2 whitespace-nowrap"
              >
                Cancel Subscription
              </button>
            )}
          </div>
        </div>
      )}

      {/* 3 SaaS Tiers: Free ₹0, Growth ₹499, Business ₹4,999 */}
      {loading ? (
        <div className="p-8 text-center text-sm text-slate-500">Loading plans...</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {plans.map((plan) => {
            const isCurrent = currentPlan?.id === plan.id && currentSub?.status !== 'cancelled';
            const isUpgrade =
              currentPlan && plan.monthlyPriceInr > currentPlan.monthlyPriceInr;
            return (
              <div
                key={plan.id}
                className={`bg-white rounded-xl p-6 flex flex-col justify-between border ${
                  plan.id === 'growth' ? 'border-slate-900' : 'border-slate-200'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between">
                    <h3 className="font-display text-lg font-bold text-slate-900">{plan.name}</h3>
                    {isCurrent && (
                      <span className="text-xs font-semibold text-emerald-700">Current Plan</span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 mt-1">{plan.tagline}</p>

                  <div className="mt-4 flex items-baseline gap-1">
                    <span className="font-mono text-3xl font-bold text-slate-900">
                      ₹{plan.monthlyPriceInr.toLocaleString('en-IN')}
                    </span>
                    <span className="text-xs text-slate-500">/month</span>
                  </div>

                  <div className="mt-4 pt-4 border-t border-slate-100 space-y-2 text-xs text-slate-700">
                    <div className="flex justify-between font-semibold text-slate-900">
                      <span>Monthly Invoices</span>
                      <span className="font-mono">{plan.invoiceLimitPerMonth}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Team Members</span>
                      <span className="font-mono">{plan.teamSeats}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>AI Copilot & Reminders</span>
                      <span>{plan.aiEnabled ? 'Included' : 'Not included'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>WhatsApp Business API</span>
                      <span>{plan.whatsappEnabled ? 'Included' : 'Not included'}</span>
                    </div>
                  </div>

                  <ul className="mt-4 space-y-2 text-xs text-slate-600">
                    {plan.features.map((f) => (
                      <li key={f} className="flex items-start gap-2">
                        <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <button
                  type="button"
                  disabled={isCurrent || openingOrderFor === plan.id}
                  onClick={() => openRazorpayWindow(plan)}
                  className={`mt-6 w-full inline-flex items-center justify-center gap-2 rounded-lg py-2.5 px-4 text-xs font-semibold transition-colors ${
                    isCurrent
                      ? 'bg-slate-100 text-slate-500 cursor-default'
                      : 'bg-slate-900 hover:bg-slate-800 text-white'
                  }`}
                >
                  <CreditCard className="w-3.5 h-3.5" />
                  <span>
                    {isCurrent
                      ? 'Active Plan'
                      : openingOrderFor === plan.id
                      ? 'Opening Razorpay Window...'
                      : plan.monthlyPriceInr === 0
                      ? 'Switch to Free (₹0/mo)'
                      : isUpgrade
                      ? `Upgrade to ${plan.name} · ₹${plan.monthlyPriceInr.toLocaleString('en-IN')}`
                      : `Switch to ${plan.name} · ₹${plan.monthlyPriceInr.toLocaleString('en-IN')}`}
                  </span>
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Billing History */}
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <h3 className="font-display font-bold text-base text-slate-900 mb-3">Billing History</h3>
        {history.length === 0 ? (
          <p className="text-sm text-slate-500 py-4">No billing transactions yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs font-semibold text-slate-500">
                  <th className="py-2 pr-3">Date</th>
                  <th className="py-2 px-3">Plan</th>
                  <th className="py-2 px-3">Mode</th>
                  <th className="py-2 px-3">Payment ID</th>
                  <th className="py-2 pl-3 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {history.map((h) => (
                  <tr key={h.id}>
                    <td className="py-2.5 pr-3 font-mono text-xs text-slate-600">
                      {h.created_at.slice(0, 10)}
                    </td>
                    <td className="py-2.5 px-3 text-xs font-semibold text-slate-900 uppercase">
                      {h.plan_id.replace('_', ' ')}
                    </td>
                    <td className="py-2.5 px-3 text-xs text-slate-600 uppercase">{h.mode}</td>
                    <td className="py-2.5 px-3 font-mono text-xs text-slate-600">
                      {h.razorpay_payment_id || '-'}
                    </td>
                    <td className="py-2.5 pl-3 text-right font-mono tabular-nums font-semibold text-slate-900">
                      {formatINR(h.amount_inr)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Interactive Razorpay Checkout Payment Window */}
      {checkoutOrder && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Razorpay Payment Window"
          className="fixed inset-0 z-50 bg-slate-950/70 flex items-center justify-center p-4"
        >
          <div className="bg-white rounded-xl max-w-md w-full overflow-hidden border border-slate-200 shadow-2xl">
            {/* Razorpay Branded Header */}
            <div className="bg-[#0B1528] text-white px-5 py-4 flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-emerald-500 text-slate-950 font-bold flex items-center justify-center text-sm shrink-0">
                  FG
                </div>
                <div>
                  <div className="font-display font-bold text-sm">FlowGuard AI · Razorpay Checkout</div>
                  <div className="text-xs text-slate-300 mt-0.5">
                    {checkoutOrder.plan.name} Plan ({checkoutOrder.mode === 'live' ? 'Live' : 'Test Mode'})
                  </div>
                  <div className="text-[11px] font-mono text-slate-400 mt-0.5">
                    Order: {checkoutOrder.orderId}
                  </div>
                </div>
              </div>
              <button
                type="button"
                aria-label="Close payment window"
                onClick={() => {
                  setCheckoutOrder(null);
                  setPaymentReceipt(null);
                }}
                className="text-slate-400 hover:text-white p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Amount Bar */}
            <div className="px-5 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <div>
                <div className="text-xs text-slate-500">Payable Monthly Amount</div>
                <div className="font-mono text-xl font-bold text-slate-900">
                  {formatINR(checkoutOrder.amountInr)}
                </div>
              </div>
              <div className="text-right text-xs text-slate-600">
                <div className="font-semibold text-slate-800">{businessInfo.name}</div>
                <div>{checkoutOrder.prefill.email || businessInfo.email}</div>
              </div>
            </div>

            {paymentReceipt ? (
              <div className="p-6 text-center space-y-4">
                <CheckCircle2 className="w-12 h-12 text-emerald-600 mx-auto" />
                <div>
                  <h4 className="font-display text-lg font-bold text-slate-900">
                    {paymentReceipt.amountInr === 0 ? 'Plan Switched Successfully' : 'Payment Successful'}
                  </h4>
                  <p className="text-xs text-slate-600 mt-1">
                    {paymentReceipt.planName} Plan is now active on your workspace.
                  </p>
                </div>
                <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs space-y-1.5 text-left font-mono">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Payment Ref:</span>
                    <span className="font-semibold text-slate-900">{paymentReceipt.paymentId}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Method:</span>
                    <span className="text-slate-800">{paymentReceipt.methodLabel}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Amount Charged:</span>
                    <span className="font-semibold text-emerald-700">
                      {formatINR(paymentReceipt.amountInr)}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setCheckoutOrder(null);
                    setPaymentReceipt(null);
                  }}
                  className="w-full rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold py-2.5"
                >
                  Done & Return to Billing
                </button>
              </div>
            ) : (
              <form onSubmit={confirmRazorpayPayment} className="p-5 space-y-4">
                {checkoutOrder.amountInr === 0 ? (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs text-slate-700 space-y-2">
                    <div className="font-semibold text-slate-900">
                      Switch to Free Plan (₹0/month)
                    </div>
                    <p className="leading-relaxed">
                      Your workspace will move to the Free tier (50 invoices/month, 1 user seat, AI & reminder templates in EN/HI/KN). No payment will be charged.
                    </p>
                  </div>
                ) : (
                  <>
                    {/* Payment Method Selector */}
                    <div>
                      <div className="text-xs font-semibold text-slate-700 mb-2">
                        Select Payment Method
                      </div>
                      <div className="grid grid-cols-4 gap-1.5">
                        {(
                          [
                            { id: 'upi', label: 'UPI / QR', icon: Smartphone },
                            { id: 'card', label: 'Card', icon: CreditCard },
                            { id: 'netbanking', label: 'Netbank', icon: Building },
                            { id: 'wallet', label: 'Wallet', icon: Wallet },
                          ] as const
                        ).map((m) => {
                          const Icon = m.icon;
                          const active = payMethod === m.id;
                          return (
                            <button
                              key={m.id}
                              type="button"
                              onClick={() => setPayMethod(m.id)}
                              className={`flex flex-col items-center gap-1 rounded-lg border py-2 px-1 text-[11px] font-semibold transition-colors ${
                                active
                                  ? 'border-slate-900 bg-slate-900 text-white'
                                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                              }`}
                            >
                              <Icon className="w-3.5 h-3.5" />
                              <span>{m.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Method-specific Inputs */}
                    {payMethod === 'upi' && (
                      <div className="space-y-2.5">
                        <label htmlFor="rzp-upi" className="block text-xs font-semibold text-slate-700">
                          UPI ID / VPA
                        </label>
                        <input
                          id="rzp-upi"
                          required
                          value={upiId}
                          onChange={(e) => setUpiId(e.target.value)}
                          placeholder="success@razorpay"
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-slate-900"
                        />
                        <div className="flex flex-wrap gap-1.5 text-[11px]">
                          {['success@razorpay', 'business@okhdfcbank', 'founder@okicici'].map((vpa) => (
                            <button
                              key={vpa}
                              type="button"
                              onClick={() => setUpiId(vpa)}
                              className="rounded border border-slate-200 bg-slate-50 hover:bg-slate-100 px-2 py-1 font-mono text-slate-700"
                            >
                              {vpa}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {payMethod === 'card' && (
                      <div className="space-y-3">
                        <div>
                          <label htmlFor="rzp-card" className="block text-xs font-semibold text-slate-700 mb-1">
                            Test Card Number (Sandbox Only)
                          </label>
                          <input
                            id="rzp-card"
                            required
                            value={cardNumber}
                            onChange={(e) => setCardNumber(e.target.value)}
                            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-slate-900"
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label htmlFor="rzp-exp" className="block text-xs font-semibold text-slate-700 mb-1">
                              Expiry (MM/YY)
                            </label>
                            <input
                              id="rzp-exp"
                              required
                              value={cardExpiry}
                              onChange={(e) => setCardExpiry(e.target.value)}
                              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-slate-900"
                            />
                          </div>
                          <div>
                            <label htmlFor="rzp-cvv" className="block text-xs font-semibold text-slate-700 mb-1">
                              CVV
                            </label>
                            <input
                              id="rzp-cvv"
                              type="password"
                              required
                              maxLength={4}
                              value={cardCvv}
                              onChange={(e) => setCardCvv(e.target.value)}
                              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-slate-900"
                            />
                          </div>
                        </div>
                        <div>
                          <label htmlFor="rzp-holder" className="block text-xs font-semibold text-slate-700 mb-1">
                            Cardholder Name
                          </label>
                          <input
                            id="rzp-holder"
                            required
                            value={cardHolder}
                            onChange={(e) => setCardHolder(e.target.value)}
                            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
                          />
                        </div>
                      </div>
                    )}

                    {payMethod === 'netbanking' && (
                      <div>
                        <label htmlFor="rzp-bank" className="block text-xs font-semibold text-slate-700 mb-1">
                          Select Corporate / Retail Bank
                        </label>
                        <select
                          id="rzp-bank"
                          value={selectedBank}
                          onChange={(e) => setSelectedBank(e.target.value)}
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
                        >
                          <option>HDFC Bank</option>
                          <option>ICICI Bank</option>
                          <option>State Bank of India</option>
                          <option>Axis Bank</option>
                          <option>Kotak Mahindra Bank</option>
                        </select>
                      </div>
                    )}

                    {payMethod === 'wallet' && (
                      <div>
                        <label htmlFor="rzp-wallet" className="block text-xs font-semibold text-slate-700 mb-1">
                          Select Wallet
                        </label>
                        <select
                          id="rzp-wallet"
                          value={selectedWallet}
                          onChange={(e) => setSelectedWallet(e.target.value)}
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
                        >
                          <option>Paytm</option>
                          <option>PhonePe Wallet</option>
                          <option>Amazon Pay</option>
                          <option>Mobikwik</option>
                        </select>
                      </div>
                    )}
                  </>
                )}

                <button
                  type="submit"
                  disabled={paying}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold py-2.5 px-4 transition-colors disabled:opacity-60"
                >
                  <ShieldCheck className="w-4 h-4" />
                  <span>
                    {paying
                      ? 'Processing Payment...'
                      : checkoutOrder.amountInr === 0
                      ? 'Confirm Switch to Free Plan'
                      : `Pay ${formatINR(checkoutOrder.amountInr)} via Razorpay (${checkoutOrder.mode === 'live' ? 'Live' : 'Test'})`}
                  </span>
                </button>

                <div className="flex items-center justify-center gap-1.5 text-[11px] text-slate-500">
                  <Lock className="w-3 h-3" />
                  <span>Secured by Razorpay · Card details are never stored on FlowGuard servers</span>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

