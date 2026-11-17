import React, { useEffect, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { AlertTriangle, ArrowUpRight, TrendingDown, TrendingUp } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { formatINR } from '../lib/finance';
import type { Business, CashFlowForecastResult, DashboardMetrics, Expense, Payment } from '../lib/types';

interface DashboardPayload {
  business: Business;
  metrics: DashboardMetrics;
  forecast30: CashFlowForecastResult;
  overdueTop: Array<{
    invoiceId: string;
    invoiceNumber: string;
    customerName: string;
    customerBusiness: string;
    balance: number;
    dueDate: string;
    overdueDays: number;
  }>;
  recentPayments: Payment[];
  recentExpenses: Expense[];
}

export function DashboardView({
  onNavigate,
}: {
  onNavigate: (tab: string) => void;
}) {
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    apiFetch<DashboardPayload>('/api/dashboard')
      .then((res) => {
        if (active) {
          setData(res);
          setError(null);
        }
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : 'Failed to load dashboard');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  if (loading) {
    return (
      <div className="space-y-6" aria-busy="true">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="bg-white border border-slate-200 rounded-xl p-5 h-28 animate-pulse">
              <div className="h-3 w-32 bg-slate-200 rounded" />
              <div className="h-7 w-44 bg-slate-200 rounded mt-4" />
            </div>
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white border border-slate-200 rounded-xl p-5 h-80 animate-pulse" />
          <div className="bg-white border border-slate-200 rounded-xl p-5 h-80 animate-pulse" />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="bg-white border border-red-200 rounded-xl p-6 text-sm text-red-700">
        {error || 'Dashboard data unavailable.'}
      </div>
    );
  }

  const { business, metrics, forecast30, overdueTop } = data;
  const shortage = forecast30.shortageAlerts[0];

  const kpis = [
    {
      label: 'Current Available Cash Balance',
      value: formatINR(metrics.availableCashBalance),
      sub: 'Opening balance + collections − paid expenses',
      tone: metrics.availableCashBalance >= 0 ? 'emerald' : 'red',
    },
    {
      label: 'Total Outstanding Receivables',
      value: formatINR(metrics.totalOutstandingReceivables),
      sub: 'Across all Sent, Partially Paid & Overdue invoices',
      tone: 'neutral',
    },
    {
      label: 'Total Overdue Payments',
      value: formatINR(metrics.totalOverduePayments),
      sub: `${metrics.overdueCount} invoice(s) past due date`,
      tone: metrics.totalOverduePayments > 0 ? 'red' : 'emerald',
    },
    {
      label: 'Expected Collections This Month',
      value: formatINR(metrics.expectedCollectionsThisMonth),
      sub: 'Open receivables due this month + overdue',
      tone: 'amber',
    },
    {
      label: 'Upcoming Expenses (30 Days)',
      value: formatINR(metrics.upcomingExpenses30d),
      sub: 'Scheduled supplier bills & recurring outflows',
      tone: 'amber',
    },
    {
      label: 'Projected Cash After 30 Days',
      value: formatINR(metrics.projectedCash30d),
      sub: `Deterministic forecast · Confidence: ${forecast30.confidence}`,
      tone: metrics.projectedCash30d >= 0 ? 'emerald' : 'red',
    },
  ];

  const formatAxisINR = (v: number) => {
    if (Math.abs(v) >= 100000) return `₹${(v / 100000).toFixed(1)}L`;
    if (Math.abs(v) >= 1000) return `₹${(v / 1000).toFixed(0)}k`;
    return `₹${v}`;
  };

  return (
    <div className="space-y-6">
      {business.isDemo && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="text-sm text-amber-950">
            <span className="font-semibold">Investor Demo Mode — Simulated Data:</span>{' '}
            <span>
              Viewing <strong>Sharma Wholesale Traders</strong> (25 customers, 60 invoices, 6 months of simulated ledger activity).
            </span>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('recovery')}
            className="shrink-0 inline-flex items-center gap-1.5 text-xs font-semibold text-amber-950 bg-white border border-amber-300 rounded-lg px-3 py-1.5 hover:bg-amber-100 transition-colors whitespace-nowrap"
          >
            <span>Inspect Overdue Queue</span>
            <ArrowUpRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Critical Working Capital Alert Banner when Shortage Detected */}
      {shortage && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
            <div>
              <div className="text-sm font-bold text-red-950">
                Cash Shortage Warning · {shortage.date}
              </div>
              <p className="text-sm text-red-800 mt-0.5">{shortage.reason}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => onNavigate('forecast')}
              className="rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-semibold px-3.5 py-2 transition-colors whitespace-nowrap"
            >
              View 30-Day Forecast
            </button>
            <button
              type="button"
              onClick={() => onNavigate('recovery')}
              className="rounded-lg bg-white border border-red-300 hover:bg-red-100 text-red-900 text-xs font-semibold px-3.5 py-2 transition-colors whitespace-nowrap"
            >
              Recover Overdue Cash
            </button>
          </div>
        </div>
      )}

      {/* 6 Financial KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4" data-testid="dashboard-kpis">
        {kpis.map((kpi) => (
          <div
            key={kpi.label}
            className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-600">{kpi.label}</span>
              {kpi.tone === 'emerald' && <TrendingUp className="w-4 h-4 text-emerald-600 shrink-0" />}
              {kpi.tone === 'red' && <TrendingDown className="w-4 h-4 text-red-600 shrink-0" />}
            </div>
            <div
              className={`mt-3 font-mono tabular-nums text-2xl font-bold tracking-tight ${
                kpi.tone === 'emerald'
                  ? 'text-emerald-700'
                  : kpi.tone === 'red'
                  ? 'text-red-700'
                  : kpi.tone === 'amber'
                  ? 'text-amber-700'
                  : 'text-slate-900'
              }`}
            >
              {kpi.value}
            </div>
            <div className="mt-1.5 text-xs text-slate-500">{kpi.sub}</div>
          </div>
        ))}
      </div>

      {/* Primary Charts Row: Cash Inflow vs Outflow + 30-Day Cash Forecast */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-display font-bold text-base text-slate-900">
                Cash Inflow vs Outflow (6 Months)
              </h3>
              <p className="text-xs text-slate-500">Actual collections received vs paid expenses</p>
            </div>
          </div>
          <div className="h-68">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={metrics.monthlyCashFlowSeries}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="month" tick={{ fontSize: 12, fill: '#64748b' }} />
                <YAxis tickFormatter={formatAxisINR} tick={{ fontSize: 12, fill: '#64748b' }} width={62} />
                <Tooltip formatter={(val) => formatINR(Number(val ?? 0))} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="inflow" name="Cash Inflow" fill="#10b981" radius={[4, 4, 0, 0]} />
                <Bar dataKey="outflow" name="Cash Outflow" fill="#ef4444" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-display font-bold text-base text-slate-900">
                30-Day Cash Flow Forecast
              </h3>
              <p className="text-xs text-slate-500">
                Projected daily closing cash balance ({forecast30.confidence} confidence)
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('forecast')}
              className="text-xs font-semibold text-slate-700 hover:text-slate-900 underline whitespace-nowrap"
            >
              7 / 30 / 90d Details
            </button>
          </div>
          <div className="h-68">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={forecast30.dailyPoints}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} minTickGap={18} />
                <YAxis tickFormatter={formatAxisINR} tick={{ fontSize: 12, fill: '#64748b' }} width={64} />
                <Tooltip formatter={(val) => formatINR(Number(val ?? 0))} />
                <ReferenceLine y={0} stroke="#dc2626" strokeDasharray="4 4" />
                <Area
                  type="monotone"
                  dataKey="projectedBalance"
                  name="Projected Balance"
                  stroke="#0f172a"
                  fill="#cbd5e1"
                  fillOpacity={0.45}
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Secondary Charts Row: Monthly Revenue Trend + Invoice Aging */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="mb-4">
            <h3 className="font-display font-bold text-base text-slate-900">
              Monthly Revenue Trend
            </h3>
            <p className="text-xs text-slate-500">Total billed GST invoice volume by month</p>
          </div>
          <div className="h-60">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={metrics.monthlyCashFlowSeries}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="month" tick={{ fontSize: 12, fill: '#64748b' }} />
                <YAxis tickFormatter={formatAxisINR} tick={{ fontSize: 12, fill: '#64748b' }} width={62} />
                <Tooltip formatter={(val) => formatINR(Number(val ?? 0))} />
                <Area
                  type="monotone"
                  dataKey="revenue"
                  name="Invoiced Revenue"
                  stroke="#059669"
                  fill="#a7f3d0"
                  fillOpacity={0.5}
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="mb-4">
            <h3 className="font-display font-bold text-base text-slate-900">
              Outstanding Invoices by Aging Category
            </h3>
            <p className="text-xs text-slate-500">Receivables grouped by days past due date</p>
          </div>
          <div className="h-60">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={metrics.agingBuckets}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="bucket" tick={{ fontSize: 12, fill: '#64748b' }} />
                <YAxis tickFormatter={formatAxisINR} tick={{ fontSize: 12, fill: '#64748b' }} width={62} />
                <Tooltip formatter={(val) => formatINR(Number(val ?? 0))} />
                <Bar dataKey="amount" name="Outstanding Amount" fill="#d97706" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Customer Payment Performance & Top Overdue Action Table */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-display font-bold text-base text-slate-900">
                Customer Payment Performance
              </h3>
              <p className="text-xs text-slate-500">Top accounts by invoiced volume & payment risk</p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('customers')}
              className="text-xs font-semibold text-slate-700 hover:text-slate-900 underline"
            >
              All Customers
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs font-semibold text-slate-500">
                  <th className="py-2 pr-3">Customer</th>
                  <th className="py-2 px-3 text-right">Paid</th>
                  <th className="py-2 px-3 text-right">Outstanding</th>
                  <th className="py-2 pl-3 text-right">Risk</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {metrics.customerPerformance.map((cp) => (
                  <tr key={cp.customerName} className="hover:bg-slate-50">
                    <td className="py-2.5 pr-3 font-medium text-slate-900 truncate max-w-[180px]">
                      {cp.customerName}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-emerald-700">
                      {formatINR(cp.paid)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-900">
                      {formatINR(cp.outstanding)}
                    </td>
                    <td
                      className={`py-2.5 pl-3 text-right text-xs font-semibold ${
                        cp.riskLevel === 'High'
                          ? 'text-red-700'
                          : cp.riskLevel === 'Medium'
                          ? 'text-amber-700'
                          : 'text-emerald-700'
                      }`}
                    >
                      {cp.riskLevel} Risk
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-display font-bold text-base text-slate-900">
                Priority Overdue Collections
              </h3>
              <p className="text-xs text-slate-500">Recommended immediate follow-ups</p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('recovery')}
              className="text-xs font-semibold text-slate-700 hover:text-slate-900 underline"
            >
              Open Recovery Assistant
            </button>
          </div>
          {overdueTop.length === 0 ? (
            <div className="py-10 text-center text-sm text-slate-500">
              All sent invoices are within their payment due dates.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs font-semibold text-slate-500">
                    <th className="py-2 pr-3">Invoice</th>
                    <th className="py-2 px-3">Customer</th>
                    <th className="py-2 px-3 text-right">Overdue</th>
                    <th className="py-2 pl-3 text-right">Balance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {overdueTop.map((o) => (
                    <tr key={o.invoiceId} className="hover:bg-slate-50">
                      <td className="py-2.5 pr-3 font-mono font-semibold text-slate-900">
                        {o.invoiceNumber}
                      </td>
                      <td className="py-2.5 px-3 text-slate-700 truncate max-w-[160px]">
                        {o.customerBusiness || o.customerName}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-red-700 font-semibold">
                        {o.overdueDays}d
                      </td>
                      <td className="py-2.5 pl-3 text-right font-mono tabular-nums text-slate-900 font-semibold">
                        {formatINR(o.balance)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
