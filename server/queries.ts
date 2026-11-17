import { db } from './db';
import {
  calculateInvoiceTotals,
  computeCurrentCashBalance,
  computeCustomerRiskSummaries,
  computeDashboardMetrics,
  buildCashFlowForecast,
  formatINR,
  getOverdueDays,
  resolveInvoiceStatus,
} from '../src/lib/finance';
import type {
  Business,
  BusinessSubscription,
  Customer,
  Expense,
  Invoice,
  InvoiceItem,
  Payment,
  RecurringExpense,
  ReminderCategory,
  ReminderLog,
  SubscriptionPlan,
  SubscriptionPlanTier,
  SupportedLanguage,
} from '../src/lib/types';

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function getBusinessById(businessId: string): Business | null {
  const row = db
    .prepare('SELECT * FROM businesses WHERE id = ?')
    .get(businessId) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    id: String(row.id),
    ownerId: String(row.owner_id),
    name: String(row.name),
    category: String(row.category),
    email: String(row.email),
    phone: String(row.phone),
    location: String(row.location),
    currency: String(row.currency),
    gstin: row.gstin ? String(row.gstin) : null,
    openingCashBalance: Number(row.opening_cash_balance),
    typicalMonthlyExpenses: Number(row.typical_monthly_expenses),
    isDemo: Boolean(row.is_demo),
    onboardingCompleted: Boolean(row.onboarding_completed),
    createdAt: String(row.created_at),
  };
}

export function getCustomersByBusiness(businessId: string): Customer[] {
  const rows = db
    .prepare('SELECT * FROM customers WHERE business_id = ? ORDER BY name ASC')
    .all(businessId) as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    id: String(r.id),
    businessId: String(r.business_id),
    name: String(r.name),
    businessName: String(r.business_name),
    email: String(r.email),
    phone: String(r.phone),
    gstin: r.gstin ? String(r.gstin) : null,
    paymentTermsDays: Number(r.payment_terms_days),
    isSimulated: Boolean(r.is_simulated),
    createdAt: String(r.created_at),
  }));
}

export function getInvoicesByBusiness(businessId: string): Invoice[] {
  const refDate = todayISO();
  const rows = db
    .prepare(`
      SELECT i.*, c.name as customer_name, c.business_name as customer_business_name,
             c.email as customer_email, c.phone as customer_phone
      FROM invoices i
      JOIN customers c ON c.id = i.customer_id
      WHERE i.business_id = ?
      ORDER BY i.issue_date DESC, i.invoice_number DESC
    `)
    .all(businessId) as Array<Record<string, unknown>>;

  const itemRows = db
    .prepare(`
      SELECT ii.*
      FROM invoice_items ii
      JOIN invoices i ON i.id = ii.invoice_id
      WHERE i.business_id = ?
    `)
    .all(businessId) as Array<Record<string, unknown>>;

  const itemsMap = new Map<string, InvoiceItem[]>();
  for (const r of itemRows) {
    const invId = String(r.invoice_id);
    const list = itemsMap.get(invId) ?? [];
    list.push({
      id: String(r.id),
      invoiceId: invId,
      description: String(r.description),
      hsnSac: r.hsn_sac ? String(r.hsn_sac) : undefined,
      quantity: Number(r.quantity),
      unitPrice: Number(r.unit_price),
      gstRate: Number(r.gst_rate),
      lineTotal: Number(r.line_total),
    });
    itemsMap.set(invId, list);
  }

  return rows.map((r) => {
    const base = {
      id: String(r.id),
      businessId: String(r.business_id),
      customerId: String(r.customer_id),
      customerName: String(r.customer_name),
      customerBusinessName: String(r.customer_business_name),
      customerEmail: String(r.customer_email),
      customerPhone: String(r.customer_phone),
      invoiceNumber: String(r.invoice_number),
      issueDate: String(r.issue_date),
      dueDate: String(r.due_date),
      status: String(r.status) as Invoice['status'],
      subtotal: Number(r.subtotal),
      discountAmount: Number(r.discount_amount),
      gstAmount: Number(r.gst_amount),
      totalAmount: Number(r.total_amount),
      paidAmount: Number(r.paid_amount),
      notes: r.notes ? String(r.notes) : null,
      paymentLinkToken: r.payment_link_token ? String(r.payment_link_token) : null,
      isSimulated: Boolean(r.is_simulated),
      items: itemsMap.get(String(r.id)) ?? [],
      createdAt: String(r.created_at),
    };
    base.status = resolveInvoiceStatus(base, refDate);
    return base;
  });
}

