import React, { useEffect, useMemo, useState } from 'react';
import {
  CreditCard,
  Download,
  ExternalLink,
  Plus,
  Search,
  Send,
  Trash2,
  Wallet,
} from 'lucide-react';
import { apiFetch, generateInvoicePDF } from '../lib/api';
import { calculateInvoiceTotals, formatINR } from '../lib/finance';
import { useToast } from './Toast';
import type { Business, Customer, Invoice, InvoiceStatus, Payment } from '../lib/types';

interface InvoicesPayload {
  invoices: Invoice[];
  payments: Payment[];
}

export function InvoicesView({ business }: { business: Business }) {
  const { notify } = useToast();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);

  const [statusFilter, setStatusFilter] = useState<string>('All');
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // Create / Edit Invoice modal
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null);
  const [formCustomerId, setFormCustomerId] = useState('');
  const [formInvoiceNumber, setFormInvoiceNumber] = useState('');
  const [formIssueDate, setFormIssueDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [formDueDate, setFormDueDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 15);
    return d.toISOString().slice(0, 10);
  });
  const [formDiscount, setFormDiscount] = useState('0');
  const [formNotes, setFormNotes] = useState('');
  const [formItems, setFormItems] = useState([
    { description: '', hsnSac: '', quantity: 1, unitPrice: 1000, gstRate: 18 },
  ]);
  const [submitting, setSubmitting] = useState(false);

  // Record Payment modal
  const [paymentTarget, setPaymentTarget] = useState<Invoice | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payDate, setPayDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [payMethod, setPayMethod] = useState<Payment['method']>('UPI');
  const [payRef, setPayRef] = useState('');

  // Public Payment Link Checkout Modal
  const [checkoutTarget, setCheckoutTarget] = useState<{
    token: string;
    invoiceNumber: string;
    balanceDue: number;
    businessName: string;
  } | null>(null);
  const [checkoutAmount, setCheckoutAmount] = useState('');

  async function loadAll() {
    setLoading(true);
    try {
      const [invData, custData] = await Promise.all([
        apiFetch<InvoicesPayload>('/api/invoices'),
        apiFetch<{ customers: Customer[] }>('/api/customers'),
      ]);
      setInvoices(invData.invoices);
      setCustomers(custData.customers);
      if (!formCustomerId && custData.customers.length > 0) {
        setFormCustomerId(custData.customers[0].id);
      }
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to load invoices', 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  const filtered = useMemo(() => {
    return invoices.filter((inv) => {
      if (statusFilter !== 'All' && inv.status !== statusFilter) return false;
      if (dateFrom && inv.issueDate < dateFrom) return false;
      if (dateTo && inv.issueDate > dateTo) return false;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const hay = `${inv.invoiceNumber} ${inv.customerName ?? ''} ${inv.customerBusinessName ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [invoices, statusFilter, dateFrom, dateTo, search]);

  const liveTotals = useMemo(
    () => calculateInvoiceTotals(formItems, Number(formDiscount) || 0),
    [formItems, formDiscount]
  );

  function openNewModal() {
    setEditingDraftId(null);
    setFormInvoiceNumber('');
    setFormIssueDate(new Date().toISOString().slice(0, 10));
    const d = new Date();
    d.setDate(d.getDate() + 15);
    setFormDueDate(d.toISOString().slice(0, 10));
    setFormDiscount('0');
    setFormNotes('');
    setFormItems([{ description: '', hsnSac: '', quantity: 1, unitPrice: 1500, gstRate: 18 }]);
    setShowCreateModal(true);
  }

  function openEditDraft(inv: Invoice) {
    setEditingDraftId(inv.id);
    setFormCustomerId(inv.customerId);
    setFormInvoiceNumber(inv.invoiceNumber);
    setFormIssueDate(inv.issueDate);
    setFormDueDate(inv.dueDate);
    setFormDiscount(String(inv.discountAmount));
    setFormNotes(inv.notes ?? '');
    setFormItems(
      inv.items && inv.items.length > 0
        ? inv.items.map((it) => ({
            description: it.description,
            hsnSac: it.hsnSac ?? '',
            quantity: it.quantity,
            unitPrice: it.unitPrice,
            gstRate: it.gstRate,
          }))
        : [{ description: 'Supply item', hsnSac: '', quantity: 1, unitPrice: inv.subtotal, gstRate: 0 }]
    );
    setShowCreateModal(true);
  }

  async function submitInvoice(saveAs: 'Draft' | 'Sent') {
    setSubmitting(true);
    try {
      if (editingDraftId) {
        await apiFetch(`/api/invoices/${editingDraftId}`, {
          method: 'PATCH',
          body: JSON.stringify({
            dueDate: formDueDate,
            status: saveAs,
            discountAmount: Number(formDiscount) || 0,
            notes: formNotes,
            items: formItems,
          }),
        });
        notify(`Invoice updated (${saveAs}).`, 'success');
      } else {
        await apiFetch('/api/invoices', {
          method: 'POST',
          body: JSON.stringify({
            customerId: formCustomerId,
            invoiceNumber: formInvoiceNumber || undefined,
            issueDate: formIssueDate,
            dueDate: formDueDate,
            status: saveAs,
            discountAmount: Number(formDiscount) || 0,
            notes: formNotes,
            items: formItems,
          }),
        });
        notify(`Invoice created as ${saveAs}.`, 'success');
      }
      setShowCreateModal(false);
      await loadAll();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to save invoice', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSendInvoice(inv: Invoice) {
    try {
      const res = await apiFetch<{ message: string }>(`/api/invoices/${inv.id}/send`, {
        method: 'POST',
      });
      notify(res.message, 'success');
      await loadAll();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to send invoice', 'error');
    }
  }

  async function handleDeleteDraft(inv: Invoice) {
    try {
      await apiFetch(`/api/invoices/${inv.id}`, { method: 'DELETE' });
      notify(`Draft ${inv.invoiceNumber} deleted.`, 'info');
      await loadAll();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to delete draft', 'error');
    }
  }

  async function handleRecordPayment(e: React.FormEvent) {
    e.preventDefault();
    if (!paymentTarget) return;
    setSubmitting(true);
    try {
      await apiFetch(`/api/invoices/${paymentTarget.id}/payments`, {
        method: 'POST',
        body: JSON.stringify({
          amount: Number(payAmount),
          paymentDate: payDate,
          method: payMethod,
          referenceId: payRef,
        }),
      });
      notify(`Payment of ${formatINR(Number(payAmount))} recorded for ${paymentTarget.invoiceNumber}.`, 'success');
      setPaymentTarget(null);
      await loadAll();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to record payment', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  async function openPaymentLinkPreview(inv: Invoice) {
    if (!inv.paymentLinkToken) return;
    try {
      const info = await apiFetch<{
        invoiceNumber: string;
        balanceDue: number;
        businessName: string;
      }>(`/api/pay/${inv.paymentLinkToken}`);
      setCheckoutTarget({
        token: inv.paymentLinkToken,
        invoiceNumber: info.invoiceNumber,
        balanceDue: info.balanceDue,
        businessName: info.businessName,
      });
      setCheckoutAmount(String(info.balanceDue));
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not open payment link', 'error');
    }
  }

  async function handleSimulatedCheckout(e: React.FormEvent) {
    e.preventDefault();
    if (!checkoutTarget) return;
    setSubmitting(true);
    try {
      const res = await apiFetch<{ amountPaid: number; referenceId: string }>(
        `/api/pay/${checkoutTarget.token}/checkout`,
        {
          method: 'POST',
          body: JSON.stringify({ amount: Number(checkoutAmount) }),
        }
      );
      notify(
        `Razorpay Test Mode payment of ${formatINR(res.amountPaid)} reconciled (Ref: ${res.referenceId}).`,
        'success'
      );
      setCheckoutTarget(null);
      await loadAll();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Payment simulation failed', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  const statuses: Array<'All' | InvoiceStatus> = [
    'All',
    'Overdue',
    'Sent',
    'Partially Paid',
    'Paid',
    'Draft',
    'Cancelled',
  ];

  const statusColor = (status: InvoiceStatus) => {
    if (status === 'Paid') return 'text-emerald-700';
    if (status === 'Overdue') return 'text-red-700';
    if (status === 'Partially Paid' || status === 'Sent') return 'text-amber-700';
    return 'text-slate-600';
  };

  return (
    <div className="space-y-5">
      {/* Header Toolbar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-xl font-bold text-slate-900">Smart GST Invoices</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Create invoices, track partial payments, download PDFs, and reconcile Razorpay test links.
          </p>
        </div>
        <button
          type="button"
          onClick={openNewModal}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold px-4 py-2.5 transition-colors whitespace-nowrap shrink-0"
        >
          <Plus className="w-4 h-4" />
          <span>New Invoice</span>
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg w-fit">
          {statuses.map((st) => (
            <button
              key={st}
              type="button"
              onClick={() => setStatusFilter(st)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                statusFilter === st
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {st}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              aria-label="Search invoices by number or customer"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search invoice # or customer..."
              className="w-full rounded-lg border border-slate-300 pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
            />
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="inv-from" className="text-xs text-slate-500 whitespace-nowrap">
              From
            </label>
            <input
              id="inv-from"
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
            />
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="inv-to" className="text-xs text-slate-500 whitespace-nowrap">
              To
            </label>
            <input
              id="inv-to"
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
            />
          </div>
        </div>
      </div>

      {/* Invoices Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-slate-500">Loading invoices...</div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-sm font-medium text-slate-700">No invoices match the current filter.</p>
            <button
              type="button"
              onClick={openNewModal}
              className="mt-3 rounded-lg bg-slate-900 text-white text-xs font-semibold px-4 py-2"
            >
              Create First Invoice
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-left text-xs font-semibold text-slate-600">
                  <th className="py-3 px-4">Invoice</th>
                  <th className="py-3 px-3">Customer</th>
                  <th className="py-3 px-3">Dates</th>
                  <th className="py-3 px-3">Status</th>
                  <th className="py-3 px-3 text-right">Total</th>
                  <th className="py-3 px-3 text-right">Paid</th>
                  <th className="py-3 px-3 text-right">Balance</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((inv) => {
                  const balance = Math.max(0, Number((inv.totalAmount - inv.paidAmount).toFixed(2)));
                  return (
                    <tr key={inv.id} className="hover:bg-slate-50">
                      <td className="py-3 px-4 font-mono font-semibold text-slate-900 whitespace-nowrap">
                        {inv.invoiceNumber}
                      </td>
                      <td className="py-3 px-3">
                        <div className="font-medium text-slate-900">{inv.customerBusinessName}</div>
                        <div className="text-xs text-slate-500">{inv.customerName}</div>
                      </td>
                      <td className="py-3 px-3 text-xs font-mono text-slate-600 whitespace-nowrap">
                        <div>Iss: {inv.issueDate}</div>
                        <div>Due: {inv.dueDate}</div>
                      </td>
                      <td className={`py-3 px-3 text-xs font-semibold whitespace-nowrap ${statusColor(inv.status)}`}>
                        {inv.status}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-900">
                        {formatINR(inv.totalAmount)}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums text-emerald-700">
                        {formatINR(inv.paidAmount)}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums font-semibold text-slate-900">
                        {formatINR(balance)}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="inline-flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            title="Download PDF"
                            aria-label={`Download PDF ${inv.invoiceNumber}`}
                            onClick={() => generateInvoicePDF(inv, business)}
                            className="p-1.5 rounded-md border border-slate-200 hover:bg-slate-100 text-slate-700"
                          >
                            <Download className="w-3.5 h-3.5" />
                          </button>

                          {inv.status === 'Draft' ? (
                            <>
                              <button
                                type="button"
                                onClick={() => openEditDraft(inv)}
                                className="px-2.5 py-1 rounded-md border border-slate-200 hover:bg-slate-100 text-xs font-medium text-slate-700"
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => handleSendInvoice(inv)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium"
                              >
                                <Send className="w-3 h-3" />
                                <span>Send</span>
                              </button>
                              <button
                                type="button"
                                aria-label={`Delete draft ${inv.invoiceNumber}`}
                                onClick={() => handleDeleteDraft(inv)}
                                className="p-1.5 rounded-md border border-red-200 hover:bg-red-50 text-red-600"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </>
                          ) : balance > 0 && inv.status !== 'Cancelled' ? (
                            <>
                              <button
                                type="button"
                                onClick={() => {
                                  setPaymentTarget(inv);
                                  setPayAmount(String(balance));
                                }}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold whitespace-nowrap"
                              >
                                <Wallet className="w-3 h-3" />
                                <span>Record Payment</span>
                              </button>
                              {inv.paymentLinkToken && (
                                <button
                                  type="button"
                                  title="Open Razorpay Test Payment Link"
                                  aria-label={`Payment link ${inv.invoiceNumber}`}
                                  onClick={() => openPaymentLinkPreview(inv)}
                                  className="p-1.5 rounded-md border border-slate-200 hover:bg-slate-100 text-slate-700"
                                >
                                  <ExternalLink className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create / Edit Invoice Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-xl max-w-2xl w-full p-6 border border-slate-200 shadow-xl my-8">
            <h3 className="font-display text-lg font-bold text-slate-900">
              {editingDraftId ? 'Edit Draft Invoice' : 'Create GST Invoice'}
            </h3>

            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="inv-cust" className="block text-xs font-semibold text-slate-700 mb-1">
                  Customer
                </label>
                <select
                  id="inv-cust"
                  disabled={Boolean(editingDraftId)}
                  value={formCustomerId}
                  onChange={(e) => setFormCustomerId(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
                >
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.businessName} ({c.name})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="inv-num" className="block text-xs font-semibold text-slate-700 mb-1">
                  Invoice Number (blank = auto)
                </label>
                <input
                  id="inv-num"
                  disabled={Boolean(editingDraftId)}
                  value={formInvoiceNumber}
                  onChange={(e) => setFormInvoiceNumber(e.target.value)}
                  placeholder="INV-1099"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
                />
              </div>
              <div>
                <label htmlFor="inv-issue" className="block text-xs font-semibold text-slate-700 mb-1">
                  Issue Date
                </label>
                <input
                  id="inv-issue"
                  type="date"
                  disabled={Boolean(editingDraftId)}
                  value={formIssueDate}
                  onChange={(e) => setFormIssueDate(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
                />
              </div>
              <div>
                <label htmlFor="inv-due" className="block text-xs font-semibold text-slate-700 mb-1">
                  Payment Deadline
                </label>
                <input
                  id="inv-due"
                  type="date"
                  value={formDueDate}
                  onChange={(e) => setFormDueDate(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
                />
              </div>
            </div>

            {/* Line Items */}
            <div className="mt-5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-slate-700">Line Items</span>
                <button
                  type="button"
                  onClick={() =>
                    setFormItems((prev) => [
                      ...prev,
                      { description: '', hsnSac: '', quantity: 1, unitPrice: 500, gstRate: 18 },
                    ])
                  }
                  className="text-xs font-semibold text-slate-900 underline"
                >
                  + Add Item
                </button>
              </div>

              <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                {formItems.map((item, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                    <input
                      aria-label={`Item ${idx + 1} description`}
                      placeholder="Product / Service description"
                      value={item.description}
                      onChange={(e) => {
                        const val = e.target.value;
                        setFormItems((prev) =>
                          prev.map((it, i) => (i === idx ? { ...it, description: val } : it))
                        );
                      }}
                      className="col-span-5 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs"
                    />
                    <input
                      aria-label={`Item ${idx + 1} quantity`}
                      type="number"
                      min="1"
                      step="1"
                      value={item.quantity}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        setFormItems((prev) =>
                          prev.map((it, i) => (i === idx ? { ...it, quantity: val } : it))
                        );
                      }}
                      className="col-span-2 rounded-lg border border-slate-300 px-2 py-1.5 text-xs font-mono text-right"
                    />
                    <input
                      aria-label={`Item ${idx + 1} unit price`}
                      type="number"
                      min="0"
                      step="0.01"
                      value={item.unitPrice}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        setFormItems((prev) =>
                          prev.map((it, i) => (i === idx ? { ...it, unitPrice: val } : it))
                        );
                      }}
                      className="col-span-2 rounded-lg border border-slate-300 px-2 py-1.5 text-xs font-mono text-right"
                    />
                    <select
                      aria-label={`Item ${idx + 1} GST rate`}
                      value={item.gstRate}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        setFormItems((prev) =>
                          prev.map((it, i) => (i === idx ? { ...it, gstRate: val } : it))
                        );
                      }}
                      className="col-span-2 rounded-lg border border-slate-300 px-1.5 py-1.5 text-xs bg-white font-mono"
                    >
                      <option value={0}>0% GST</option>
                      <option value={5}>5% GST</option>
                      <option value={12}>12% GST</option>
                      <option value={18}>18% GST</option>
                      <option value={28}>28% GST</option>
                    </select>
                    <button
                      type="button"
                      aria-label={`Remove item ${idx + 1}`}
                      disabled={formItems.length === 1}
                      onClick={() =>
                        setFormItems((prev) => prev.filter((_, i) => i !== idx))
                      }
                      className="col-span-1 text-slate-400 hover:text-red-600 disabled:opacity-30 flex justify-center"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4 items-end">
              <div>
                <label htmlFor="inv-disc" className="block text-xs font-semibold text-slate-700 mb-1">
                  Discount (₹)
                </label>
                <input
                  id="inv-disc"
                  type="number"
                  min="0"
                  value={formDiscount}
                  onChange={(e) => setFormDiscount(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
                />
              </div>
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs space-y-1 font-mono tabular-nums">
                <div className="flex justify-between">
                  <span className="text-slate-600">Subtotal:</span>
                  <span>{formatINR(liveTotals.subtotal)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">GST Tax:</span>
                  <span>{formatINR(liveTotals.gstAmount)}</span>
                </div>
                <div className="flex justify-between font-bold text-slate-900 border-t border-slate-200 pt-1">
                  <span>Total Payable:</span>
                  <span>{formatINR(liveTotals.totalAmount)}</span>
                </div>
              </div>
            </div>

            <div className="mt-4">
              <label htmlFor="inv-notes" className="block text-xs font-semibold text-slate-700 mb-1">
                Notes / Payment Instructions
              </label>
              <input
                id="inv-notes"
                value={formNotes}
                onChange={(e) => setFormNotes(e.target.value)}
                placeholder="Thank you for your business. Kindly pay via UPI/NEFT."
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => submitInvoice('Draft')}
                className="rounded-lg border border-slate-900 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50"
              >
                Save as Draft
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => submitInvoice('Sent')}
                className="rounded-lg bg-slate-900 hover:bg-slate-800 text-white px-4 py-2 text-sm font-semibold"
              >
                {submitting ? 'Saving...' : 'Issue & Send Invoice'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Record Payment Modal */}
      {paymentTarget && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6 border border-slate-200 shadow-xl">
            <h3 className="font-display text-lg font-bold text-slate-900">
              Record Payment · {paymentTarget.invoiceNumber}
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              Outstanding Balance:{' '}
              <strong className="font-mono text-slate-900">
                {formatINR(Math.max(0, paymentTarget.totalAmount - paymentTarget.paidAmount))}
              </strong>
            </p>

            <form onSubmit={handleRecordPayment} className="mt-4 space-y-3">
              <div>
                <label htmlFor="pay-amt" className="block text-xs font-semibold text-slate-700 mb-1">
                  Amount Received (₹)
                </label>
                <input
                  id="pay-amt"
                  type="number"
                  step="0.01"
                  required
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="pay-date" className="block text-xs font-semibold text-slate-700 mb-1">
                    Payment Date
                  </label>
                  <input
                    id="pay-date"
                    type="date"
                    required
                    value={payDate}
                    onChange={(e) => setPayDate(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
                  />
                </div>
                <div>
                  <label htmlFor="pay-method" className="block text-xs font-semibold text-slate-700 mb-1">
                    Method
                  </label>
                  <select
                    id="pay-method"
                    value={payMethod}
                    onChange={(e) => setPayMethod(e.target.value as Payment['method'])}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
                  >
                    <option value="UPI">UPI</option>
                    <option value="NEFT/RTGS">NEFT/RTGS</option>
                    <option value="Bank Transfer">Bank Transfer</option>
                    <option value="Cheque">Cheque</option>
                    <option value="Cash">Cash</option>
                  </select>
                </div>
              </div>
              <div>
                <label htmlFor="pay-ref" className="block text-xs font-semibold text-slate-700 mb-1">
                  UTR / Reference ID
                </label>
                <input
                  id="pay-ref"
                  value={payRef}
                  onChange={(e) => setPayRef(e.target.value)}
                  placeholder="UTR2026..."
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
                />
              </div>
              <div className="pt-3 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setPaymentTarget(null)}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 text-sm font-semibold"
                >
                  {submitting ? 'Saving...' : 'Confirm Payment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Razorpay Test Checkout Link Simulator Modal */}
      {checkoutTarget && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6 border border-slate-200 shadow-xl">
            <div className="flex items-center gap-2 text-xs font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              <CreditCard className="w-4 h-4 shrink-0" />
              <span>Razorpay Test Mode · Simulated Payment Link Checkout</span>
            </div>
            <h3 className="mt-4 font-display text-lg font-bold text-slate-900">
              Pay {checkoutTarget.businessName}
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              Invoice <span className="font-mono font-semibold">{checkoutTarget.invoiceNumber}</span> · Balance due{' '}
              <span className="font-mono font-semibold">{formatINR(checkoutTarget.balanceDue)}</span>
            </p>
            <form onSubmit={handleSimulatedCheckout} className="mt-4 space-y-3">
              <div>
                <label htmlFor="chk-amt" className="block text-xs font-semibold text-slate-700 mb-1">
                  Pay Amount (Partial or Full ₹)
                </label>
                <input
                  id="chk-amt"
                  type="number"
                  step="0.01"
                  max={checkoutTarget.balanceDue}
                  min="1"
                  required
                  value={checkoutAmount}
                  onChange={(e) => setCheckoutAmount(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
                />
              </div>
              <p className="text-xs text-slate-500">
                No card numbers, CVVs, or UPI PINs are collected or stored by FlowGuard AI.
              </p>
              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setCheckoutTarget(null)}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700"
                >
                  Close
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-lg bg-slate-900 hover:bg-slate-800 text-white px-4 py-2 text-sm font-semibold"
                >
                  {submitting ? 'Processing...' : 'Simulate Razorpay Checkout'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
