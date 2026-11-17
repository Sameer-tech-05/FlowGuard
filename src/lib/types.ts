export type InvoiceStatus =
  | 'Draft'
  | 'Sent'
  | 'Partially Paid'
  | 'Paid'
  | 'Overdue'
  | 'Cancelled';

export type ExpenseCategory =
  | 'Rent'
  | 'Salaries'
  | 'Inventory'
  | 'Marketing'
  | 'Utilities'
  | 'Software'
  | 'Logistics'
  | 'Taxes'
  | 'Other';

export type ReminderCategory =
  | 'Friendly reminder'
  | 'Payment due today'
  | '3 days overdue'
  | '7 days overdue'
  | '15 days overdue'
  | 'Final professional reminder';

export type SupportedLanguage = 'en' | 'hi' | 'kn';

export type PaymentRiskLevel = 'Low' | 'Medium' | 'High';

export type SubscriptionPlanTier = 'free' | 'growth' | 'business';

export interface User {
  id: string;
  email: string;
  fullName: string;
  role: 'owner' | 'member' | 'admin';
  emailVerified: boolean;
  consentMessaging: boolean;
  consentFinancialAi: boolean;
  createdAt: string;
}

export interface Business {
  id: string;
  ownerId: string;
  name: string;
  category: string;
  email: string;
  phone: string;
  location: string;
  currency: string;
  gstin: string | null;
  openingCashBalance: number;
  typicalMonthlyExpenses: number;
  isDemo: boolean;
  onboardingCompleted: boolean;
  createdAt: string;
}

export interface Customer {
  id: string;
  businessId: string;
  name: string;
  businessName: string;
  email: string;
  phone: string;
  gstin: string | null;
  paymentTermsDays: number;
  isSimulated: boolean;
  createdAt: string;
}

export interface InvoiceItem {
  id?: string;
  invoiceId?: string;
  description: string;
  hsnSac?: string;
  quantity: number;
  unitPrice: number;
  gstRate: number;
  lineTotal: number;
}

export interface Invoice {
  id: string;
  businessId: string;
  customerId: string;
  customerName?: string;
  customerBusinessName?: string;
  customerEmail?: string;
  customerPhone?: string;
  invoiceNumber: string;
  issueDate: string;
  dueDate: string;
  status: InvoiceStatus;
  subtotal: number;
  discountAmount: number;
  gstAmount: number;
  totalAmount: number;
  paidAmount: number;
  notes: string | null;
  paymentLinkToken: string | null;
  isSimulated: boolean;
  items?: InvoiceItem[];
  createdAt: string;
}

export interface Payment {
  id: string;
  businessId: string;
  invoiceId: string;
  invoiceNumber?: string;
  customerName?: string;
  amount: number;
  paymentDate: string;
  method: 'UPI' | 'NEFT/RTGS' | 'Bank Transfer' | 'Cash' | 'Razorpay Test' | 'Cheque';
  referenceId: string | null;
  notes: string | null;
  isSimulated: boolean;
  createdAt: string;
}

export interface Expense {
  id: string;
  businessId: string;
  title: string;
  vendorName: string;
  category: ExpenseCategory;
  amount: number;
  expenseDate: string;
  dueDate: string | null;
  status: 'Paid' | 'Pending' | 'Scheduled';
  receiptName: string | null;
  notes: string | null;
  isSimulated: boolean;
  createdAt: string;
}

export interface RecurringExpense {
  id: string;
  businessId: string;
  title: string;
  vendorName: string;
  category: ExpenseCategory;
  amount: number;
  frequency: 'Weekly' | 'Monthly' | 'Quarterly';
  nextDueDate: string;
  active: boolean;
  isSimulated: boolean;
  createdAt: string;
}

export interface ReminderLog {
  id: string;
  businessId: string;
  invoiceId: string;
  customerId: string;
  invoiceNumber?: string;
  customerName?: string;
  category: ReminderCategory;
  language: SupportedLanguage;
  channel: 'email' | 'whatsapp' | 'copy';
  deliveryStatus: 'sent_live' | 'preview_only' | 'copied' | 'failed';
  messageText: string;
  customerResponse: string | null;
  sentAt: string;
}

export interface CustomerRiskSummary {
  customerId: string;
  name: string;
  businessName: string;
  email: string;
  phone: string;
  totalInvoiced: number;
  totalPaid: number;
  outstandingBalance: number;
  averagePaymentDelayDays: number;
  overdueInvoiceCount: number;
  lateInvoiceCount: number;
  recentInvoiceCount: number;
  riskLevel: PaymentRiskLevel;
  explanation: string;
}

export interface CashFlowDayPoint {
  date: string;
  label: string;
  expectedInflow: number;
  expectedOutflow: number;
  netFlow: number;
  projectedBalance: number;
  events: string[];
}

export interface CashFlowShortageAlert {
  date: string;
  projectedBalance: number;
  shortageAmount: number;
  reason: string;
}

export interface CashFlowForecastResult {
  horizonDays: 7 | 30 | 90;
  openingBalance: number;
  totalExpectedInflows: number;
  totalExpectedOutflows: number;
  projectedClosingBalance: number;
  confidence: 'High' | 'Medium' | 'Estimate';
  assumptions: string[];
  shortageAlerts: CashFlowShortageAlert[];
  dailyPoints: CashFlowDayPoint[];
}

export interface DashboardMetrics {
  availableCashBalance: number;
  totalOutstandingReceivables: number;
  totalOverduePayments: number;
  overdueCount: number;
  expectedCollectionsThisMonth: number;
  upcomingExpenses30d: number;
  projectedCash30d: number;
  monthlyCashFlowSeries: Array<{
    month: string;
    inflow: number;
    outflow: number;
    revenue: number;
  }>;
  agingBuckets: Array<{
    bucket: string;
    amount: number;
    count: number;
  }>;
  customerPerformance: Array<{
    customerName: string;
    paid: number;
    outstanding: number;
    riskLevel: PaymentRiskLevel;
  }>;
}

export interface SubscriptionPlan {
  id: SubscriptionPlanTier;
  name: string;
  tagline: string;
  monthlyPriceInr: number;
  invoiceLimitPerMonth: number;
  features: string[];
  aiEnabled: boolean;
  whatsappEnabled: boolean;
  teamSeats: number;
}

export interface BusinessSubscription {
  id: string;
  businessId: string;
  planId: SubscriptionPlanTier;
  status: 'active' | 'trialing' | 'cancelled' | 'past_due';
  mode: 'test' | 'live';
  currentPeriodStart: string;
  currentPeriodEnd: string;
  razorpaySubscriptionId: string | null;
}