export function getPaymentsByBusiness(businessId: string): Payment[] {
  const rows = db
    .prepare(`
      SELECT p.*, i.invoice_number, c.name as customer_name
      FROM payments p
      JOIN invoices i ON i.id = p.invoice_id
      JOIN customers c ON c.id = i.customer_id
      WHERE p.business_id = ?
      ORDER BY p.payment_date DESC, p.created_at DESC
    `)
    .all(businessId) as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    id: String(r.id),
    businessId: String(r.business_id),
    invoiceId: String(r.invoice_id),
    invoiceNumber: String(r.invoice_number),
    customerName: String(r.customer_name),
    amount: Number(r.amount),
    paymentDate: String(r.payment_date),
    method: String(r.method) as Payment['method'],
    referenceId: r.reference_id ? String(r.reference_id) : null,
    notes: r.notes ? String(r.notes) : null,
    isSimulated: Boolean(r.is_simulated),
    createdAt: String(r.created_at),
  }));
}

export function getExpensesByBusiness(businessId: string): Expense[] {
  const rows = db
    .prepare('SELECT * FROM expenses WHERE business_id = ? ORDER BY expense_date DESC, created_at DESC')
    .all(businessId) as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    id: String(r.id),
    businessId: String(r.business_id),
    title: String(r.title),
    vendorName: String(r.vendor_name),
    category: String(r.category) as Expense['category'],
    amount: Number(r.amount),
    expenseDate: String(r.expense_date),
    dueDate: r.due_date ? String(r.due_date) : null,
    status: String(r.status) as Expense['status'],
    receiptName: r.receipt_name ? String(r.receipt_name) : null,
    notes: r.notes ? String(r.notes) : null,
    isSimulated: Boolean(r.is_simulated),
    createdAt: String(r.created_at),
  }));
}

export function getRecurringExpensesByBusiness(businessId: string): RecurringExpense[] {
  const rows = db
    .prepare('SELECT * FROM recurring_expenses WHERE business_id = ? ORDER BY next_due_date ASC')
    .all(businessId) as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    id: String(r.id),
    businessId: String(r.business_id),
    title: String(r.title),
    vendorName: String(r.vendor_name),
    category: String(r.category) as RecurringExpense['category'],
    amount: Number(r.amount),
    frequency: String(r.frequency) as RecurringExpense['frequency'],
    nextDueDate: String(r.next_due_date),
    active: Boolean(r.active),
    isSimulated: Boolean(r.is_simulated),
    createdAt: String(r.created_at),
  }));
}

export function getReminderLogsByBusiness(businessId: string): ReminderLog[] {
  const rows = db
    .prepare(`
      SELECT rl.*, i.invoice_number, c.name as customer_name
      FROM reminder_logs rl
      JOIN invoices i ON i.id = rl.invoice_id
      JOIN customers c ON c.id = rl.customer_id
      WHERE rl.business_id = ?
      ORDER BY rl.sent_at DESC
    `)
    .all(businessId) as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    id: String(r.id),
    businessId: String(r.business_id),
    invoiceId: String(r.invoice_id),
    customerId: String(r.customer_id),
    invoiceNumber: String(r.invoice_number),
    customerName: String(r.customer_name),
    category: String(r.category) as ReminderCategory,
    language: (String(r.language) === 'hi' ? 'hi' : String(r.language) === 'kn' ? 'kn' : 'en') as SupportedLanguage,
    channel: String(r.channel) as ReminderLog['channel'],
    deliveryStatus: String(r.delivery_status) as ReminderLog['deliveryStatus'],
    messageText: String(r.message_text),
    customerResponse: r.customer_response ? String(r.customer_response) : null,
    sentAt: String(r.sent_at),
  }));
}

