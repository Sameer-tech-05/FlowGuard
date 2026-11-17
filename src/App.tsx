import React, { useEffect, useState } from 'react';
import {
  BarChart3,
  Bot,
  CreditCard,
  FileSpreadsheet,
  LayoutDashboard,
  LogOut,
  Menu,
  Receipt,
  Settings,
  ShieldCheck,
  TrendingUp,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { apiFetch, setAuthToken } from './lib/api';
import { ToastProvider, useToast } from './components/Toast';
import { AuthOnboarding } from './components/AuthOnboarding';
import { DashboardView } from './components/DashboardView';
import { InvoicesView } from './components/InvoicesView';
import { RecoveryView } from './components/RecoveryView';
import { ForecastView } from './components/ForecastView';
import { CustomersView } from './components/CustomersView';
import { ExpensesView } from './components/ExpensesView';
import { CopilotView } from './components/CopilotView';
import { ReportsView } from './components/ReportsView';
import { BillingView } from './components/BillingView';
import { AdminConsoleView, SettingsView } from './components/SettingsAdminView';
import type {
  Business,
  BusinessSubscription,
  SubscriptionPlan,
  SupportedLanguage,
  User,
} from './lib/types';
import { HEADER_LANGUAGE_OPTIONS, STRINGS } from './lib/i18n';

interface MeResponse {
  authenticated?: boolean;
  user: User | null;
  business: Business | null;
  subscription: { subscription: BusinessSubscription; plan: SubscriptionPlan } | null;
  integrations: {
    geminiConfigured: boolean;
    razorpayConfigured: boolean;
    emailConfigured: boolean;
    whatsappConfigured: boolean;
  };
}

function FlowGuardAppShell() {
  const { notify } = useToast();
  const [booting, setBooting] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [business, setBusiness] = useState<Business | null>(null);
  const [planName, setPlanName] = useState<string>('Starter');
  const [integrations, setIntegrations] = useState<MeResponse['integrations']>({
    geminiConfigured: false,
    razorpayConfigured: false,
    emailConfigured: false,
    whatsappConfigured: false,
  });

  const [activeTab, setActiveTab] = useState<string>('dashboard');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [language, setLanguage] = useState<SupportedLanguage>(() => {
    try {
      const saved = window.localStorage.getItem('fg_lang');
      return saved === 'kn' || saved === 'hi' ? saved : 'en';
    } catch {
      return 'en';
    }
  });

  function updateLanguage(next: SupportedLanguage) {
    setLanguage(next);
    try {
      window.localStorage.setItem('fg_lang', next);
    } catch {
      // ignore storage errors
    }
  }

  async function fetchSession() {
    try {
      const me = await apiFetch<MeResponse>('/api/auth/me');
      if (!me.authenticated || !me.user) {
        setAuthToken(null);
        const params = new URLSearchParams(window.location.search);
        if (params.get('autostart') === '1') {
          await launchDemo();
          return;
        }
        setUser(null);
        setBusiness(null);
        setIntegrations(me.integrations);
        return;
      }
      setUser(me.user);
      setBusiness(me.business);
      setPlanName(me.subscription?.plan.name ?? 'Starter');
      setIntegrations(me.integrations);
      if (me.user.role === 'admin' && !me.business) {
        setActiveTab('admin');
      }
    } catch {
      setAuthToken(null);
      const params = new URLSearchParams(window.location.search);
      if (params.get('autostart') === '1') {
        await launchDemo();
        return;
      }
      setUser(null);
      setBusiness(null);
    } finally {
      setBooting(false);
    }
  }

  async function launchDemo() {
    setBooting(true);
    try {
      const demoRes = await apiFetch<{ token?: string }>('/api/auth/demo', { method: 'POST' });
      if (demoRes.token) {
        setAuthToken(demoRes.token);
      }
      const me = await apiFetch<MeResponse>('/api/auth/me');
      setUser(me.user);
      setBusiness(me.business);
      setPlanName(me.subscription?.plan.name ?? 'Business');
      setIntegrations(me.integrations);
      setActiveTab('dashboard');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Unable to start demo workspace', 'error');
    } finally {
      setBooting(false);
    }
  }

  useEffect(() => {
    fetchSession();
  }, []);

  async function handleLogout() {
    await apiFetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    setAuthToken(null);
    setUser(null);
    setBusiness(null);
    setActiveTab('dashboard');
    notify('Signed out securely.', 'info');
  }

  if (booting) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center space-y-2">
          <div className="w-10 h-10 rounded-lg bg-slate-900 text-emerald-400 font-bold flex items-center justify-center mx-auto">
            FG
          </div>
          <div className="text-sm font-medium text-slate-600">Loading FlowGuard AI workspace...</div>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <AuthOnboarding
        mode="auth"
        initialUser={null}
        onAuthenticated={async (u, b) => {
          setUser(u);
          setBusiness(b);
          if (u.role === 'admin' && !b) {
            setActiveTab('admin');
          } else if (b) {
            setActiveTab('dashboard');
          }
          await fetchSession();
        }}
        onDemoLaunch={launchDemo}
      />
    );
  }

  if (!business && user.role !== 'admin') {
    return (
      <AuthOnboarding
        mode="onboarding"
        initialUser={user}
        onAuthenticated={async (u, b) => {
          setUser(u);
          setBusiness(b);
          if (b) {
            setActiveTab('dashboard');
          }
          await fetchSession();
        }}
        onDemoLaunch={launchDemo}
      />
    );
  }

  const t = STRINGS[language];

  const navItems =
    user.role === 'admin' && !business
      ? [{ id: 'admin', label: t.nav.admin, icon: ShieldCheck }]
      : [
          { id: 'dashboard', label: t.nav.dashboard, icon: LayoutDashboard },
          { id: 'invoices', label: t.nav.invoices, icon: Receipt },
          { id: 'recovery', label: t.nav.recovery, icon: Wallet },
          { id: 'forecast', label: t.nav.forecast, icon: TrendingUp },
          { id: 'customers', label: t.nav.customers, icon: Users },
          { id: 'expenses', label: t.nav.expenses, icon: FileSpreadsheet },
          { id: 'copilot', label: t.nav.copilot, icon: Bot },
          { id: 'reports', label: t.nav.reports, icon: BarChart3 },
          { id: 'billing', label: t.nav.billing, icon: CreditCard },
          { id: 'settings', label: t.nav.settings, icon: Settings },
        ];

  const currentNav = navItems.find((n) => n.id === activeTab) ?? navItems[0];

  const SidebarContent = () => (
    <div className="flex flex-col h-full bg-[#0B1528] text-slate-200">
      <div className="px-5 py-5 border-b border-slate-800/80 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-emerald-500 text-slate-950 font-bold flex items-center justify-center text-sm">
            FG
          </div>
          <span className="font-display font-bold text-white text-base tracking-tight whitespace-nowrap">
            FlowGuard AI
          </span>
        </div>
        <button
          type="button"
          aria-label="Close navigation menu"
          onClick={() => setMobileNavOpen(false)}
          className="lg:hidden text-slate-400 hover:text-white p-1"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {business && (
        <div className="px-5 py-3.5 border-b border-slate-800/80">
          <div className="text-xs font-semibold text-white truncate">{business.name}</div>
          <div className="text-xs text-slate-400 mt-0.5 truncate">
            {business.isDemo ? `${t.header.simulatedDemo} · ` : ''}
            {planName} {t.header.planSuffix}
          </div>
        </div>
      )}

      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto" aria-label="Primary Sidebar">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                setActiveTab(item.id);
                setMobileNavOpen(false);
              }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                isActive
                  ? 'bg-emerald-500/15 text-emerald-300 font-semibold'
                  : 'text-slate-300 hover:bg-slate-800/70 hover:text-white'
              }`}
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="p-4 border-t border-slate-800/80 space-y-3">
        <div className="text-xs text-slate-400 truncate">
          {t.header.signedInAs} <span className="text-slate-200 font-medium">{user.fullName}</span>
        </div>
        <button
          type="button"
          onClick={handleLogout}
          className="w-full flex items-center justify-center gap-2 rounded-lg border border-slate-700 hover:bg-slate-800 text-slate-200 text-xs font-semibold py-2 transition-colors"
        >
          <LogOut className="w-3.5 h-3.5" />
          <span>{t.header.signOut}</span>
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Mobile Backdrop */}
      {mobileNavOpen && (
        <button
          type="button"
          aria-label="Close navigation overlay"
          onClick={() => setMobileNavOpen(false)}
          className="fixed inset-0 z-40 bg-slate-950/60 lg:hidden"
        />
      )}

      {/* Single Responsive Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-64 shrink-0 transform transition-transform duration-200 lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 ${
          mobileNavOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <SidebarContent />
      </aside>

      {/* Main Content Viewport */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="bg-white border-b border-slate-200 px-4 sm:px-8 py-3.5 flex items-center justify-between gap-4 sticky top-0 z-30">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              aria-label="Open navigation menu"
              onClick={() => setMobileNavOpen(true)}
              className="lg:hidden p-2 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="text-sm font-medium text-slate-500 truncate">
              <span>{business ? business.name : 'FlowGuard Platform'}</span>
              <span className="mx-2 text-slate-300">/</span>
              <span className="font-semibold text-slate-900">{currentNav.label}</span>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <select
              id="header-language-select"
              aria-label="Application Language"
              value={language}
              onChange={(e) => updateLanguage(e.target.value as SupportedLanguage)}
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:border-emerald-600 cursor-pointer"
            >
              {HEADER_LANGUAGE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            {business && activeTab !== 'invoices' && (
              <button
                type="button"
                onClick={() => setActiveTab('invoices')}
                className="rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold px-3.5 py-2 transition-colors whitespace-nowrap"
              >
                {t.header.createInvoice}
              </button>
            )}
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto">
          {activeTab === 'admin' && user.role === 'admin' && <AdminConsoleView />}
          {business && activeTab === 'dashboard' && (
            <DashboardView onNavigate={(t) => setActiveTab(t)} />
          )}
          {business && activeTab === 'invoices' && <InvoicesView business={business} />}
          {business && activeTab === 'recovery' && <RecoveryView language={language} />}
          {business && activeTab === 'forecast' && <ForecastView language={language} />}
          {business && activeTab === 'customers' && <CustomersView />}
          {business && activeTab === 'expenses' && <ExpensesView />}
          {business && activeTab === 'copilot' && <CopilotView language={language} />}
          {business && activeTab === 'reports' && <ReportsView business={business} />}
          {business && activeTab === 'billing' && (
            <BillingView onPlanChanged={fetchSession} />
          )}
          {business && activeTab === 'settings' && (
            <SettingsView
              user={user}
              business={business}
              integrations={integrations}
              onBusinessUpdated={(b) => setBusiness(b)}
            />
          )}
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <FlowGuardAppShell />
    </ToastProvider>
  );
}
