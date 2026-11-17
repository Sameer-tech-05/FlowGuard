import React, { useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Check, Download, Plus, Trash2, Upload } from 'lucide-react';
import { apiFetch, exportExpensesCSV } from '../lib/api';
import { formatINR } from '../lib/finance';
import { useToast } from './Toast';
import type { Expense, ExpenseCategory, RecurringExpense } from '../lib/types';

const CATEGORIES: ExpenseCategory[] = [
  'Rent',
  'Salaries',
  'Inventory',
  'Marketing',
  'Utilities',
  'Software',
  'Logistics',
  'Taxes',
  'Other',
];

export function ExpensesView() {
  const { notify } = useToast();
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [recurring, setRecurring] = useState<RecurringExpense[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'expenses' | 'recurring'>('expenses');
  const [catFilter, setCatFilter] = useState<string>('All');

  // Add Expense Modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [title, setTitle] = useState('');
  const [vendorName, setVendorName] = useState('');
  const [category, setCategory] = useState<ExpenseCategory>('Inventory');
  const [amount, setAmount] = useState('');
  const [expenseDate, setExpenseDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [status, setStatus] = useState<'Paid' | 'Pending' | 'Scheduled'>('Paid');
  const [receiptName, setReceiptName] = useState('');

  // Add Recurring Modal
  const [showRecModal, setShowRecModal] = useState(false);
  const [recFreq, setRecFreq] = useState<'Weekly' | 'Monthly' | 'Quarterly'>('Monthly');

  // CSV Import Modal
  const [showImportModal, setShowImportModal] = useState(false);
  const [csvText, setCsvText] = useState('Title,Vendor,Category,Amount,Date,Status\nPackaging Cartons,Apex Pack,Inventory,12500,2026-11-15,Paid');

  async function loadExpenses() {
    setLoading(true);
    try {
      const res = await apiFetch<{ expenses: Expense[]; recurring: RecurringExpense[] }>('/api/expenses');
      setExpenses(res.expenses);
      setRecurring(res.recurring);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to load expenses', 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadExpenses();
  }, []);

  const categoryBreakdown = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of CATEGORIES) map.set(c, 0);
    for (const e of expenses) {
      map.set(e.category, (map.get(e.category) ?? 0) + e.amount);
    }
    return Array.from(map.entries())
      .map(([name, total]) => ({ name, total }))
      .filter((x) => x.total > 0);
  }, [expenses]);

  const filteredExpenses = useMemo(() => {
    if (catFilter === 'All') return expenses;
    return expenses.filter((e) => e.category === catFilter);
  }, [expenses, catFilter]);

  async function handleAddExpense(e: React.FormEvent) {
    e.preventDefault();
    try {
      await apiFetch('/api/expenses', {
        method: 'POST',
        body: JSON.stringify({
          title,
          vendorName,
          category,
          amount: Number(amount),
          expenseDate,
          dueDate,
          status,
          receiptName: receiptName || null,
        }),
      });
      notify('Expense recorded.', 'success');
      setShowAddModal(false);
      setTitle('');
      setVendorName('');
      setAmount('');
      setReceiptName('');
      await loadExpenses();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to add expense', 'error');
    }
  }

  async function handleMarkPaid(id: string) {
    try {
      await apiFetch(`/api/expenses/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'Paid' }),
      });
      notify('Supplier bill marked as Paid.', 'success');
      await loadExpenses();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Update failed', 'error');
    }
  }

  async function handleDeleteExpense(id: string) {
    try {
      await apiFetch(`/api/expenses/${id}`, { method: 'DELETE' });
      notify('Expense deleted.', 'info');
      await loadExpenses();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Delete failed', 'error');
    }
  }

  async function handleAddRecurring(e: React.FormEvent) {
    e.preventDefault();
    try {
      await apiFetch('/api/recurring-expenses', {
        method: 'POST',
        body: JSON.stringify({
          title,
          vendorName,
          category,
          amount: Number(amount),
          frequency: recFreq,
          nextDueDate: dueDate,
        }),
      });
      notify('Recurring expense rule created.', 'success');
      setShowRecModal(false);
      setTitle('');
      setVendorName('');
      setAmount('');
      await loadExpenses();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to create rule', 'error');
    }
  }

  async function handleDeleteRecurring(id: string) {
    try {
      await apiFetch(`/api/recurring-expenses/${id}`, { method: 'DELETE' });
      notify('Recurring rule deleted.', 'info');
      await loadExpenses();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Delete failed', 'error');
    }
  }

  async function handleCSVImport(e: React.FormEvent) {
    e.preventDefault();
    const lines = csvText
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    const dataRows = lines.slice(1).map((line) => {
      const [t, v, c, a, d, s] = line.split(',').map((x) => x?.trim() ?? '');
      return {
        title: t,
        vendorName: v || 'Supplier',
        category: c || 'Other',
        amount: Number(a),
        expenseDate: d || new Date().toISOString().slice(0, 10),
        status: s || 'Paid',
      };
    });

    try {
      const res = await apiFetch<{ imported: number }>('/api/expenses/import', {
        method: 'POST',
        body: JSON.stringify({ rows: dataRows }),
      });
      notify(`Imported ${res.imported} expense(s) from CSV.`, 'success');
      setShowImportModal(false);
      await loadExpenses();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'CSV import failed', 'error');
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-xl font-bold text-slate-900">
            Expenses & Supplier Payouts
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Track operating expenses, supplier payment deadlines, recurring bills, and CSV imports.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowImportModal(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 hover:bg-slate-50 text-slate-800 text-xs font-semibold px-3 py-2"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Import CSV</span>
          </button>
          <button
            type="button"
            onClick={() => exportExpensesCSV(expenses)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 hover:bg-slate-50 text-slate-800 text-xs font-semibold px-3 py-2"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export CSV</span>
          </button>
          <button
            type="button"
            onClick={() => (tab === 'recurring' ? setShowRecModal(true) : setShowAddModal(true))}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold px-4 py-2"
          >
            <Plus className="w-4 h-4" />
            <span>{tab === 'recurring' ? 'Add Recurring Rule' : 'Add Expense'}</span>
          </button>
        </div>
      </div>

      {/* Category Breakdown Chart */}
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <h3 className="font-display font-bold text-sm text-slate-900 mb-3">
          Expense Breakdown by Category
        </h3>
        <div className="h-52">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={categoryBreakdown}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#64748b' }} />
              <YAxis
                tickFormatter={(v: number) => `₹${(v / 1000).toFixed(0)}k`}
                tick={{ fontSize: 11, fill: '#64748b' }}
                width={56}
              />
              <Tooltip formatter={(v) => formatINR(Number(v ?? 0))} />
              <Bar dataKey="total" name="Total Spend" fill="#0f172a" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Tabs & Filter */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
          <button
            type="button"
            onClick={() => setTab('expenses')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md ${
              tab === 'expenses' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
            }`}
          >
            All Expenses ({expenses.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('recurring')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md ${
              tab === 'recurring' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
            }`}
          >
            Recurring Schedule ({recurring.length})
          </button>
        </div>

        {tab === 'expenses' && (
          <select
            aria-label="Filter expenses by category"
            value={catFilter}
            onChange={(e) => setCatFilter(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium"
          >
            <option value="All">All Categories</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-slate-500">Loading expenses...</div>
        ) : tab === 'expenses' ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-left text-xs font-semibold text-slate-600">
                  <th className="py-3 px-4">Title & Vendor</th>
                  <th className="py-3 px-3">Category</th>
                  <th className="py-3 px-3">Date / Due</th>
                  <th className="py-3 px-3">Status</th>
                  <th className="py-3 px-3 text-right">Amount</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredExpenses.map((exp) => (
                  <tr key={exp.id} className="hover:bg-slate-50">
                    <td className="py-3 px-4">
                      <div className="font-medium text-slate-900">{exp.title}</div>
                      <div className="text-xs text-slate-500">
                        {exp.vendorName}
                        {exp.receiptName ? ` · Receipt: ${exp.receiptName}` : ''}
                      </div>
                    </td>
                    <td className="py-3 px-3 text-xs text-slate-700">{exp.category}</td>
                    <td className="py-3 px-3 text-xs font-mono text-slate-600">
                      <div>{exp.expenseDate}</div>
                      {exp.dueDate && exp.status !== 'Paid' && (
                        <div className="text-amber-700">Due: {exp.dueDate}</div>
                      )}
                    </td>
                    <td
                      className={`py-3 px-3 text-xs font-semibold ${
                        exp.status === 'Paid' ? 'text-emerald-700' : 'text-amber-700'
                      }`}
                    >
                      {exp.status}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums font-semibold text-slate-900">
                      {formatINR(exp.amount)}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="inline-flex items-center gap-1.5">
                        {exp.status !== 'Paid' && (
                          <button
                            type="button"
                            onClick={() => handleMarkPaid(exp.id)}
                            className="inline-flex items-center gap-1 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold px-2.5 py-1"
                          >
                            <Check className="w-3 h-3" />
                            <span>Mark Paid</span>
                          </button>
                        )}
                        <button
                          type="button"
                          aria-label={`Delete expense ${exp.title}`}
                          onClick={() => handleDeleteExpense(exp.id)}
                          className="p-1.5 rounded-md border border-slate-200 hover:bg-red-50 text-slate-500 hover:text-red-600"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-left text-xs font-semibold text-slate-600">
                  <th className="py-3 px-4">Recurring Bill</th>
                  <th className="py-3 px-3">Category</th>
                  <th className="py-3 px-3">Frequency</th>
                  <th className="py-3 px-3">Next Due Date</th>
                  <th className="py-3 px-3 text-right">Amount</th>
                  <th className="py-3 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {recurring.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="py-3 px-4">
                      <div className="font-medium text-slate-900">{r.title}</div>
                      <div className="text-xs text-slate-500">{r.vendorName}</div>
                    </td>
                    <td className="py-3 px-3 text-xs text-slate-700">{r.category}</td>
                    <td className="py-3 px-3 text-xs text-slate-700">{r.frequency}</td>
                    <td className="py-3 px-3 text-xs font-mono text-slate-600">{r.nextDueDate}</td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums font-semibold text-slate-900">
                      {formatINR(r.amount)}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button
                        type="button"
                        aria-label={`Delete recurring rule ${r.title}`}
                        onClick={() => handleDeleteRecurring(r.id)}
                        className="p-1.5 rounded-md border border-slate-200 hover:bg-red-50 text-slate-500 hover:text-red-600"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add Expense Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6 border border-slate-200 shadow-xl">
            <h3 className="font-display text-lg font-bold text-slate-900">Record Business Expense</h3>
            <form onSubmit={handleAddExpense} className="mt-4 space-y-3">
              <div>
                <label htmlFor="exp-title" className="block text-xs font-semibold text-slate-700 mb-1">
                  Title
                </label>
                <input
                  id="exp-title"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Supplier Stock Purchase"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label htmlFor="exp-vendor" className="block text-xs font-semibold text-slate-700 mb-1">
                  Vendor / Payee
                </label>
                <input
                  id="exp-vendor"
                  required
                  value={vendorName}
                  onChange={(e) => setVendorName(e.target.value)}
                  placeholder="Kaveri Mills"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="exp-cat" className="block text-xs font-semibold text-slate-700 mb-1">
                    Category
                  </label>
                  <select
                    id="exp-cat"
                    value={category}
                    onChange={(e) => setCategory(e.target.value as ExpenseCategory)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="exp-amt" className="block text-xs font-semibold text-slate-700 mb-1">
                    Amount (₹)
                  </label>
                  <input
                    id="exp-amt"
                    type="number"
                    step="0.01"
                    min="1"
                    required
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="exp-date" className="block text-xs font-semibold text-slate-700 mb-1">
                    Expense Date
                  </label>
                  <input
                    id="exp-date"
                    type="date"
                    required
                    value={expenseDate}
                    onChange={(e) => setExpenseDate(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
                  />
                </div>
                <div>
                  <label htmlFor="exp-status" className="block text-xs font-semibold text-slate-700 mb-1">
                    Payment Status
                  </label>
                  <select
                    id="exp-status"
                    value={status}
                    onChange={(e) => setStatus(e.target.value as Expense['status'])}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
                  >
                    <option value="Paid">Paid</option>
                    <option value="Pending">Pending (Upcoming)</option>
                    <option value="Scheduled">Scheduled</option>
                  </select>
                </div>
              </div>
              {status !== 'Paid' && (
                <div>
                  <label htmlFor="exp-due" className="block text-xs font-semibold text-slate-700 mb-1">
                    Payment Deadline
                  </label>
                  <input
                    id="exp-due"
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
                  />
                </div>
              )}
              <div>
                <label htmlFor="exp-rcpt" className="block text-xs font-semibold text-slate-700 mb-1">
                  Attach Receipt File (Optional)
                </label>
                <input
                  id="exp-rcpt"
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg"
                  onChange={(e) => setReceiptName(e.target.files?.[0]?.name || '')}
                  className="w-full text-xs text-slate-600"
                />
              </div>
              <div className="pt-3 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-slate-900 hover:bg-slate-800 text-white px-4 py-2 text-sm font-semibold"
                >
                  Save Expense
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Recurring Rule Modal */}
      {showRecModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6 border border-slate-200 shadow-xl">
            <h3 className="font-display text-lg font-bold text-slate-900">Create Recurring Expense Rule</h3>
            <form onSubmit={handleAddRecurring} className="mt-4 space-y-3">
              <div>
                <label htmlFor="rec-title" className="block text-xs font-semibold text-slate-700 mb-1">
                  Expense Title
                </label>
                <input
                  id="rec-title"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label htmlFor="rec-vendor" className="block text-xs font-semibold text-slate-700 mb-1">
                  Vendor
                </label>
                <input
                  id="rec-vendor"
                  required
                  value={vendorName}
                  onChange={(e) => setVendorName(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="rec-cat2" className="block text-xs font-semibold text-slate-700 mb-1">
                    Category
                  </label>
                  <select
                    id="rec-cat2"
                    value={category}
                    onChange={(e) => setCategory(e.target.value as ExpenseCategory)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="rec-amt" className="block text-xs font-semibold text-slate-700 mb-1">
                    Amount (₹)
                  </label>
                  <input
                    id="rec-amt"
                    type="number"
                    required
                    min="1"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="rec-freq" className="block text-xs font-semibold text-slate-700 mb-1">
                    Frequency
                  </label>
                  <select
                    id="rec-freq"
                    value={recFreq}
                    onChange={(e) => setRecFreq(e.target.value as 'Weekly' | 'Monthly' | 'Quarterly')}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
                  >
                    <option value="Weekly">Weekly</option>
                    <option value="Monthly">Monthly</option>
                    <option value="Quarterly">Quarterly</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="rec-next" className="block text-xs font-semibold text-slate-700 mb-1">
                    Next Due Date
                  </label>
                  <input
                    id="rec-next"
                    type="date"
                    required
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
                  />
                </div>
              </div>
              <div className="pt-3 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowRecModal(false)}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-slate-900 hover:bg-slate-800 text-white px-4 py-2 text-sm font-semibold"
                >
                  Save Rule
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CSV Import Modal */}
      {showImportModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-lg w-full p-6 border border-slate-200 shadow-xl">
            <h3 className="font-display text-lg font-bold text-slate-900">Import Expenses from CSV</h3>
            <p className="text-xs text-slate-500 mt-1">
              Format: Title, Vendor, Category, Amount, Date (YYYY-MM-DD), Status
            </p>
            <form onSubmit={handleCSVImport} className="mt-4 space-y-3">
              <textarea
                aria-label="CSV expense rows"
                rows={5}
                value={csvText}
                onChange={(e) => setCsvText(e.target.value)}
                className="w-full rounded-lg border border-slate-300 p-3 text-xs font-mono"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowImportModal(false)}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-slate-900 hover:bg-slate-800 text-white px-4 py-2 text-sm font-semibold"
                >
                  Import Rows
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