export function getSubscriptionPlans(): SubscriptionPlan[] {
  const rows = db
    .prepare('SELECT * FROM subscription_plans ORDER BY monthly_price_inr ASC')
    .all() as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r.id) as SubscriptionPlanTier,
    name: String(r.name),
    tagline: String(r.tagline),
    monthlyPriceInr: Number(r.monthly_price_inr),
    invoiceLimitPerMonth: Number(r.invoice_limit_per_month),
    features: JSON.parse(String(r.features_json)) as string[],
    aiEnabled: Boolean(r.ai_enabled),
    whatsappEnabled: Boolean(r.whatsapp_enabled),
    teamSeats: Number(r.team_seats),
  }));
}

export function getBusinessSubscription(businessId: string): {
  subscription: BusinessSubscription;
  plan: SubscriptionPlan;
} {
  const plans = getSubscriptionPlans();
  const row = db
    .prepare('SELECT * FROM subscriptions WHERE business_id = ? ORDER BY created_at DESC LIMIT 1')
    .get(businessId) as Record<string, unknown> | undefined;

  if (!row) {
    const freePlan = plans.find((p) => p.id === 'free') ?? plans[0];
    return {
      subscription: {
        id: 'default',
        businessId,
        planId: freePlan.id,
        status: 'active',
        mode: 'test',
        currentPeriodStart: new Date().toISOString(),
        currentPeriodEnd: new Date(Date.now() + 30 * 86400000).toISOString(),
        razorpaySubscriptionId: null,
      },
      plan: freePlan,
    };
  }

  const plan = plans.find((p) => p.id === String(row.plan_id)) ?? plans[0];
  return {
    subscription: {
      id: String(row.id),
      businessId: String(row.business_id),
      planId: String(row.plan_id) as SubscriptionPlanTier,
      status: String(row.status) as BusinessSubscription['status'],
      mode: String(row.mode) as BusinessSubscription['mode'],
      currentPeriodStart: String(row.current_period_start),
      currentPeriodEnd: String(row.current_period_end),
      razorpaySubscriptionId: row.razorpay_subscription_id ? String(row.razorpay_subscription_id) : null,
    },
    plan,
  };
}

export function getBusinessFullContext(businessId: string) {
  const business = getBusinessById(businessId);
  if (!business) return null;

  const refDate = todayISO();
  const customers = getCustomersByBusiness(businessId);
  const invoices = getInvoicesByBusiness(businessId);
  const payments = getPaymentsByBusiness(businessId);
  const expenses = getExpensesByBusiness(businessId);
  const recurringExpenses = getRecurringExpensesByBusiness(businessId);
  const customerRisks = computeCustomerRiskSummaries(customers, invoices, payments, refDate);
  const dashboard = computeDashboardMetrics({
    referenceDateISO: refDate,
    openingCashBalance: business.openingCashBalance,
    typicalMonthlyExpenses: business.typicalMonthlyExpenses,
    customers,
    invoices,
    payments,
    expenses,
    recurringExpenses,
  });
  const forecast30 = buildCashFlowForecast({
    horizonDays: 30,
    referenceDateISO: refDate,
    currentCashBalance: dashboard.availableCashBalance,
    typicalMonthlyExpenses: business.typicalMonthlyExpenses,
    invoices,
    expenses,
    recurringExpenses,
    customerRisks,
  });

  const overdueInvoices = invoices
    .filter((i) => i.status === 'Overdue')
    .map((i) => ({
      invoiceId: i.id,
      invoiceNumber: i.invoiceNumber,
      customerName: i.customerName ?? 'Customer',
      customerBusiness: i.customerBusinessName ?? '',
      balance: Math.max(0, Number((i.totalAmount - i.paidAmount).toFixed(2))),
      dueDate: i.dueDate,
      overdueDays: getOverdueDays(i.dueDate, refDate),
    }))
    .sort((a, b) => b.overdueDays - a.overdueDays);

  return {
    business,
    refDate,
    customers,
    invoices,
    payments,
    expenses,
    recurringExpenses,
    customerRisks,
    dashboard,
    forecast30,
    overdueInvoices,
    currentCashBalance: computeCurrentCashBalance(
      business.openingCashBalance,
      payments,
      expenses
    ),
  };
}

