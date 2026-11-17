import React, { useEffect, useMemo, useState } from 'react';
import { Download, FileText } from 'lucide-react';
import { apiFetch, downloadCSV, generateAnalyticsReportPDF } from '../lib/api';
import { formatINR } from '../lib/finance';
import { useToast } from './Toast';
import type { Business, DashboardMetrics, Expense, Invoice, Payment } from '../lib/types';

export function ReportsView({ business }: { business: Business }) {
  const { notify } = useToast();
  const [reportType, setReportType] = useState<
    'collections' | 'outstanding' | 'aging' | 'expenses' | 'effectiveness'
  >('collections');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [loading, setLoading] = useState(true);

  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      apiFetch<{ invoices: Invoice[]; payments: Payment[] }>('/api/invoices'),
      apiFetch<{ expenses: Expense[] }>('/api/expenses'),
      apiFetch<{ metrics: DashboardMetrics }>('/api/dashboard'),
    ])
      .then(([invRes, expRes, dashRes]) => {
        setInvoices(invRes.invoices);
        setPayments(invRes.payments);
        setExpenses(expRes.expenses);
        setMetrics(dashRes.metrics);
      })
      .catch((err) => notify(err instanceof Error ? err.message : 'Failed to load report data', 'error'))
      .finally(() => setLoading(false));
  }, []);

  const filteredPayments = useMemo(
    () =>
      payments.filter(
        (p) => (!dateFrom || p.paymentDate >= dateFrom) && (!dateTo || p.paymentDate <= dateTo)
      ),
    [payments, dateFrom, dateTo]
  );

  const filteredExpenses = useMemo(
    () =>
      expenses.filter(
        (e) => (!dateFrom || e.expenseDate >= dateFrom) && (!dateTo || e.expenseDate <= dateTo)
      ),
    [expenses, dateFrom, dateTo]
  );

  const filteredInvoices = useMemo(
    () =>
      invoices.filter(
        (i) => (!dateFrom || i.issueDate >= dateFrom) && (!dateTo || i.issueDate <= dateTo)
      ),
    [invoices, dateFrom, dateTo]
  );

  function getReportData(): {
    title: string;
    summaryRows: Array<[string, string]>;
    headers: string[];
    rows: Array<Array<string | number>>;
  } {
    if (reportType === 'collections') {
      const total = filteredPayments.reduce((s, p) => s + p.amount, 0);
      return {
        title: 'Monthly Collections Report',
        summaryRows: [
          ['Total Collections Received', formatINR(total)],
          ['Transactions Count', String(filteredPayments.length)],
        ],
        headers: ['Date', 'Invoice #', 'Customer', 'Method', 'Reference', 'Amount (INR)'],
        rows: filteredPayments.map((p) => [
          p.paymentDate,
          p.invoiceNumber || '',
          p.customerName || '',
          p.method,
          p.referenceId || '-',
          p.amount.toFixed(2),
        ]),
      };
    }

    if (reportType === 'outstanding') {
      const open = filteredInvoices.filter((i) => i.status !== 'Paid' && i.status !== 'Cancelled' && i.status !== 'Draft');
      const totalBal = open.reduce((s, i) => s + Math.max(0, i.totalAmount - i.paidAmount), 0);
      return {
        title: 'Outstanding & Overdue Receivables Report',
        summaryRows: [
          ['Total Open Receivables', formatINR(totalBal)],
          ['Open Invoices Count', String(open.length)],
        ],
        headers: ['Invoice #', 'Customer', 'Due Date', 'Status', 'Total', 'Balance Due'],
        rows: open.map((i) => [
          i.invoiceNumber,
          i.customerBusinessName || i.customerName || '',
          i.dueDate,
          i.status,
          i.totalAmount.toFixed(2),
          Math.max(0, i.totalAmount - i.paidAmount).toFixed(2),
        ]),
      };
    }

    if (reportType === 'aging') {
      const buckets = metrics?.agingBuckets ?? [];
      return {
        title: 'Invoice Aging Breakdown Report',
        summaryRows: [
          ['Total Outstanding', formatINR(metrics?.totalOutstandingReceivables ?? 0)],
          ['Total Overdue', formatINR(metrics?.totalOverduePayments ?? 0)],
        ],
        headers: ['Aging Category', 'Invoice Count', 'Outstanding Amount (INR)'],
        rows: buckets.map((b) => [b.bucket, b.count, b.amount.toFixed(2)]),
      };
    }

    if (reportType === 'expenses') {
      const totalExp = filteredExpenses.reduce((s, e) => s + e.amount, 0);
      return {
        title: 'Expenses & Supplier Outflows Report',
        summaryRows: [
          ['Total Expenses', formatINR(totalExp)],
          ['Records Count', String(filteredExpenses.length)],
        ],
        headers: ['Date', 'Title', 'Vendor', 'Category', 'Status', 'Amount (INR)'],
        rows: filteredExpenses.map((e) => [
          e.expenseDate,
          e.title,
          e.vendorName,
          e.category,
          e.status,
          e.amount.toFixed(2),
        ]),
      };
    }

    const totalBilled = filteredInvoices
      .filter((i) => i.status !== 'Draft' && i.status !== 'Cancelled')
      .reduce((s, i) => s + i.totalAmount, 0);
    const totalCollected = filteredInvoices
      .filter((i) => i.status !== 'Draft' && i.status !== 'Cancelled')
      .reduce((s, i) => s + i.paidAmount, 0);
    const effRate = totalBilled > 0 ? ((totalCollected / totalBilled) * 100).toFixed(1) : '0.0';

    return {
      title: 'Collection Effectiveness Report',
      summaryRows: [
        ['Total Billed Revenue', formatINR(totalBilled)],
        ['Total Collected', formatINR(totalCollected)],
        ['Collection Effectiveness Ratio', `${effRate}%`],
      ],
      headers: ['Month', 'Cash Inflow (INR)', 'Cash Outflow (INR)', 'Billed Revenue (INR)'],
      rows: (metrics?.monthlyCashFlowSeries ?? []).map((m) => [
        m.month,
        m.inflow.toFixed(2),
        m.outflow.toFixed(2),
        m.revenue.toFixed(2),
      ]),
    };
  }

  const report = getReportData();

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-xl font-bold text-slate-900">
            Financial Reports & Exports
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Custom period filtering with one-click CSV and PDF exports for accountants and lenders.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() =>
              downloadCSV(`${reportType}_report.csv`, report.headers, report.rows)
            }
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 hover:bg-slate-50 text-slate-800 text-xs font-semibold px-3.5 py-2"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export CSV</span>
          </button>
          <button
            type="button"
            onClick={() =>
              generateAnalyticsReportPDF({
                title: report.title,
                businessName: business.name,
                periodLabel: `${dateFrom || 'Inception'} to ${dateTo || 'Present'}`,
                summaryRows: report.summaryRows,
                tableHeaders: report.headers,
                tableRows: report.rows,
              })
            }
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold px-3.5 py-2"
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Download PDF</span>
          </button>
        </div>
      </div>

      {/* Controls */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg">
          {[
            ['collections', 'Collections'],
            ['outstanding', 'Outstanding'],
            ['aging', 'Invoice Aging'],
            ['expenses', 'Expenses'],
            ['effectiveness', 'Collection Effectiveness'],
          ].map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setReportType(key as typeof reportType)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md whitespace-nowrap ${
                reportType === key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 text-xs">
          <label htmlFor="rep-from" className="text-slate-500">From</label>
          <input
            id="rep-from"
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="rounded-lg border border-slate-300 px-2.5 py-1.5 font-mono"
          />
          <label htmlFor="rep-to" className="text-slate-500">To</label>
          <input
            id="rep-to"
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="rounded-lg border border-slate-300 px-2.5 py-1.5 font-mono"
          />
        </div>
      </div>

      {/* Summary & Preview Table */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {report.summaryRows.map(([lbl, val]) => (
          <div key={lbl} className="bg-white border border-slate-200 rounded-xl p-4">
            <div className="text-xs font-semibold text-slate-500">{lbl}</div>
            <div className="mt-2 font-mono tabular-nums text-xl font-bold text-slate-900">{val}</div>
          </div>
        ))}
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-slate-500">Preparing report...</div>
        ) : report.rows.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">No records in selected period.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-left text-xs font-semibold text-slate-600">
                  {report.headers.map((h) => (
                    <th key={h} className="py-3 px-4">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {report.rows.slice(0, 50).map((row, idx) => (
                  <tr key={idx} className="hover:bg-slate-50">
                    {row.map((cell, cIdx) => (
                      <td key={cIdx} className="py-2.5 px-4 font-mono text-xs text-slate-800">
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
