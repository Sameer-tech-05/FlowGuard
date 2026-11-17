import type {
  CashFlowDayPoint,
  CashFlowForecastResult,
  CashFlowShortageAlert,
  Customer,
  CustomerRiskSummary,
  DashboardMetrics,
  Expense,
  Invoice,
  InvoiceItem,
  InvoiceStatus,
  Payment,
  PaymentRiskLevel,
  RecurringExpense,
  ReminderCategory,
} from './types';

/**
 * Converts a rupee float into integer paise for exact financial arithmetic.
 */
export function toPaise(amount: number): number {
  if (!Number.isFinite(amount)) return 0;
  return Math.round(amount * 100);
}

/**
 * Converts integer paise back to a 2-decimal rupee number.
 */
export function fromPaise(paise: number): number {
  return Math.round(paise) / 100;
}

/**
 * Formats a numeric rupee amount in standard Indian numbering (₹1,24,500.00).
 */
export function formatINR(amount: number, compact = false): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  if (compact) {
    const abs = Math.abs(safe);
    const sign = safe < 0 ? '-' : '';
    if (abs >= 10000000) {
      return `${sign}₹${(abs / 10000000).toFixed(2)} Cr`;
    }
    if (abs >= 100000) {
      return `${sign}₹${(abs / 100000).toFixed(2)} L`;
    }
  }
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(safe);
}

/**
 * Computes line-item and invoice totals in exact paise arithmetic.
 */
export function calculateInvoiceTotals(
  items: Array<Pick<InvoiceItem, 'quantity' | 'unitPrice' | 'gstRate'>>,
  discountAmount = 0
): {
  subtotal: number;
  discountApplied: number;
  gstAmount: number;
  totalAmount: number;
  computedItems: Array<{ lineTotal: number; gstLine: number }>;
} {
  let subtotalPaise = 0;
  let gstPaise = 0;
  const computedItems: Array<{ lineTotal: number; gstLine: number }> = [];

  for (const item of items) {
    const qty = Math.max(0, Number(item.quantity) || 0);
    const unitPaise = toPaise(Math.max(0, Number(item.unitPrice) || 0));
    const linePaise = Math.round(qty * unitPaise);
    const rate = Math.max(0, Number(item.gstRate) || 0);
    const itemGstPaise = Math.round((linePaise * rate) / 100);

    subtotalPaise += linePaise;
    gstPaise += itemGstPaise;
    computedItems.push({
      lineTotal: fromPaise(linePaise),
      gstLine: fromPaise(itemGstPaise),
    });
  }

  const rawDiscountPaise = toPaise(Math.max(0, Number(discountAmount) || 0));
  const discountPaise = Math.min(rawDiscountPaise, subtotalPaise);

  // Proportionally reduce GST if a pre-tax discount is applied
  const discountFactor =
    subtotalPaise > 0 ? (subtotalPaise - discountPaise) / subtotalPaise : 1;
  const adjustedGstPaise = Math.round(gstPaise * discountFactor);
  const totalPaise = subtotalPaise - discountPaise + adjustedGstPaise;

  return {
    subtotal: fromPaise(subtotalPaise),
    discountApplied: fromPaise(discountPaise),
    gstAmount: fromPaise(adjustedGstPaise),
    totalAmount: fromPaise(totalPaise),
    computedItems,
  };
}

/**
 * Days difference (b - a) in calendar days using ISO YYYY-MM-DD strings.
 */
export function diffDaysISO(fromDateISO: string, toDateISO: string): number {
  const from = new Date(fromDateISO.slice(0, 10) + 'T00:00:00Z');
  const to = new Date(toDateISO.slice(0, 10) + 'T00:00:00Z');
  return Math.round((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));
}