export function buildStandardReminderTemplate(params: {
  businessName: string;
  invoice: Invoice;
  overdueDays: number;
  outstandingAmount: number;
  category: ReminderCategory;
  language: SupportedLanguage;
}): { subject: string; message: string; strategyNote: string } {
  const { businessName, invoice, overdueDays, outstandingAmount, category, language } = params;
  const custName = invoice.customerName || 'Sir/Madam';
  const amt = formatINR(outstandingAmount);

  if (language === 'hi') {
    const bodyByStage: Record<ReminderCategory, string> = {
      'Friendly reminder': `नमस्ते ${custName} जी, यह ${businessName} की ओर से एक विनम्र अनुस्मारक है कि इनवॉइस ${invoice.invoiceNumber} (${amt}) की देय तिथि ${invoice.dueDate} है। कृपया समय पर भुगतान की पुष्टि करें। धन्यवाद।`,
      'Payment due today': `नमस्ते ${custName} जी, आपके इनवॉइस ${invoice.invoiceNumber} की राशि ${amt} आज (${invoice.dueDate}) देय है। कृपया भुगतान करने के बाद UTR नंबर साझा करें। धन्यवाद — ${businessName}।`,
      '3 days overdue': `नमस्ते ${custName} जी, इनवॉइस ${invoice.invoiceNumber} के ${amt} का भुगतान ${overdueDays} दिन से बकाया है (देय तिथि ${invoice.dueDate})। कृपया बताएं कि हम भुगतान कब तक अपेक्षित कर सकते हैं। धन्यवाद — ${businessName}।`,
      '7 days overdue': `नमस्ते ${custName} जी, इनवॉइस ${invoice.invoiceNumber} (${amt}) अब ${overdueDays} दिन अतिदेय है। हमारी कार्यशील पूंजी योजना के लिए कृपया आज भुगतान तिथि या आंशिक भुगतान की जानकारी साझा करें। — ${businessName}`,
      '15 days overdue': `नमस्ते ${custName} जी, इनवॉइस ${invoice.invoiceNumber} के बकाया ${amt} को ${overdueDays} दिन पूरे हो चुके हैं। अनुरोध है कि कृपया इस सप्ताह प्राथमिकता से भुगतान निपटाएं और UTR साझा करें। — ${businessName}`,
      'Final professional reminder': `नमस्ते ${custName} जी, ${businessName} की ओर से अंतिम विनम्र अनुरोध है कि ${overdueDays} दिनों से लंबित इनवॉइस ${invoice.invoiceNumber} (${amt}) का शीघ्र भुगतान करें ताकि आगे की आपूर्ति सुचारू रूप से जारी रह सके। कृपया आज ही कॉल या संदेश द्वारा समय बताएं।`,
    };
    return {
      subject: `भुगतान अनुस्मारक: इनवॉइस ${invoice.invoiceNumber} (${amt})`,
      message: bodyByStage[category],
      strategyNote: `Standard Hindi ${category.toLowerCase()} template based on ${overdueDays} overdue days.`,
    };
  }

  if (language === 'kn') {
    const bodyByStageKn: Record<ReminderCategory, string> = {
      'Friendly reminder': `ನಮಸ್ಕಾರ ${custName} ಅವರೇ, ${businessName} ವತಿಯಿಂದ ಇದು ಒಂದು ಸೌಹಾರ್ದ ನೆನಪಿಸುವಿಕೆ: ಇನ್‌ವಾಯ್ಸ್ ${invoice.invoiceNumber} (${amt}) ಪಾವತಿಗೆ ಕೊನೆಯ ದಿನಾಂಕ ${invoice.dueDate} ಆಗಿದೆ. ದಯವಿಟ್ಟು ಸಮಯಕ್ಕೆ ಸರಿಯಾಗಿ ಪಾವತಿ ದೃಢೀಕರಿಸಿ. ಧನ್ಯವಾದಗಳು.`,
      'Payment due today': `ನಮಸ್ಕಾರ ${custName} ಅವರೇ, ನಿಮ್ಮ ಇನ್‌ವಾಯ್ಸ್ ${invoice.invoiceNumber} ಮೊತ್ತ ${amt} ಇಂದು (${invoice.dueDate}) ಪಾವತಿಗೆ ಬಾಕಿ ಇದೆ. ಪಾವತಿ ಮಾಡಿದ ನಂತರ ದಯವಿಟ್ಟು UTR ಸಂಖ್ಯೆಯನ್ನು ಹಂಚಿಕೊಳ್ಳಿ. ಧನ್ಯವಾದಗಳು — ${businessName}.`,
      '3 days overdue': `ನಮಸ್ಕಾರ ${custName} ಅವರೇ, ಇನ್‌ವಾಯ್ಸ್ ${invoice.invoiceNumber} ರ ${amt} ಪಾವತಿಯು ${overdueDays} ದಿನಗಳಿಂದ ಬಾಕಿ ಇದೆ (ಕೊನೆಯ ದಿನಾಂಕ ${invoice.dueDate}). ಪಾವತಿಯನ್ನು ನಾವು ಯಾವಾಗ ನಿರೀಕ್ಷಿಸಬಹುದು ಎಂಬುದನ್ನು ದಯವಿಟ್ಟು ತಿಳಿಸಿ. ಧನ್ಯವಾದಗಳು — ${businessName}.`,
      '7 days overdue': `ನಮಸ್ಕಾರ ${custName} ಅವರೇ, ಇನ್‌ವಾಯ್ಸ್ ${invoice.invoiceNumber} (${amt}) ಈಗ ${overdueDays} ದಿನಗಳಷ್ಟು ವಿಳಂಬವಾಗಿದೆ. ನಮ್ಮ ಕಾರ್ಯನಿರ್ವಹಣಾ ಬಂಡವಾಳ ಯೋಜನೆಗಾಗಿ ದಯವಿಟ್ಟು ಇಂದು ಪಾವತಿ ದಿನಾಂಕ ಅಥವಾ ಭಾಗಶಃ ಪಾವತಿಯ ಮಾಹಿತಿಯನ್ನು ಹಂಚಿಕೊಳ್ಳಿ. — ${businessName}`,
      '15 days overdue': `ನಮಸ್ಕಾರ ${custName} ಅವರೇ, ಇನ್‌ವಾಯ್ಸ್ ${invoice.invoiceNumber} ರ ಬಾಕಿ ಮೊತ್ತ ${amt} ಈಗಾಗಲೇ ${overdueDays} ದಿನಗಳಷ್ಟು ಮೀರಿದೆ. ದಯವಿಟ್ಟು ಈ ವಾರ ಆದ್ಯತೆಯ ಮೇರೆಗೆ ಬಾಕಿ ಪಾವತಿಸಿ UTR ವಿವರಗಳನ್ನು ಕಳುಹಿಸಬೇಕಾಗಿ ವಿನಂತಿ. — ${businessName}`,
      'Final professional reminder': `ನಮಸ್ಕಾರ ${custName} ಅವರೇ, ${overdueDays} ದಿನಗಳಿಂದ ಬಾಕಿ ಇರುವ ಇನ್‌ವಾಯ್ಸ್ ${invoice.invoiceNumber} (${amt}) ಮೊತ್ತವನ್ನು ಶೀಘ್ರವಾಗಿ ಪಾವತಿಸಲು ${businessName} ವತಿಯಿಂದ ಇದು ಅಂತಿಮ ವೃತ್ತಿಪರ ವಿನಂತಿಯಾಗಿದೆ. ಮುಂದಿನ ಸರಬರಾಜು ತಡೆರಹಿತವಾಗಿ ಸಾಗಲು ದಯವಿಟ್ಟು ಇಂದೇ ಕರೆ ಅಥವಾ ಸಂದೇಶದ ಮೂಲಕ ಪಾವತಿ ಸಮಯವನ್ನು ತಿಳಿಸಿ.`,
    };
    return {
      subject: `ಪಾವತಿ ಜ್ಞಾಪನೆ: ಇನ್‌ವಾಯ್ಸ್ ${invoice.invoiceNumber} (${amt})`,
      message: bodyByStageKn[category],
      strategyNote: `Standard Kannada ${category.toLowerCase()} template based on ${overdueDays} overdue days.`,
    };
  }

  const bodyByStageEn: Record<ReminderCategory, string> = {
    'Friendly reminder': `Hello ${custName}, this is a friendly reminder from ${businessName} that invoice ${invoice.invoiceNumber} for ${amt} is due on ${invoice.dueDate}. Please let us know if you need any details. Thank you.`,
    'Payment due today': `Hello ${custName}, invoice ${invoice.invoiceNumber} for ${amt} is due today (${invoice.dueDate}). Kindly share the UTR/payment confirmation once processed. Thank you — ${businessName}.`,
    '3 days overdue': `Hello ${custName}, this is a polite reminder that invoice ${invoice.invoiceNumber} for ${amt} was due on ${invoice.dueDate} (${overdueDays} days ago). Please let us know when we can expect the payment. Thank you.`,
    '7 days overdue': `Hello ${custName}, invoice ${invoice.invoiceNumber} with an outstanding balance of ${amt} is now ${overdueDays} days overdue. We would appreciate an update on your payment schedule or a partial settlement this week. — ${businessName}`,
    '15 days overdue': `Hello ${custName}, invoice ${invoice.invoiceNumber} for ${amt} has been pending for ${overdueDays} days past its due date (${invoice.dueDate}). Please prioritize clearing this balance so we can keep your account current. Kindly share a confirmed payment date.`,
    'Final professional reminder': `Hello ${custName}, this is a final professional follow-up from ${businessName} regarding invoice ${invoice.invoiceNumber} for ${amt}, now ${overdueDays} days overdue. Please settle the balance or contact our accounts desk today to agree on a payment plan and avoid dispatch holds.`,
  };

  return {
    subject: `Payment Reminder: Invoice ${invoice.invoiceNumber} (${amt})`,
    message: bodyByStageEn[category],
    strategyNote: `Standard English ${category.toLowerCase()} template based on ${overdueDays} overdue days.`,
  };
}

export function recalculateInvoicePaymentTotals(invoiceId: string, refDateISO: string): void {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId) as
    | { id: string; status: string; total_amount: number; due_date: string }
    | undefined;
  if (!inv) return;

  const sumRow = db
    .prepare('SELECT COALESCE(SUM(amount), 0) as total_paid FROM payments WHERE invoice_id = ?')
    .get(invoiceId) as { total_paid: number };

  const paidAmount = Math.round(Number(sumRow.total_paid) * 100) / 100;
  const nextStatus = resolveInvoiceStatus(
    {
      status: inv.status === 'Draft' ? 'Sent' : (inv.status as Invoice['status']),
      totalAmount: Number(inv.total_amount),
      paidAmount,
      dueDate: String(inv.due_date),
    },
    refDateISO
  );

  db.prepare('UPDATE invoices SET paid_amount = ?, status = ? WHERE id = ?').run(
    paidAmount,
    nextStatus,
    invoiceId
  );
}

export { calculateInvoiceTotals };
