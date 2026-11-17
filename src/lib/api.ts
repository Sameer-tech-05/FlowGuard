import { jsPDF } from 'jspdf';
import { formatINR } from './finance';
import type { Business, Expense, Invoice } from './types';

let inMemoryToken: string | null = null;

export function setAuthToken(token: string | null): void {
  inMemoryToken = token;
  try {
    if (token) {
      window.sessionStorage.setItem('fg_auth_token', token);
    } else {
      window.sessionStorage.removeItem('fg_auth_token');
    }
  } catch {
    // Fallback to in-memory token if storage is restricted
  }
}

export function getAuthToken(): string | null {
  if (inMemoryToken) return inMemoryToken;
  try {
    return window.sessionStorage.getItem('fg_auth_token');
  } catch {
    return null;
  }
}

export async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const token = getAuthToken();
  const { headers: customHeaders, ...restOptions } = options ?? {};
  const res = await fetch(url, {
    credentials: 'include',
    ...restOptions,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(customHeaders ?? {}),
    },
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
  }
  return data as T;
}

export function downloadCSV(filename: string, headers: string[], rows: Array<Array<string | number>>): void {
  const escape = (val: string | number) => {
    const s = String(val ?? '');
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const csv = [headers.map(escape).join(','), ...rows.map((r) => r.map(escape).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function generateInvoicePDF(invoice: Invoice, business: Business): void {
  const doc = new jsPDF();
  let y = 20;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text(business.name, 14, y);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'normal');
  doc.text('TAX INVOICE (Reference Format)', 196, y, { align: 'right' });

  y += 7;
  doc.setFontSize(9);
  doc.setTextColor(80);
  doc.text(`${business.location} · ${business.phone} · ${business.email}`, 14, y);
  if (business.gstin) {
    y += 5;
    doc.text(`GSTIN: ${business.gstin}`, 14, y);
  }

  y += 8;
  doc.setDrawColor(210);
  doc.line(14, y, 196, y);

  y += 8;
  doc.setTextColor(20);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('Bill To:', 14, y);
  doc.text(`Invoice #: ${invoice.invoiceNumber}`, 130, y);

  y += 5;
  doc.setFont('helvetica', 'normal');
  doc.text(invoice.customerBusinessName || invoice.customerName || 'Customer', 14, y);
  doc.text(`Issue Date: ${invoice.issueDate}`, 130, y);

  y += 5;
  doc.text(`Attn: ${invoice.customerName || ''}`, 14, y);
  doc.text(`Due Date: ${invoice.dueDate}`, 130, y);

  y += 5;
  if (invoice.customerEmail) doc.text(invoice.customerEmail, 14, y);
  doc.text(`Status: ${invoice.status}`, 130, y);

  y += 10;
  // Table header
  doc.setFillColor(241, 245, 249);
  doc.rect(14, y, 182, 8, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('Description', 16, y + 5.5);
  doc.text('Qty', 110, y + 5.5, { align: 'right' });
  doc.text('Rate', 140, y + 5.5, { align: 'right' });
  doc.text('GST%', 160, y + 5.5, { align: 'right' });
  doc.text('Amount', 194, y + 5.5, { align: 'right' });

  y += 12;
  doc.setFont('helvetica', 'normal');
  const items = invoice.items && invoice.items.length > 0
    ? invoice.items
    : [{ description: 'Wholesale Goods Supply', quantity: 1, unitPrice: invoice.subtotal, gstRate: 0, lineTotal: invoice.subtotal }];

  for (const item of items) {
    if (y > 260) {
      doc.addPage();
      y = 20;
    }
    doc.text(item.description.slice(0, 48), 16, y);
    doc.text(String(item.quantity), 110, y, { align: 'right' });
    doc.text(formatINR(item.unitPrice).replace('₹', 'INR '), 140, y, { align: 'right' });
    doc.text(`${item.gstRate}%`, 160, y, { align: 'right' });
    doc.text(formatINR(item.lineTotal).replace('₹', 'INR '), 194, y, { align: 'right' });
    y += 7;
  }

  y += 4;
  doc.line(120, y, 196, y);
  y += 7;
  const fmt = (n: number) => formatINR(n).replace('₹', 'INR ');
  doc.text('Subtotal:', 140, y);
  doc.text(fmt(invoice.subtotal), 194, y, { align: 'right' });
  if (invoice.discountAmount > 0) {
    y += 6;
    doc.text('Discount:', 140, y);
    doc.text(`-${fmt(invoice.discountAmount)}`, 194, y, { align: 'right' });
  }
  y += 6;
  doc.text('GST Total:', 140, y);
  doc.text(fmt(invoice.gstAmount), 194, y, { align: 'right' });
  y += 7;
  doc.setFont('helvetica', 'bold');
  doc.text('Total Invoice:', 140, y);
  doc.text(fmt(invoice.totalAmount), 194, y, { align: 'right' });
  y += 6;
  doc.setFont('helvetica', 'normal');
  doc.text('Paid to Date:', 140, y);
  doc.text(fmt(invoice.paidAmount), 194, y, { align: 'right' });
  y += 6;
  doc.setFont('helvetica', 'bold');
  doc.text('Balance Due:', 140, y);
  doc.text(fmt(Math.max(0, invoice.totalAmount - invoice.paidAmount)), 194, y, { align: 'right' });

  y += 16;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(110);
  doc.text(
    'Generated via FlowGuard AI. Standard invoice summary for business accounting; verify statutory GST e-invoicing rules as applicable.',
    14,
    y
  );

  doc.save(`${invoice.invoiceNumber}.pdf`);
}

export function generateAnalyticsReportPDF(params: {
  title: string;
  businessName: string;
  periodLabel: string;
  summaryRows: Array<[string, string]>;
  tableHeaders: string[];
  tableRows: Array<Array<string | number>>;
}): void {
  const doc = new jsPDF();
  let y = 18;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text(params.businessName, 14, y);
  y += 7;
  doc.setFontSize(12);
  doc.text(params.title, 14, y);
  y += 6;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(90);
  doc.text(`Period: ${params.periodLabel} · Generated ${new Date().toISOString().slice(0, 10)}`, 14, y);

  y += 8;
  doc.setTextColor(20);
  for (const [label, val] of params.summaryRows) {
    doc.setFont('helvetica', 'bold');
    doc.text(`${label}:`, 14, y);
    doc.setFont('helvetica', 'normal');
    doc.text(val.replace(/₹/g, 'INR '), 80, y);
    y += 6;
  }

  y += 6;
  doc.setFillColor(241, 245, 249);
  doc.rect(14, y, 182, 8, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  const colWidth = 180 / Math.max(1, params.tableHeaders.length);
  params.tableHeaders.forEach((h, idx) => {
    doc.text(h, 16 + idx * colWidth, y + 5.5);
  });

  y += 12;
  doc.setFont('helvetica', 'normal');
  for (const row of params.tableRows.slice(0, 35)) {
    if (y > 275) {
      doc.addPage();
      y = 20;
    }
    row.forEach((cell, idx) => {
      const txt = String(cell).replace(/₹/g, 'INR ').slice(0, 24);
      doc.text(txt, 16 + idx * colWidth, y);
    });
    y += 6;
  }

  doc.save(`${params.title.toLowerCase().replace(/\s+/g, '_')}.pdf`);
}

export function exportExpensesCSV(expenses: Expense[]): void {
  downloadCSV(
    `flowguard_expenses_${new Date().toISOString().slice(0, 10)}.csv`,
    ['Date', 'Due Date', 'Title', 'Vendor', 'Category', 'Amount (INR)', 'Status', 'Notes'],
    expenses.map((e) => [
      e.expenseDate,
      e.dueDate || '',
      e.title,
      e.vendorName,
      e.category,
      e.amount.toFixed(2),
      e.status,
      e.notes || '',
    ])
  );
}