export function addDaysISO(dateISO: string, days: number): string {
  const d = new Date(dateISO.slice(0, 10) + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Derives effective invoice status given payments and current reference date.
 */
export function resolveInvoiceStatus(
  invoice: Pick<Invoice, 'status' | 'totalAmount' | 'paidAmount' | 'dueDate'>,
  referenceDateISO: string
): InvoiceStatus {
  if (invoice.status === 'Cancelled' || invoice.status === 'Draft') {
    return invoice.status;
  }
  const totalPaise = toPaise(invoice.totalAmount);
  const paidPaise = toPaise(invoice.paidAmount);

  if (paidPaise >= totalPaise && totalPaise > 0) {
    return 'Paid';
  }
  const overdueDays = diffDaysISO(invoice.dueDate, referenceDateISO);
  if (overdueDays > 0) {
    return 'Overdue';
  }
  if (paidPaise > 0) {
    return 'Partially Paid';
  }
  return 'Sent';
}

export function getOverdueDays(dueDateISO: string, referenceDateISO: string): number {
  return Math.max(0, diffDaysISO(dueDateISO, referenceDateISO));
}

export function recommendReminderCategory(overdueDays: number): ReminderCategory {
  if (overdueDays <= 0) {
    return overdueDays === 0 ? 'Payment due today' : 'Friendly reminder';
  }
  if (overdueDays <= 5) return '3 days overdue';
  if (overdueDays <= 12) return '7 days overdue';
  if (overdueDays <= 25) return '15 days overdue';
  return 'Final professional reminder';
}

/**
 * Builds an explainable customer payment risk indicator from historical invoices and payments.
 */
export function computeCustomerRiskSummaries(
  customers: Customer[],
  invoices: Invoice[],
  payments: Payment[],
  referenceDateISO: string
): CustomerRiskSummary[] {
  const paymentsByInvoice = new Map<string, Payment[]>();
  for (const p of payments) {
    const list = paymentsByInvoice.get(p.invoiceId) ?? [];
    list.push(p);
    paymentsByInvoice.set(p.invoiceId, list);
  }

  return customers.map((customer) => {
    const custInvoices = invoices.filter(
      (inv) =>
        inv.customerId === customer.id &&
        inv.status !== 'Draft' &&
        inv.status !== 'Cancelled'
    );

    let totalInvoicedPaise = 0;
    let totalPaidPaise = 0;
    let overdueInvoiceCount = 0;
    const delaySamples: number[] = [];

    const sortedRecent = [...custInvoices]
      .sort((a, b) => b.issueDate.localeCompare(a.issueDate))
      .slice(0, 5);

    let lateRecentCount = 0;
    let severeLateRecentCount = 0;

    for (const inv of custInvoices) {
      totalInvoicedPaise += toPaise(inv.totalAmount);
      totalPaidPaise += toPaise(inv.paidAmount);

      const effectiveStatus = resolveInvoiceStatus(inv, referenceDateISO);
      if (effectiveStatus === 'Overdue') {
        overdueInvoiceCount += 1;
      }

      const invPayments = paymentsByInvoice.get(inv.id) ?? [];
      if (invPayments.length > 0 && effectiveStatus === 'Paid') {
        const latestPayDate = invPayments
          .map((p) => p.paymentDate)
          .sort()
          .slice(-1)[0];
        const delay = Math.max(0, diffDaysISO(inv.dueDate, latestPayDate));
        delaySamples.push(delay);
      } else if (effectiveStatus === 'Overdue') {
        const delay = getOverdueDays(inv.dueDate, referenceDateISO);
        delaySamples.push(delay);
      } else if (effectiveStatus === 'Paid') {
        delaySamples.push(0);
      }
    }

    for (const inv of sortedRecent) {
      const effectiveStatus = resolveInvoiceStatus(inv, referenceDateISO);
      const invPayments = paymentsByInvoice.get(inv.id) ?? [];
      let delay = 0;
      if (effectiveStatus === 'Overdue') {
        delay = getOverdueDays(inv.dueDate, referenceDateISO);
      } else if (invPayments.length > 0) {
        const latestPayDate = invPayments
          .map((p) => p.paymentDate)
          .sort()
          .slice(-1)[0];
        delay = Math.max(0, diffDaysISO(inv.dueDate, latestPayDate));
      }
      if (delay > 5) lateRecentCount += 1;
      if (delay > 15) severeLateRecentCount += 1;
    }

    const avgDelay =
      delaySamples.length > 0
        ? Math.round(delaySamples.reduce((a, b) => a + b, 0) / delaySamples.length)
        : 0;

    let riskLevel: PaymentRiskLevel = 'Low';
    let explanation = 'Consistent on-time payments across recent invoices.';

    if (custInvoices.length === 0) {
      riskLevel = 'Low';
      explanation = 'New customer with no invoice history yet.';
    } else if (
      severeLateRecentCount >= 2 ||
      overdueInvoiceCount >= 2 ||
      avgDelay > 15
    ) {
      riskLevel = 'High';
      explanation = `High payment-delay risk: ${severeLateRecentCount} of the last ${sortedRecent.length} invoices were paid or remain unpaid more than 15 days past due (avg delay ${avgDelay} days).`;
    } else if (lateRecentCount >= 2 || overdueInvoiceCount === 1 || avgDelay >= 6) {
      riskLevel = 'Medium';
      explanation = `Moderate payment-delay risk: ${lateRecentCount} of the last ${sortedRecent.length} invoices experienced delays (avg delay ${avgDelay} days).`;
    } else {
      riskLevel = 'Low';
      explanation = `Low payment-delay risk: average settlement delay is ${avgDelay} days across ${custInvoices.length} invoices.`;
    }

    const outstandingPaise = Math.max(0, totalInvoicedPaise - totalPaidPaise);

    return {
      customerId: customer.id,
      name: customer.name,
      businessName: customer.businessName,
      email: customer.email,
      phone: customer.phone,
      totalInvoiced: fromPaise(totalInvoicedPaise),
      totalPaid: fromPaise(totalPaidPaise),
      outstandingBalance: fromPaise(outstandingPaise),
      averagePaymentDelayDays: avgDelay,
      overdueInvoiceCount,
      lateInvoiceCount: lateRecentCount,
      recentInvoiceCount: sortedRecent.length,
      riskLevel,
      explanation,
    };
  });
}

/**
 * Computes current cash balance from opening balance + recorded payments - paid expenses.
 */
export function computeCurrentCashBalance(
  openingCashBalance: number,
  payments: Payment[],
  expenses: Expense[]
): number {
  let balancePaise = toPaise(openingCashBalance);
  for (const p of payments) {
    balancePaise += toPaise(p.amount);
  }
  for (const exp of expenses) {
    if (exp.status === 'Paid') {
      balancePaise -= toPaise(exp.amount);
    }
  }
  return fromPaise(balancePaise);
}

/**
 * Deterministic 7-day, 30-day, and 90-day cash flow forecasting engine.
 * Never fabricates numbers: every rupee comes from open invoices, scheduled/recurring expenses,
 * and historical monthly baseline when horizon extends beyond committed invoices.
 */
export function buildCashFlowForecast(params: {
  horizonDays: 7 | 30 | 90;
  referenceDateISO: string;
  currentCashBalance: number;
  typicalMonthlyExpenses: number;
  invoices: Invoice[];
  expenses: Expense[];
  recurringExpenses: RecurringExpense[];
  customerRisks: CustomerRiskSummary[];
}): CashFlowForecastResult {
  const {
    horizonDays,
    referenceDateISO,
    currentCashBalance,
    typicalMonthlyExpenses,
    invoices,
    expenses,
    recurringExpenses,
    customerRisks,
  } = params;

  const riskByCustomer = new Map(customerRisks.map((r) => [r.customerId, r]));
  const inflowByDate = new Map<string, { paise: number; labels: string[] }>();
  const outflowByDate = new Map<string, { paise: number; labels: string[] }>();

  const addInflow = (dateISO: string, paise: number, label: string) => {
    const entry = inflowByDate.get(dateISO) ?? { paise: 0, labels: [] };
    entry.paise += paise;
    entry.labels.push(label);
    inflowByDate.set(dateISO, entry);
  };

  const addOutflow = (dateISO: string, paise: number, label: string) => {
    const entry = outflowByDate.get(dateISO) ?? { paise: 0, labels: [] };
    entry.paise += paise;
    entry.labels.push(label);
    outflowByDate.set(dateISO, entry);
  };

  const endDateISO = addDaysISO(referenceDateISO, horizonDays);

  // 1. Expected inflows from unpaid Sent / Partially Paid / Overdue invoices
  let openInvoiceCount = 0;
  for (const inv of invoices) {
    if (inv.status === 'Draft' || inv.status === 'Cancelled' || inv.status === 'Paid') {
      continue;
    }
    const remainingPaise = Math.max(0, toPaise(inv.totalAmount) - toPaise(inv.paidAmount));
    if (remainingPaise <= 0) continue;

    openInvoiceCount += 1;
    const custRisk = riskByCustomer.get(inv.customerId);
    const delayShift = custRisk ? Math.min(21, Math.max(0, custRisk.averagePaymentDelayDays)) : 4;

    // If already overdue, assume expected collection within 5 + partial risk shift days
    const baseExpectedDate =
      diffDaysISO(referenceDateISO, inv.dueDate) < 0
        ? addDaysISO(referenceDateISO, Math.min(14, 4 + Math.round(delayShift / 2)))
        : addDaysISO(inv.dueDate, Math.round(delayShift * 0.6));

    if (baseExpectedDate >= referenceDateISO && baseExpectedDate <= endDateISO) {
      addInflow(
        baseExpectedDate,
        remainingPaise,
        `Collection: ${inv.invoiceNumber} (${inv.customerName ?? 'Customer'})`
      );
    }
  }

  // 2. Planned/Pending one-off expenses
  for (const exp of expenses) {
    if (exp.status === 'Paid') continue;
    const expDate = exp.dueDate || exp.expenseDate;
    if (expDate >= referenceDateISO && expDate <= endDateISO) {
      addOutflow(expDate, toPaise(exp.amount), `Expense: ${exp.title}`);
    }
  }

  // 3. Recurring expenses projected forward across the horizon
  let recurringAdded = 0;
  for (const rec of recurringExpenses) {
    if (!rec.active) continue;
    let cursor = rec.nextDueDate;
    const stepDays =
      rec.frequency === 'Weekly' ? 7 : rec.frequency === 'Monthly' ? 30 : 90;

    // Advance cursor if it's in the past
    let guard = 0;
    while (cursor < referenceDateISO && guard < 24) {
      cursor = addDaysISO(cursor, stepDays);
      guard += 1;
    }

    while (cursor <= endDateISO && guard < 48) {
      addOutflow(cursor, toPaise(rec.amount), `Recurring: ${rec.title}`);
      recurringAdded += 1;
      cursor = addDaysISO(cursor, stepDays);
      guard += 1;
    }
  }

  // 4. If business has no recurring expenses defined, allocate typicalMonthlyExpenses on day 15/30/60/90 as transparent estimate
  let usedBaselineEstimate = false;
  if (recurringAdded === 0 && typicalMonthlyExpenses > 0) {
    usedBaselineEstimate = true;
    const baselinePaise = toPaise(typicalMonthlyExpenses);
    if (horizonDays >= 7) {
      addOutflow(
        addDaysISO(referenceDateISO, 7),
        Math.round(baselinePaise * 0.25),
        'Estimated weekly operating overhead'
      );
    }
    if (horizonDays >= 30) {
      addOutflow(
        addDaysISO(referenceDateISO, 25),
        Math.round(baselinePaise * 0.75),
        'Estimated monthly operating expenses'
      );
    }
    if (horizonDays === 90) {
      addOutflow(addDaysISO(referenceDateISO, 55), baselinePaise, 'Estimated month-2 operating expenses');
      addOutflow(addDaysISO(referenceDateISO, 85), baselinePaise, 'Estimated month-3 operating expenses');
    }
  }

  const dailyPoints: CashFlowDayPoint[] = [];
  const shortageAlerts: CashFlowShortageAlert[] = [];
  let runningPaise = toPaise(currentCashBalance);
  let totalInflowPaise = 0;
  let totalOutflowPaise = 0;

  for (let i = 0; i <= horizonDays; i += 1) {
    const dateISO = addDaysISO(referenceDateISO, i);
    const inf = inflowByDate.get(dateISO);
    const out = outflowByDate.get(dateISO);

    const dayInPaise = inf?.paise ?? 0;
    const dayOutPaise = out?.paise ?? 0;

    totalInflowPaise += dayInPaise;
    totalOutflowPaise += dayOutPaise;
    runningPaise += dayInPaise - dayOutPaise;

    const events = [...(inf?.labels ?? []), ...(out?.labels ?? [])];

    if (runningPaise < 0) {
      const shortageAmount = fromPaise(Math.abs(runningPaise));
      const causeLabel = out?.labels[0] ?? 'scheduled supplier and operating payouts';
      shortageAlerts.push({
        date: dateISO,
        projectedBalance: fromPaise(runningPaise),
        shortageAmount,
        reason: `Projected cash shortage of ${formatINR(shortageAmount)} on ${dateISO} triggered around ${causeLabel} before delayed receivables settle.`,
      });
    }

    dailyPoints.push({
      date: dateISO,
      label: dateISO.slice(5),
      expectedInflow: fromPaise(dayInPaise),
      expectedOutflow: fromPaise(dayOutPaise),
      netFlow: fromPaise(dayInPaise - dayOutPaise),
      projectedBalance: fromPaise(runningPaise),
      events,
    });
  }

  const confidence: CashFlowForecastResult['confidence'] =
    openInvoiceCount >= 5 && !usedBaselineEstimate
      ? 'High'
      : openInvoiceCount >= 2
      ? 'Medium'
      : 'Estimate';

  const assumptions: string[] = [
    `Opening cash balance: ${formatINR(currentCashBalance)} calculated from opening capital + recorded collections - paid expenses.`,
    `Receivables timing adjusted per customer historical payment delay across ${openInvoiceCount} open invoices.`,
    usedBaselineEstimate
      ? `No recurring expense rules found — using typical monthly expenses (${formatINR(typicalMonthlyExpenses)}) as an operating estimate.`
      : `Outflows modeled from ${recurringAdded} scheduled recurring payouts and pending supplier bills.`,
  ];

  // Collapse consecutive days of shortage alerts into key inflection points (max 3)
  const keyAlerts: CashFlowShortageAlert[] = [];
  for (const alert of shortageAlerts) {
    if (
      keyAlerts.length === 0 ||
      diffDaysISO(keyAlerts[keyAlerts.length - 1].date, alert.date) >= 5
    ) {
      keyAlerts.push(alert);
    }
  }

  return {
    horizonDays,
    openingBalance: currentCashBalance,
    totalExpectedInflows: fromPaise(totalInflowPaise),
    totalExpectedOutflows: fromPaise(totalOutflowPaise),
    projectedClosingBalance: fromPaise(runningPaise),
    confidence,
    assumptions,
    shortageAlerts: keyAlerts.slice(0, 3),
    dailyPoints,
  };
}

/**
 * Computes all real-time Dashboard KPIs and chart series strictly from stored business data.
 */
export function computeDashboardMetrics(params: {
  referenceDateISO: string;
  openingCashBalance: number;
  typicalMonthlyExpenses: number;
  customers: Customer[];
  invoices: Invoice[];
  payments: Payment[];
  expenses: Expense[];
  recurringExpenses: RecurringExpense[];
}): DashboardMetrics {
  const {
    referenceDateISO,
    openingCashBalance,
    typicalMonthlyExpenses,
    customers,
    invoices,
    payments,
    expenses,
    recurringExpenses,
  } = params;

  const availableCashBalance = computeCurrentCashBalance(
    openingCashBalance,
    payments,
    expenses
  );

  let outstandingPaise = 0;
  let overduePaise = 0;
  let overdueCount = 0;
  let expectedThisMonthPaise = 0;

  const currentMonthPrefix = referenceDateISO.slice(0, 7);

  const buckets = {
    current: { amountPaise: 0, count: 0 },
    d1_15: { amountPaise: 0, count: 0 },
    d16_30: { amountPaise: 0, count: 0 },
    d31_60: { amountPaise: 0, count: 0 },
    d60Plus: { amountPaise: 0, count: 0 },
  };

  for (const inv of invoices) {
    if (inv.status === 'Draft' || inv.status === 'Cancelled') continue;
    const status = resolveInvoiceStatus(inv, referenceDateISO);
    const remainingPaise = Math.max(0, toPaise(inv.totalAmount) - toPaise(inv.paidAmount));

    if (status === 'Paid' || remainingPaise === 0) continue;

    outstandingPaise += remainingPaise;

    if (inv.dueDate.startsWith(currentMonthPrefix) || status === 'Overdue') {
      expectedThisMonthPaise += remainingPaise;
    }

    const overdueDays = getOverdueDays(inv.dueDate, referenceDateISO);
    if (overdueDays > 0) {
      overduePaise += remainingPaise;
      overdueCount += 1;
      if (overdueDays <= 15) {
        buckets.d1_15.amountPaise += remainingPaise;
        buckets.d1_15.count += 1;
      } else if (overdueDays <= 30) {
        buckets.d16_30.amountPaise += remainingPaise;
        buckets.d16_30.count += 1;
      } else if (overdueDays <= 60) {
        buckets.d31_60.amountPaise += remainingPaise;
        buckets.d31_60.count += 1;
      } else {
        buckets.d60Plus.amountPaise += remainingPaise;
        buckets.d60Plus.count += 1;
      }
    } else {
      buckets.current.amountPaise += remainingPaise;
      buckets.current.count += 1;
    }
  }

  const customerRisks = computeCustomerRiskSummaries(
    customers,
    invoices,
    payments,
    referenceDateISO
  );

  const forecast30 = buildCashFlowForecast({
    horizonDays: 30,
    referenceDateISO,
    currentCashBalance: availableCashBalance,
    typicalMonthlyExpenses,
    invoices,
    expenses,
    recurringExpenses,
    customerRisks,
  });

  // Build 6-month series ending at referenceDateISO month
  const refDate = new Date(referenceDateISO.slice(0, 10) + 'T00:00:00Z');
  const monthKeys: string[] = [];
  for (let m = 5; m >= 0; m -= 1) {
    const d = new Date(Date.UTC(refDate.getUTCFullYear(), refDate.getUTCMonth() - m, 1));
    monthKeys.push(d.toISOString().slice(0, 7));
  }

  const monthMap = new Map<
    string,
    { inflowPaise: number; outflowPaise: number; revenuePaise: number }
  >();
  for (const k of monthKeys) {
    monthMap.set(k, { inflowPaise: 0, outflowPaise: 0, revenuePaise: 0 });
  }

  for (const p of payments) {
    const m = p.paymentDate.slice(0, 7);
    const entry = monthMap.get(m);
    if (entry) entry.inflowPaise += toPaise(p.amount);
  }
  for (const exp of expenses) {
    if (exp.status !== 'Paid') continue;
    const m = exp.expenseDate.slice(0, 7);
    const entry = monthMap.get(m);
    if (entry) entry.outflowPaise += toPaise(exp.amount);
  }
  for (const inv of invoices) {
    if (inv.status === 'Draft' || inv.status === 'Cancelled') continue;
    const m = inv.issueDate.slice(0, 7);
    const entry = monthMap.get(m);
    if (entry) entry.revenuePaise += toPaise(inv.totalAmount);
  }

  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthlyCashFlowSeries = monthKeys.map((k) => {
    const [yr, mo] = k.split('-');
    const label = `${monthNames[Number(mo) - 1]} '${yr.slice(2)}`;
    const entry = monthMap.get(k)!;
    return {
      month: label,
      inflow: fromPaise(entry.inflowPaise),
      outflow: fromPaise(entry.outflowPaise),
      revenue: fromPaise(entry.revenuePaise),
    };
  });

  const customerPerformance = [...customerRisks]
    .sort((a, b) => b.totalInvoiced - a.totalInvoiced)
    .slice(0, 8)
    .map((c) => ({
      customerName: c.businessName || c.name,
      paid: c.totalPaid,
      outstanding: c.outstandingBalance,
      riskLevel: c.riskLevel,
    }));

  return {
    availableCashBalance,
    totalOutstandingReceivables: fromPaise(outstandingPaise),
    totalOverduePayments: fromPaise(overduePaise),
    overdueCount,
    expectedCollectionsThisMonth: fromPaise(expectedThisMonthPaise),
    upcomingExpenses30d: forecast30.totalExpectedOutflows,
    projectedCash30d: forecast30.projectedClosingBalance,
    monthlyCashFlowSeries,
    agingBuckets: [
      { bucket: 'Current', amount: fromPaise(buckets.current.amountPaise), count: buckets.current.count },
      { bucket: '1-15 Days', amount: fromPaise(buckets.d1_15.amountPaise), count: buckets.d1_15.count },
      { bucket: '16-30 Days', amount: fromPaise(buckets.d16_30.amountPaise), count: buckets.d16_30.count },
      { bucket: '31-60 Days', amount: fromPaise(buckets.d31_60.amountPaise), count: buckets.d31_60.count },
      { bucket: '60+ Days', amount: fromPaise(buckets.d60Plus.amountPaise), count: buckets.d60Plus.count },
    ],
    customerPerformance,
  };
}
