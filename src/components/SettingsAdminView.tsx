import React, { useEffect, useState } from 'react';
import { Download, ShieldCheck, UserPlus } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { formatINR } from '../lib/finance';
import { useToast } from './Toast';
import type { Business, SubscriptionPlan, User } from '../lib/types';

interface TeamMember {
  id: string;
  email: string;
  fullName: string;
  role: string;
  emailVerified: boolean;
  createdAt: string;
}

interface IntegrationHealth {
  geminiConfigured: boolean;
  razorpayConfigured: boolean;
  emailConfigured: boolean;
  whatsappConfigured: boolean;
}

export function SettingsView({
  user,
  business,
  integrations,
  onBusinessUpdated,
}: {
  user: User;
  business: Business;
  integrations: IntegrationHealth;
  onBusinessUpdated: (b: Business) => void;
}) {
  const { notify } = useToast();
  const [name, setName] = useState(business.name);
  const [phone, setPhone] = useState(business.phone);
  const [location, setLocation] = useState(business.location);
  const [gstin, setGstin] = useState(business.gstin || '');
  const [openingCash, setOpeningCash] = useState(String(business.openingCashBalance));
  const [monthlyExp, setMonthlyExp] = useState(String(business.typicalMonthlyExpenses));
  const [saving, setSaving] = useState(false);

  const [members, setMembers] = useState<TeamMember[]>([]);
  const [inviteName, setInviteName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'finance_manager' | 'viewer'>('finance_manager');

  const [verifyCode, setVerifyCode] = useState('');

  useEffect(() => {
    apiFetch<{ members: TeamMember[] }>('/api/business/team')
      .then((res) => setMembers(res.members))
      .catch(() => {});
  }, []);

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await apiFetch<{ business: Business }>('/api/business/profile', {
        method: 'PATCH',
        body: JSON.stringify({
          name,
          phone,
          location,
          gstin: gstin || null,
          openingCashBalance: Number(openingCash),
          typicalMonthlyExpenses: Number(monthlyExp),
        }),
      });
      onBusinessUpdated(res.business);
      notify('Business profile updated.', 'success');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Update failed', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function addTeamMember(e: React.FormEvent) {
    e.preventDefault();
    try {
      await apiFetch('/api/business/team', {
        method: 'POST',
        body: JSON.stringify({ fullName: inviteName, email: inviteEmail, role: inviteRole }),
      });
      notify(`Added ${inviteName} to workspace.`, 'success');
      setInviteName('');
      setInviteEmail('');
      const res = await apiFetch<{ members: TeamMember[] }>('/api/business/team');
      setMembers(res.members);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not add team member', 'error');
    }
  }

  async function exportAllData() {
    try {
      const data = await apiFetch<Record<string, unknown>>('/api/business/export');
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${business.name.toLowerCase().replace(/\s+/g, '_')}_export.json`;
      a.click();
      URL.revokeObjectURL(url);
      notify('Workspace JSON backup downloaded.', 'success');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Export failed', 'error');
    }
  }

  async function verifyEmail(e: React.FormEvent) {
    e.preventDefault();
    try {
      await apiFetch('/api/auth/verify-email', {
        method: 'POST',
        body: JSON.stringify({ code: verifyCode }),
      });
      notify('Email verified!', 'success');
      setVerifyCode('');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Verification failed', 'error');
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-xl font-bold text-slate-900">
          Workspace Settings, Team & Privacy
        </h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Manage your business profile, team accounts, integration readiness, and data exports.
        </p>
      </div>

      {!user.emailVerified && (
        <form
          onSubmit={verifyEmail}
          className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
        >
          <div className="text-xs text-amber-900">
            <strong>Email Verification Pending:</strong> Enter your 6-digit verification code to confirm{' '}
            {user.email}.
          </div>
          <div className="flex items-center gap-2">
            <input
              aria-label="Email verification code"
              value={verifyCode}
              onChange={(e) => setVerifyCode(e.target.value)}
              placeholder="6-digit code"
              className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-mono w-32"
            />
            <button
              type="submit"
              className="rounded-lg bg-slate-900 text-white text-xs font-semibold px-3 py-1.5"
            >
              Verify
            </button>
          </div>
        </form>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Business Profile */}
        <form onSubmit={saveProfile} className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <h3 className="font-display font-bold text-base text-slate-900">Business Profile</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label htmlFor="set-bname" className="block text-xs font-semibold text-slate-700 mb-1">
                Business Name
              </label>
              <input
                id="set-bname"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label htmlFor="set-phone" className="block text-xs font-semibold text-slate-700 mb-1">
                Phone
              </label>
              <input
                id="set-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label htmlFor="set-loc" className="block text-xs font-semibold text-slate-700 mb-1">
                Location
              </label>
              <input
                id="set-loc"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label htmlFor="set-gst" className="block text-xs font-semibold text-slate-700 mb-1">
                GSTIN
              </label>
              <input
                id="set-gst"
                value={gstin}
                onChange={(e) => setGstin(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono uppercase"
              />
            </div>
            <div>
              <label htmlFor="set-cash" className="block text-xs font-semibold text-slate-700 mb-1">
                Opening Cash Balance (₹)
              </label>
              <input
                id="set-cash"
                type="number"
                value={openingCash}
                onChange={(e) => setOpeningCash(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
              />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="set-exp" className="block text-xs font-semibold text-slate-700 mb-1">
                Typical Monthly Expenses (₹)
              </label>
              <input
                id="set-exp"
                type="number"
                value={monthlyExp}
                onChange={(e) => setMonthlyExp(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
              />
            </div>
          </div>
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold px-4 py-2.5"
          >
            {saving ? 'Saving...' : 'Save Profile Changes'}
          </button>
        </form>

        {/* Team Accounts & Data Portability */}
        <div className="space-y-6">
          <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <h3 className="font-display font-bold text-base text-slate-900">Team Members</h3>
            <div className="divide-y divide-slate-100 text-xs">
              {members.map((m) => (
                <div key={m.id} className="py-2 flex items-center justify-between">
                  <div>
                    <div className="font-semibold text-slate-900">{m.fullName}</div>
                    <div className="text-slate-500">{m.email}</div>
                  </div>
                  <span className="font-mono uppercase text-slate-600">{m.role}</span>
                </div>
              ))}
            </div>

            <form onSubmit={addTeamMember} className="pt-3 border-t border-slate-100 space-y-2">
              <div className="text-xs font-semibold text-slate-700">Add Team Member</div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <input
                  required
                  placeholder="Full Name"
                  value={inviteName}
                  onChange={(e) => setInviteName(e.target.value)}
                  className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs"
                />
                <input
                  type="email"
                  required
                  placeholder="Email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs"
                />
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as 'finance_manager' | 'viewer')}
                  className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs bg-white"
                >
                  <option value="finance_manager">Finance Manager</option>
                  <option value="viewer">Viewer</option>
                </select>
              </div>
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 text-white text-xs font-semibold px-3 py-1.5"
              >
                <UserPlus className="w-3.5 h-3.5" />
                <span>Add Member</span>
              </button>
            </form>
          </div>

          {/* Integration & Data Export */}
          <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <h3 className="font-display font-bold text-base text-slate-900">
              Integrations & Data Portability
            </h3>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
                <div className="text-slate-500">Gemini AI</div>
                <div className="font-semibold text-slate-900 mt-0.5">
                  {integrations.geminiConfigured ? 'Connected (Server)' : 'Key Required in Secrets'}
                </div>
              </div>
              <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
                <div className="text-slate-500">Razorpay Gateway</div>
                <div className="font-semibold text-slate-900 mt-0.5">
                  {integrations.razorpayConfigured ? 'Configured' : 'Test Mode Active'}
                </div>
              </div>
              <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
                <div className="text-slate-500">Email (Resend/SMTP)</div>
                <div className="font-semibold text-slate-900 mt-0.5">
                  {integrations.emailConfigured ? 'Live Connected' : 'Preview & Copy Mode'}
                </div>
              </div>
              <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
                <div className="text-slate-500">WhatsApp Cloud API</div>
                <div className="font-semibold text-slate-900 mt-0.5">
                  {integrations.whatsappConfigured ? 'Live Connected' : 'Preview & Share Mode'}
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={exportAllData}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 hover:bg-slate-50 text-slate-800 text-xs font-semibold px-4 py-2"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export Complete Business Backup (JSON)</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

interface AdminOverview {
  metrics: {
    totalBusinesses: number;
    totalUsers: number;
    activeSubscriptions: number;
    cancellations: number;
    mrrInr: number;
    totalInvoicesPlatform: number;
    totalAiCalls: number;
  };
  plans: SubscriptionPlan[];
  integrationHealth: IntegrationHealth;
  recentAuditLogs: Array<{
    id: string;
    action: string;
    resource_type: string;
    created_at: string;
  }>;
}

export function AdminConsoleView() {
  const { notify } = useToast();
  const [data, setData] = useState<AdminOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [edits, setEdits] = useState<Record<string, { price: string; limit: string }>>({});

  async function loadAdmin() {
    setLoading(true);
    try {
      const res = await apiFetch<AdminOverview>('/api/admin/overview');
      setData(res);
      const map: Record<string, { price: string; limit: string }> = {};
      for (const p of res.plans) {
        map[p.id] = { price: String(p.monthlyPriceInr), limit: String(p.invoiceLimitPerMonth) };
      }
      setEdits(map);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Admin access required', 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAdmin();
  }, []);

  async function updatePlan(planId: string) {
    const e = edits[planId];
    if (!e) return;
    try {
      await apiFetch(`/api/admin/plans/${planId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          monthlyPriceInr: Number(e.price),
          invoiceLimitPerMonth: Number(e.limit),
        }),
      });
      notify(`Updated ${planId} pricing configuration.`, 'success');
      await loadAdmin();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Plan update failed', 'error');
    }
  }

  if (loading || !data) {
    return <div className="p-8 text-sm text-slate-500">Loading platform admin console...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display text-xl font-bold text-slate-900 flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-emerald-700" />
            <span>FlowGuard Platform Admin Console</span>
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Aggregate SaaS metrics, plan price configuration, and audit trail. Private business financial records remain strictly isolated.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs font-semibold text-slate-500">Registered Businesses</div>
          <div className="mt-2 font-mono text-2xl font-bold text-slate-900">
            {data.metrics.totalBusinesses}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs font-semibold text-slate-500">Active Subscriptions</div>
          <div className="mt-2 font-mono text-2xl font-bold text-emerald-700">
            {data.metrics.activeSubscriptions}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs font-semibold text-slate-500">Monthly Recurring Revenue</div>
          <div className="mt-2 font-mono text-2xl font-bold text-slate-900">
            {formatINR(data.metrics.mrrInr)}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs font-semibold text-slate-500">Platform Usage (Invoices / AI)</div>
          <div className="mt-2 font-mono text-2xl font-bold text-slate-900">
            {data.metrics.totalInvoicesPlatform} / {data.metrics.totalAiCalls}
          </div>
        </div>
      </div>

      {/* Configurable SaaS Plans */}
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <h3 className="font-display font-bold text-base text-slate-900 mb-3">
          Configure Subscription Plan Pricing & Limits
        </h3>
        <div className="space-y-3">
          {data.plans.map((p) => (
            <div
              key={p.id}
              className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-lg bg-slate-50 border border-slate-200"
            >
              <div>
                <div className="font-semibold text-sm text-slate-900">{p.name}</div>
                <div className="text-xs text-slate-500">{p.tagline}</div>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <label className="flex items-center gap-1">
                  <span>Price (₹):</span>
                  <input
                    type="number"
                    value={edits[p.id]?.price ?? ''}
                    onChange={(e) =>
                      setEdits((prev) => ({
                        ...prev,
                        [p.id]: { ...prev[p.id], price: e.target.value },
                      }))
                    }
                    className="w-24 rounded border border-slate-300 bg-white px-2 py-1 font-mono"
                  />
                </label>
                <label className="flex items-center gap-1">
                  <span>Inv/mo:</span>
                  <input
                    type="number"
                    value={edits[p.id]?.limit ?? ''}
                    onChange={(e) =>
                      setEdits((prev) => ({
                        ...prev,
                        [p.id]: { ...prev[p.id], limit: e.target.value },
                      }))
                    }
                    className="w-24 rounded border border-slate-300 bg-white px-2 py-1 font-mono"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => updatePlan(p.id)}
                  className="rounded-lg bg-slate-900 text-white font-semibold px-3 py-1.5"
                >
                  Save
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Audit Logs */}
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <h3 className="font-display font-bold text-base text-slate-900 mb-3">
          Recent Platform Audit Events
        </h3>
        <div className="divide-y divide-slate-100 text-xs">
          {data.recentAuditLogs.map((a) => (
            <div key={a.id} className="py-2 flex items-center justify-between font-mono">
              <span className="font-semibold text-slate-800">{a.action}</span>
              <span className="text-slate-500">{a.resource_type}</span>
              <span className="text-slate-400">{a.created_at.slice(0, 19).replace('T', ' ')}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
