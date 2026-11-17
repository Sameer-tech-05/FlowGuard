import React, { useEffect, useState } from 'react';
import { AlertCircle, ArrowRight, Building2, ShieldCheck, Lock, PlayCircle } from 'lucide-react';
import { apiFetch, setAuthToken } from '../lib/api';
import { useToast } from './Toast';
import type { Business, User } from '../lib/types';

interface AuthOnboardingProps {
  mode: 'auth' | 'onboarding';
  initialUser: User | null;
  onAuthenticated: (user: User, business: Business | null) => void;
  onDemoLaunch: () => void;
}

export function AuthOnboarding({
  mode,
  initialUser,
  onAuthenticated,
  onDemoLaunch,
}: AuthOnboardingProps) {
  const { notify } = useToast();
  const [authTab, setAuthTab] = useState<'login' | 'signup' | 'forgot'>('login');
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [legalModal, setLegalModal] = useState<'privacy' | 'terms' | null>(null);

  // Login / Signup fields
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [consentMessaging, setConsentMessaging] = useState(true);
  const [consentFinancialAi, setConsentFinancialAi] = useState(true);
  const [devCodeHint, setDevCodeHint] = useState<string | null>(null);

  // Forgot / Reset fields
  const [resetToken, setResetToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [resetStage, setResetStage] = useState<'request' | 'confirm'>('request');

  // Onboarding fields
  const [bizName, setBizName] = useState('');
  const [bizCategory, setBizCategory] = useState('Wholesale & Distribution');
  const [bizEmail, setBizEmail] = useState(initialUser?.email ?? '');
  const [bizPhone, setBizPhone] = useState('+91 ');
  const [bizLocation, setBizLocation] = useState('');
  const [bizCurrency, setBizCurrency] = useState('INR');
  const [bizGstin, setBizGstin] = useState('');
  const [openingCash, setOpeningCash] = useState('250000');
  const [monthlyExp, setMonthlyExp] = useState('120000');

  useEffect(() => {
    setFormError(null);
  }, [mode]);

  useEffect(() => {
    if (initialUser?.email) {
      setBizEmail((prev) => prev || initialUser.email);
    }
  }, [initialUser?.email]);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setLoading(true);
    try {
      const data = await apiFetch<{ token?: string; user: User; business: Business | null }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      if (data.token) {
        setAuthToken(data.token);
      }
      notify(`Welcome back, ${data.user.fullName}`, 'success');
      onAuthenticated(data.user, data.business);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Login failed';
      setFormError(msg);
      notify(msg, 'error');
    } finally {
      setLoading(false);
    }
  }

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!consentFinancialAi) {
      const msg = 'Please acknowledge financial data processing consent to create your workspace.';
      setFormError(msg);
      notify(msg, 'error');
      return;
    }
    setLoading(true);
    try {
      const data = await apiFetch<{
        token?: string;
        user: User;
        business: Business | null;
        devVerificationCode?: string;
      }>('/api/auth/signup', {
        method: 'POST',
        body: JSON.stringify({
          email,
          password,
          fullName,
          consentMessaging,
          consentFinancialAi,
        }),
      });
      if (data.token) {
        setAuthToken(data.token);
      }
      if (data.devVerificationCode) {
        setDevCodeHint(data.devVerificationCode);
      }
      notify('Account created! Complete your business profile below.', 'success');
      onAuthenticated(data.user, data.business);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Sign up failed';
      setFormError(msg);
      notify(msg, 'error');
    } finally {
      setLoading(false);
    }
  }

  async function handleForgot(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setLoading(true);
    try {
      if (resetStage === 'request') {
        const res = await apiFetch<{ message: string; devResetToken?: string }>(
          '/api/auth/forgot-password',
          {
            method: 'POST',
            body: JSON.stringify({ email }),
          }
        );
        if (res.devResetToken) {
          setResetToken(res.devResetToken);
          notify(`Reset token generated (local dev mode): ${res.devResetToken}`, 'info');
        } else {
          notify(res.message, 'success');
        }
        setResetStage('confirm');
      } else {
        await apiFetch('/api/auth/reset-password', {
          method: 'POST',
          body: JSON.stringify({ email, token: resetToken, newPassword }),
        });
        notify('Password updated. You can now sign in.', 'success');
        setAuthTab('login');
        setResetStage('request');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Password reset failed';
      setFormError(msg);
      notify(msg, 'error');
    } finally {
      setLoading(false);
    }
  }

  async function handleOnboarding(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setLoading(true);
    try {
      const data = await apiFetch<{ token?: string; business: Business }>('/api/business/onboarding', {
        method: 'POST',
        body: JSON.stringify({
          name: bizName,
          category: bizCategory,
          email: bizEmail,
          phone: bizPhone,
          location: bizLocation,
          currency: bizCurrency,
          gstin: bizGstin || null,
          openingCashBalance: Number(openingCash),
          typicalMonthlyExpenses: Number(monthlyExp),
        }),
      });
      if (data.token) {
        setAuthToken(data.token);
      }
      notify(`${data.business.name} workspace is ready.`, 'success');
      if (initialUser) {
        onAuthenticated(initialUser, data.business);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Onboarding failed';
      setFormError(msg);
      notify(msg, 'error');
    } finally {
      setLoading(false);
    }
  }

  async function quickAdminLogin() {
    setFormError(null);
    setLoading(true);
    try {
      const data = await apiFetch<{ token?: string; user: User; business: Business | null }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: 'admin@flowguard.in', password: 'Admin@1234' }),
      });
      if (data.token) {
        setAuthToken(data.token);
      }
      notify('Signed in to FlowGuard Platform Admin Console.', 'success');
      onAuthenticated(data.user, data.business);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Admin sign-in failed';
      setFormError(msg);
      notify(msg, 'error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col lg:flex-row">
      {/* Left Brand & Value Column */}
      <div className="lg:w-5/12 bg-slate-900 text-white p-8 lg:p-12 flex flex-col justify-between">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-emerald-500 flex items-center justify-center text-slate-950 font-bold text-lg">
              FG
            </div>
            <span className="font-display text-xl font-bold tracking-tight">FlowGuard AI</span>
          </div>

          <div className="mt-12 max-w-md">
            <h1 className="font-display text-3xl lg:text-4xl font-bold tracking-tight leading-tight text-balance">
              Collect invoices faster. See cash shortages before they hit.
            </h1>
            <p className="mt-4 text-slate-300 text-base leading-relaxed">
              Built for Indian wholesalers, MSMEs, agencies, and founders. Turn unpaid GST invoices,
              recurring supplier payouts, and customer payment patterns into real-time working capital control.
            </p>

            <div className="mt-8 space-y-4 border-t border-slate-800 pt-8 text-sm text-slate-300">
              <div>
                <div className="font-semibold text-white">01. Smart GST Invoicing & Partial Payments</div>
                <div className="text-slate-400 mt-0.5">Paise-accurate decimal ledgers, PDF tax invoices, and Razorpay test payment links.</div>
              </div>
              <div>
                <div className="font-semibold text-white">02. AI Payment Recovery (English, Hindi & Kannada)</div>
                <div className="text-slate-400 mt-0.5">Tone-calibrated follow-ups based on customer payment delay history.</div>
              </div>
              <div>
                <div className="font-semibold text-white">03. Deterministic 7/30/90-Day Cash Forecasting</div>
                <div className="text-slate-400 mt-0.5">Pinpoints exact supplier payment crunches with AI CFO explanations.</div>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-10 pt-6 border-t border-slate-800 flex flex-wrap items-center justify-between gap-4 text-xs text-slate-400">
          <div className="flex items-center gap-2">
            <Lock className="w-3.5 h-3.5 text-emerald-400" />
            <span>Workspace-isolated financial ledgers</span>
          </div>
          <div className="flex items-center gap-4">
            <button type="button" onClick={() => setLegalModal('privacy')} className="hover:text-white underline">
              Privacy Policy
            </button>
            <button type="button" onClick={() => setLegalModal('terms')} className="hover:text-white underline">
              Terms
            </button>
          </div>
        </div>
      </div>

      {/* Right Interactive Auth or Business Onboarding Form */}
      <div className="flex-1 flex items-center justify-center p-6 lg:p-12">
        <div className="w-full max-w-lg">
          {mode === 'onboarding' ? (
            <div className="bg-white border border-slate-200 rounded-xl p-8">
              <div className="flex items-center gap-2.5 text-emerald-700 text-sm font-semibold">
                <Building2 className="w-4 h-4" />
                <span>Step 2 of 2 · Business Workspace Setup</span>
              </div>
              <h2 className="mt-2 font-display text-2xl font-bold text-slate-900">
                Create your business profile
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                Your opening cash balance and monthly expenses initialize your baseline 30-day cash flow forecast.
              </p>
              {devCodeHint && (
                <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  Local verification code (since SMTP is unconfigured): <strong className="font-mono">{devCodeHint}</strong> (you can verify in Settings).
                </div>
              )}
              {formError && (
                <div role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
                  <span>{formError}</span>
                </div>
              )}

              <form onSubmit={handleOnboarding} className="mt-6 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="sm:col-span-2">
                    <label htmlFor="biz-name" className="block text-xs font-semibold text-slate-700 mb-1">
                      Business Name
                    </label>
                    <input
                      id="biz-name"
                      required
                      value={bizName}
                      onChange={(e) => setBizName(e.target.value)}
                      placeholder="e.g. Patel Packaging Solutions"
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
                    />
                  </div>
                  <div>
                    <label htmlFor="biz-cat" className="block text-xs font-semibold text-slate-700 mb-1">
                      Business Category
                    </label>
                    <select
                      id="biz-cat"
                      value={bizCategory}
                      onChange={(e) => setBizCategory(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-900"
                    >
                      <option>Wholesale & Distribution</option>
                      <option>Manufacturing & MSME</option>
                      <option>Creative / IT Agency</option>
                      <option>Freelancer / Consulting</option>
                      <option>Retail & FMCG</option>
                      <option>Logistics & Transport</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="biz-curr" className="block text-xs font-semibold text-slate-700 mb-1">
                      Preferred Currency
                    </label>
                    <select
                      id="biz-curr"
                      value={bizCurrency}
                      onChange={(e) => setBizCurrency(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-900"
                    >
                      <option value="INR">INR (₹ Indian Rupee)</option>
                      <option value="USD">USD ($ US Dollar)</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="biz-email" className="block text-xs font-semibold text-slate-700 mb-1">
                      Business Email
                    </label>
                    <input
                      id="biz-email"
                      type="email"
                      required
                      value={bizEmail}
                      onChange={(e) => setBizEmail(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
                    />
                  </div>
                  <div>
                    <label htmlFor="biz-phone" className="block text-xs font-semibold text-slate-700 mb-1">
                      Business Phone
                    </label>
                    <input
                      id="biz-phone"
                      required
                      value={bizPhone}
                      onChange={(e) => setBizPhone(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
                    />
                  </div>
                  <div>
                    <label htmlFor="biz-loc" className="block text-xs font-semibold text-slate-700 mb-1">
                      City / Location
                    </label>
                    <input
                      id="biz-loc"
                      required
                      value={bizLocation}
                      onChange={(e) => setBizLocation(e.target.value)}
                      placeholder="e.g. Surat, Gujarat"
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
                    />
                  </div>
                  <div>
                    <label htmlFor="biz-gstin" className="block text-xs font-semibold text-slate-700 mb-1">
                      GSTIN (Optional)
                    </label>
                    <input
                      id="biz-gstin"
                      value={bizGstin}
                      onChange={(e) => setBizGstin(e.target.value)}
                      placeholder="24AABCP1234F1Z5"
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono uppercase focus:outline-none focus:ring-2 focus:ring-slate-900"
                    />
                  </div>
                  <div>
                    <label htmlFor="biz-cash" className="block text-xs font-semibold text-slate-700 mb-1">
                      Opening Cash Balance (₹)
                    </label>
                    <input
                      id="biz-cash"
                      type="number"
                      required
                      value={openingCash}
                      onChange={(e) => setOpeningCash(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-slate-900"
                    />
                  </div>
                  <div>
                    <label htmlFor="biz-exp" className="block text-xs font-semibold text-slate-700 mb-1">
                      Typical Monthly Expenses (₹)
                    </label>
                    <input
                      id="biz-exp"
                      type="number"
                      min="0"
                      required
                      value={monthlyExp}
                      onChange={(e) => setMonthlyExp(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-slate-900"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full flex items-center justify-center gap-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white font-semibold py-2.5 px-4 text-sm transition-colors disabled:opacity-60"
                >
                  <span>{loading ? 'Creating Workspace...' : 'Create Secure Workspace'}</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </form>
            </div>
          ) : (
            <div className="space-y-5">
              {/* Investor Demo Quick Launch */}
              <div className="bg-emerald-950 text-white rounded-xl p-5 border border-emerald-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <div className="text-xs font-semibold text-emerald-300">
                    Interactive Investor Demo · Simulated Ledger
                  </div>
                  <div className="font-display font-bold text-base mt-0.5">
                    Sharma Wholesale Traders
                  </div>
                  <div className="text-xs text-emerald-200 mt-0.5">
                    25 customers, 60 invoices, overdue collections & 30-day shortage alert
                  </div>
                </div>
                <button
                  type="button"
                  onClick={onDemoLaunch}
                  className="shrink-0 inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-sm px-4 py-2.5 transition-colors whitespace-nowrap"
                >
                  <PlayCircle className="w-4 h-4" />
                  <span>Launch Investor Demo</span>
                </button>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl p-7">
                <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg mb-6">
                  <button
                    type="button"
                    onClick={() => {
                      setAuthTab('login');
                      setFormError(null);
                    }}
                    className={`flex-1 py-2 text-xs font-semibold rounded-md transition-colors ${
                      authTab === 'login' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Sign In
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAuthTab('signup');
                      setFormError(null);
                    }}
                    className={`flex-1 py-2 text-xs font-semibold rounded-md transition-colors ${
                      authTab === 'signup' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Create Account
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAuthTab('forgot');
                      setFormError(null);
                    }}
                    className={`flex-1 py-2 text-xs font-semibold rounded-md transition-colors ${
                      authTab === 'forgot' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Reset Password
                  </button>
                </div>

                {formError && (
                  <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-800 flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
                    <span>{formError}</span>
                  </div>
                )}

                {authTab === 'login' && (
                  <form onSubmit={handleLogin} className="space-y-4">
                    <div>
                      <label htmlFor="login-email" className="block text-xs font-semibold text-slate-700 mb-1">
                        Email Address
                      </label>
                      <input
                        id="login-email"
                        type="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="founder@yourbusiness.in"
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
                      />
                    </div>
                    <div>
                      <label htmlFor="login-pass" className="block text-xs font-semibold text-slate-700 mb-1">
                        Password
                      </label>
                      <input
                        id="login-pass"
                        type="password"
                        required
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Enter your password"
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={loading}
                      className="w-full rounded-lg bg-slate-900 hover:bg-slate-800 text-white font-semibold py-2.5 px-4 text-sm transition-colors disabled:opacity-60"
                    >
                      {loading ? 'Signing in...' : 'Sign In to Workspace'}
                    </button>

                    <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2.5 text-xs text-slate-600 flex items-center justify-between gap-2">
                      <div>
                        Demo login: <span className="font-mono text-slate-800">demo@sharmatraders.in</span> / <span className="font-mono text-slate-800">Demo@1234</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setEmail('demo@sharmatraders.in');
                          setPassword('Demo@1234');
                          setFormError(null);
                        }}
                        className="font-semibold text-emerald-700 hover:text-emerald-800 underline shrink-0"
                      >
                        Fill credentials
                      </button>
                    </div>

                    <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
                      <span>Platform Operations:</span>
                      <button
                        type="button"
                        onClick={quickAdminLogin}
                        disabled={loading}
                        className="inline-flex items-center gap-1.5 font-semibold text-slate-700 hover:text-slate-900 underline disabled:opacity-60"
                      >
                        <ShieldCheck className="w-3.5 h-3.5" />
                        <span>Sign in as Platform Admin</span>
                      </button>
                    </div>
                  </form>
                )}

                {authTab === 'signup' && (
                  <form onSubmit={handleSignup} className="space-y-4">
                    <div>
                      <label htmlFor="signup-name" className="block text-xs font-semibold text-slate-700 mb-1">
                        Full Name
                      </label>
                      <input
                        id="signup-name"
                        required
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        placeholder="Aarav Mehta"
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
                      />
                    </div>
                    <div>
                      <label htmlFor="signup-email" className="block text-xs font-semibold text-slate-700 mb-1">
                        Work Email
                      </label>
                      <input
                        id="signup-email"
                        type="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="aarav@mehtatraders.in"
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
                      />
                    </div>
                    <div>
                      <label htmlFor="signup-pass" className="block text-xs font-semibold text-slate-700 mb-1">
                        Password (min 8 characters)
                      </label>
                      <input
                        id="signup-pass"
                        type="password"
                        required
                        minLength={8}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
                      />
                    </div>

                    <div className="space-y-2 pt-1 text-xs text-slate-600">
                      <label className="flex items-start gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={consentFinancialAi}
                          onChange={(e) => setConsentFinancialAi(e.target.checked)}
                          className="mt-0.5 rounded border-slate-300"
                        />
                        <span>
                          I consent to FlowGuard AI processing my business ledger data for deterministic forecasting and AI copilot queries within my isolated workspace.
                        </span>
                      </label>
                      <label className="flex items-start gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={consentMessaging}
                          onChange={(e) => setConsentMessaging(e.target.checked)}
                          className="mt-0.5 rounded border-slate-300"
                        />
                        <span>
                          I confirm customer consent will be respected when dispatching email or WhatsApp payment reminders.
                        </span>
                      </label>
                    </div>

                    <button
                      type="submit"
                      disabled={loading}
                      className="w-full rounded-lg bg-slate-900 hover:bg-slate-800 text-white font-semibold py-2.5 px-4 text-sm transition-colors disabled:opacity-60"
                    >
                      {loading ? 'Creating Account...' : 'Continue to Business Profile'}
                    </button>
                  </form>
                )}

                {authTab === 'forgot' && (
                  <form onSubmit={handleForgot} className="space-y-4">
                    <div>
                      <label htmlFor="forgot-email" className="block text-xs font-semibold text-slate-700 mb-1">
                        Account Email
                      </label>
                      <input
                        id="forgot-email"
                        type="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
                      />
                    </div>
                    {resetStage === 'confirm' && (
                      <>
                        <div>
                          <label htmlFor="reset-tok" className="block text-xs font-semibold text-slate-700 mb-1">
                            Reset Token
                          </label>
                          <input
                            id="reset-tok"
                            required
                            value={resetToken}
                            onChange={(e) => setResetToken(e.target.value)}
                            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-slate-900"
                          />
                        </div>
                        <div>
                          <label htmlFor="reset-pass" className="block text-xs font-semibold text-slate-700 mb-1">
                            New Password
                          </label>
                          <input
                            id="reset-pass"
                            type="password"
                            required
                            minLength={8}
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
                          />
                        </div>
                      </>
                    )}
                    <button
                      type="submit"
                      disabled={loading}
                      className="w-full rounded-lg bg-slate-900 hover:bg-slate-800 text-white font-semibold py-2.5 px-4 text-sm transition-colors"
                    >
                      {resetStage === 'request' ? 'Request Reset Token' : 'Confirm Password Reset'}
                    </button>
                  </form>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Privacy & Terms Dialog */}
      {legalModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-lg w-full p-6 border border-slate-200 shadow-xl">
            <h3 className="font-display text-lg font-bold text-slate-900">
              {legalModal === 'privacy' ? 'FlowGuard AI Privacy Policy' : 'FlowGuard AI Terms of Service'}
            </h3>
            <div className="mt-3 text-sm text-slate-600 space-y-2 max-h-72 overflow-y-auto leading-relaxed">
              {legalModal === 'privacy' ? (
                <>
                  <p>
                    Each business workspace in FlowGuard AI is strictly isolated via authenticated membership checks and database-level tenant boundaries. No user or external business can query your invoices, customer records, or cash flow balances.
                  </p>
                  <p>
                    FlowGuard AI never stores credit card numbers, CVVs, banking passwords, or UPI PINs. Payment links operate via tokenized gateway checkouts.
                  </p>
                  <p>
                    You may export your full business ledger or delete your account data anytime from Workspace Settings.
                  </p>
                </>
              ) : (
                <>
                  <p>
                    FlowGuard AI provides deterministic cash flow forecasting, GST invoice generation formatting, and AI-assisted payment recovery drafts to support business decision-making.
                  </p>
                  <p>
                    AI-generated explanations never modify accounting records or initiate payments without explicit owner confirmation. Statutory GST filings remain the responsibility of the registered taxpayer.
                  </p>
                </>
              )}
            </div>
            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={() => setLegalModal(null)}
                className="rounded-lg bg-slate-900 text-white text-sm font-semibold px-4 py-2"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
