import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Search, Trash2 } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { formatINR } from '../lib/finance';
import { useToast } from './Toast';
import type { Customer, CustomerRiskSummary, PaymentRiskLevel } from '../lib/types';

interface CustomerWithRisk extends Customer {
  risk: CustomerRiskSummary;
}

export function CustomersView() {
  const { notify } = useToast();
  const [customers, setCustomers] = useState<CustomerWithRisk[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [riskFilter, setRiskFilter] = useState<'All' | PaymentRiskLevel>('All');

  const [showModal, setShowModal] = useState(false);
  const [name, setName] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('+91 ');
  const [gstin, setGstin] = useState('');
  const [terms, setTerms] = useState('15');
  const [saving, setSaving] = useState(false);

  async function loadCustomers() {
    setLoading(true);
    try {
      const res = await apiFetch<{ customers: CustomerWithRisk[] }>('/api/customers');
      setCustomers(res.customers);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to load customers', 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadCustomers();
  }, []);

  const filtered = useMemo(() => {
    return customers.filter((c) => {
      if (riskFilter !== 'All' && c.risk?.riskLevel !== riskFilter) return false;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const hay = `${c.name} ${c.businessName} ${c.email} ${c.phone}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [customers, riskFilter, search]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await apiFetch('/api/customers', {
        method: 'POST',
        body: JSON.stringify({
          name,
          businessName,
          email,
          phone,
          gstin: gstin || null,
          paymentTermsDays: Number(terms) || 15,
        }),
      });
      notify(`Customer ${businessName} added.`, 'success');
      setShowModal(false);
      setName('');
      setBusinessName('');
      setEmail('');
      setPhone('+91 ');
      setGstin('');
      await loadCustomers();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to create customer', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(c: CustomerWithRisk) {
    try {
      await apiFetch(`/api/customers/${c.id}`, { method: 'DELETE' });
      notify(`Removed ${c.businessName}.`, 'info');
      await loadCustomers();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Cannot delete customer', 'error');
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-xl font-bold text-slate-900">
            Customers & Payment Risk Scoring
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Explainable risk indicators calculated strictly from historical settlement delays and open overdue invoices.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowModal(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold px-4 py-2.5 whitespace-nowrap shrink-0"
        >
          <Plus className="w-4 h-4" />
          <span>Add Customer</span>
        </button>
      </div>

      {/* Filter Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg w-fit">
          {(['All', 'High', 'Medium', 'Low'] as const).map((lvl) => (
            <button
              key={lvl}
              type="button"
              onClick={() => setRiskFilter(lvl)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                riskFilter === lvl ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
              }`}
            >
              {lvl === 'All' ? 'All Risks' : `${lvl} Risk`}
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            aria-label="Search customers"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search customer or business..."
            className="w-full rounded-lg border border-slate-300 pl-9 pr-3 py-2 text-sm"
          />
        </div>
      </div>

      {/* Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-slate-500">Loading customers...</div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-500">
            No customers found. Add a customer to start issuing GST invoices.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-left text-xs font-semibold text-slate-600">
                  <th className="py-3 px-4">Customer / Business</th>
                  <th className="py-3 px-3 text-right">Total Invoiced</th>
                  <th className="py-3 px-3 text-right">Total Paid</th>
                  <th className="py-3 px-3 text-right">Outstanding</th>
                  <th className="py-3 px-3 text-right">Avg Delay</th>
                  <th className="py-3 px-3">Payment Risk & Explanation</th>
                  <th className="py-3 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50 align-top">
                    <td className="py-3 px-4">
                      <div className="font-semibold text-slate-900">{c.businessName}</div>
                      <div className="text-xs text-slate-600">
                        {c.name} · {c.phone}
                      </div>
                      <div className="text-xs text-slate-400">{c.email}</div>
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-900">
                      {formatINR(c.risk?.totalInvoiced ?? 0)}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums text-emerald-700">
                      {formatINR(c.risk?.totalPaid ?? 0)}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums font-semibold text-slate-900">
                      {formatINR(c.risk?.outstandingBalance ?? 0)}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-700">
                      {c.risk?.averagePaymentDelayDays ?? 0}d
                    </td>
                    <td className="py-3 px-3 max-w-xs">
                      <div
                        className={`text-xs font-bold ${
                          c.risk?.riskLevel === 'High'
                            ? 'text-red-700'
                            : c.risk?.riskLevel === 'Medium'
                            ? 'text-amber-700'
                            : 'text-emerald-700'
                        }`}
                      >
                        {c.risk?.riskLevel ?? 'Low'} Risk ({c.risk?.overdueInvoiceCount ?? 0} overdue)
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5 leading-snug">
                        {c.risk?.explanation}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button
                        type="button"
                        aria-label={`Delete customer ${c.businessName}`}
                        onClick={() => handleDelete(c)}
                        className="p-1.5 rounded-md border border-slate-200 hover:bg-red-50 hover:text-red-600 text-slate-500"
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

      {/* Add Customer Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6 border border-slate-200 shadow-xl">
            <h3 className="font-display text-lg font-bold text-slate-900">Add New Customer</h3>
            <form onSubmit={handleCreate} className="mt-4 space-y-3">
              <div>
                <label htmlFor="cust-biz" className="block text-xs font-semibold text-slate-700 mb-1">
                  Business Name
                </label>
                <input
                  id="cust-biz"
                  required
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  placeholder="Shree Ganesh Traders"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label htmlFor="cust-name" className="block text-xs font-semibold text-slate-700 mb-1">
                  Primary Contact Name
                </label>
                <input
                  id="cust-name"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Mahesh Kulkarni"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="cust-email" className="block text-xs font-semibold text-slate-700 mb-1">
                    Email
                  </label>
                  <input
                    id="cust-email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="cust-phone" className="block text-xs font-semibold text-slate-700 mb-1">
                    Phone
                  </label>
                  <input
                    id="cust-phone"
                    required
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="cust-gst" className="block text-xs font-semibold text-slate-700 mb-1">
                    GSTIN (Optional)
                  </label>
                  <input
                    id="cust-gst"
                    value={gstin}
                    onChange={(e) => setGstin(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono uppercase"
                  />
                </div>
                <div>
                  <label htmlFor="cust-terms" className="block text-xs font-semibold text-slate-700 mb-1">
                    Payment Terms (Days)
                  </label>
                  <input
                    id="cust-terms"
                    type="number"
                    min="1"
                    value={terms}
                    onChange={(e) => setTerms(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
                  />
                </div>
              </div>
              <div className="pt-3 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-slate-900 hover:bg-slate-800 text-white px-4 py-2 text-sm font-semibold"
                >
                  {saving ? 'Saving...' : 'Save Customer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
