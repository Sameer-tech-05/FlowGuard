import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCashFlowForecast,
  calculateInvoiceTotals,
  computeCurrentCashBalance,
  computeCustomerRiskSummaries,
  computeDashboardMetrics,
  formatINR,
  resolveInvoiceStatus,
} from './finance';
import type { Customer, Expense, Invoice, Payment, RecurringExpense } from './types';

test('calculateInvoiceTotals avoids floating point drift and handles GST + discount accurately', () => {
  const result = calculateInvoiceTotals(
    [
      { quantity: 3, unitPrice: 199.99, gstRate: 18 },
      { quantity: 2, unitPrice: 450.5, gstRate: 12 },
    ],
    100
  );
  // 3 * 199.99 = 599.97; 2 * 450.50 = 901.00 => subtotal = 1500.97
  assert.equal(result.subtotal, 1500.97);
  assert.equal(result.discountApplied, 100);
  // Pre-discount GST: 599.97 * 0.18 = 107.9946 -> 107.99; 901 * 0.12 = 108.12 -> total raw GST = 216.11
  // Discount factor: 1400.97 / 1500.97 = 0.9333764... => adjusted GST ~ 201.71
  assert.equal(result.gstAmount, 201.71);
  assert.equal(result.totalAmount, 1602.68);
});

test('formatINR formats Indian lakh and crore conventions properly', () => {
  assert.equal(formatINR(150000), '₹1,50,000.00');
  assert.equal(formatINR(1500000, true), '₹15.00 L');
});

test('resolveInvoiceStatus identifies Paid, Partially Paid, Sent, and Overdue accurately', () => {
  const ref = '2026-11-17';
  assert.equal(
    resolveInvoiceStatus(
      { status: 'Sent', totalAmount: 10000, paidAmount: 10000, dueDate: '2026-11-01' },
      ref
    ),
    'Paid'
  );
  assert.equal(
    resolveInvoiceStatus(
      { status: 'Sent', totalAmount: 10000, paidAmount: 4000, dueDate: '2026-11-25' },
      ref
    ),
    'Partially Paid'
  );
  assert.equal(
    resolveInvoiceStatus(
      { status: 'Sent', totalAmount: 10000, paidAmount: 4000, dueDate: '2026-11-10' },
      ref
    ),
    'Overdue'
  );
  assert.equal(
    resolveInvoiceStatus(
      { status: 'Draft', totalAmount: 10000, paidAmount: 0, dueDate: '2026-11-01' },
      ref
    ),
    'Draft'
  );
});

test('computeCustomerRiskSummaries assigns High risk with explainable reason when recent invoices are >15d late', () => {
  const customers: Customer[] = [
    {
      id: 'c1',
      businessId: 'b1',
      name: 'Ramesh Gupta',
      businessName: 'Gupta Kirana Mart',
      email: 'ramesh@example.com',
      phone: '+919800000001',
      gstin: null,
      paymentTermsDays: 15,
      isSimulated: false,
      createdAt: '2026-01-01',
    },
  ];
  const invoices: Invoice[] = [
    {
      id: 'i1',
      businessId: 'b1',
      customerId: 'c1',
      invoiceNumber: 'INV-1',
      issueDate: '2026-09-01',
      dueDate: '2026-09-15',
      status: 'Paid',
      subtotal: 10000,
      discountAmount: 0,
      gstAmount: 1800,
      totalAmount: 11800,
      paidAmount: 11800,
      notes: null,
      paymentLinkToken: null,
      isSimulated: false,
      createdAt: '2026-09-01',
    },
    {
      id: 'i2',
      businessId: 'b1',
      customerId: 'c1',
      invoiceNumber: 'INV-2',
      issueDate: '2026-10-01',
      dueDate: '2026-10-15',
      status: 'Overdue',
      subtotal: 20000,
      discountAmount: 0,
      gstAmount: 3600,
      totalAmount: 23600,
      paidAmount: 0,
      notes: null,
      paymentLinkToken: null,
      isSimulated: false,
      createdAt: '2026-10-01',
    },
  ];
  const payments: Payment[] = [
    {
      id: 'p1',
      businessId: 'b1',
      invoiceId: 'i1',
      amount: 11800,
      paymentDate: '2026-10-08', // 23 days late
      method: 'UPI',
      referenceId: null,
      notes: null,
      isSimulated: false,
      createdAt: '2026-10-08',
    },
  ];

  const summaries = computeCustomerRiskSummaries(customers, invoices, payments, '2026-11-17');
  assert.equal(summaries[0].riskLevel, 'High');
  assert.equal(summaries[0].outstandingBalance, 23600);
  assert.match(summaries[0].explanation, /more than 15 days/i);
});

test('buildCashFlowForecast detects upcoming cash shortage before delayed customer payments arrive', () => {
  const customers: Customer[] = [
    {
      id: 'c1',
      businessId: 'b1',
      name: 'Anita',
      businessName: 'Anita Traders',
      email: 'a@example.com',
      phone: '9999999999',
      gstin: null,
      paymentTermsDays: 15,
      isSimulated: false,
      createdAt: '2026-01-01',
    },
  ];
  const invoices: Invoice[] = [
    {
      id: 'i1',
      businessId: 'b1',
      customerId: 'c1',
      invoiceNumber: 'INV-101',
      issueDate: '2026-11-01',
      dueDate: '2026-11-28',
      status: 'Sent',
      subtotal: 100000,
      discountAmount: 0,
      gstAmount: 0,
      totalAmount: 100000,
      paidAmount: 0,
      notes: null,
      paymentLinkToken: null,
      isSimulated: false,
      createdAt: '2026-11-01',
    },
  ];
  const recurringExpenses: RecurringExpense[] = [
    {
      id: 'r1',
      businessId: 'b1',
      title: 'Supplier Bulk Stock Payout',
      vendorName: 'Kaveri Mills',
      category: 'Inventory',
      amount: 75000,
      frequency: 'Monthly',
      nextDueDate: '2026-11-22',
      active: true,
      isSimulated: false,
      createdAt: '2026-01-01',
    },
  ];

  const forecast = buildCashFlowForecast({
    horizonDays: 30,
    referenceDateISO: '2026-11-17',
    currentCashBalance: 30000,
    typicalMonthlyExpenses: 50000,
    invoices,
    expenses: [],
    recurringExpenses,
    customerRisks: computeCustomerRiskSummaries(customers, invoices, [], '2026-11-17'),
  });

  assert.ok(forecast.shortageAlerts.length >= 1);
  assert.equal(forecast.shortageAlerts[0].shortageAmount, 45000);
  assert.equal(forecast.projectedClosingBalance, 55000);
});

test('computeCurrentCashBalance & computeDashboardMetrics aggregate accurately', () => {
  const expenses: Expense[] = [
    {
      id: 'e1',
      businessId: 'b1',
      title: 'Office Rent',
      vendorName: 'DLF Commercial',
      category: 'Rent',
      amount: 20000,
      expenseDate: '2026-11-05',
      dueDate: '2026-11-05',
      status: 'Paid',
      receiptName: null,
      notes: null,
      isSimulated: false,
      createdAt: '2026-11-05',
    },
  ];
  const payments: Payment[] = [
    {
      id: 'p1',
      businessId: 'b1',
      invoiceId: 'i1',
      amount: 50000,
      paymentDate: '2026-11-06',
      method: 'NEFT/RTGS',
      referenceId: 'UTR123',
      notes: null,
      isSimulated: false,
      createdAt: '2026-11-06',
    },
  ];
  assert.equal(computeCurrentCashBalance(100000, payments, expenses), 130000);

  const metrics = computeDashboardMetrics({
    referenceDateISO: '2026-11-17',
    openingCashBalance: 100000,
    typicalMonthlyExpenses: 40000,
    customers: [],
    invoices: [],
    payments,
    expenses,
    recurringExpenses: [],
  });
  assert.equal(metrics.availableCashBalance, 130000);
  assert.equal(metrics.monthlyCashFlowSeries.length, 6);
});
