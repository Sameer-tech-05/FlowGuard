import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { db, initDatabase, logAudit } from './server/db';
import {
  clearSessionCookie,
  extractTokenFromRequest,
  rateLimit,
  requireAdmin,
  requireAuth,
  requireBusiness,
  resolveAuthFromToken,
  setSessionCookie,
  signSessionToken,
} from './server/auth';
import {
  askFinancialCopilotAI,
  explainCashFlowForecastAI,
  generatePaymentReminderAI,
} from './server/ai';
import {
  buildStandardReminderTemplate,
  calculateInvoiceTotals,
  getBusinessById,
  getBusinessFullContext,
  getBusinessSubscription,
  getCustomersByBusiness,
  getExpensesByBusiness,
  getInvoicesByBusiness,
  getPaymentsByBusiness,
  getRecurringExpensesByBusiness,
  getReminderLogsByBusiness,
  getSubscriptionPlans,
  recalculateInvoicePaymentTotals,
  todayISO,
} from './server/queries';
import {
  addDaysISO,
  buildCashFlowForecast,
  computeCustomerRiskSummaries,
  formatINR,
  getOverdueDays,
  recommendReminderCategory,
  resolveInvoiceStatus,
} from './src/lib/finance';
import type { ReminderCategory, SubscriptionPlanTier } from './src/lib/types';

initDatabase();

export const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '4mb' }));
app.use(cookieParser());

const PORT = Number(process.env.PORT || 3000);

function getIntegrationHealth() {
  return {
    geminiConfigured: Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY'),
    razorpayConfigured: Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET),
    emailConfigured: Boolean(process.env.RESEND_API_KEY),
    whatsappConfigured: Boolean(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID),
  };
}

// ==========================================
// 1. AUTHENTICATION & ONBOARDING
// ==========================================
app.post('/api/auth/signup', rateLimit(20, 60_000), (req, res) => {
  const { email, password, fullName, consentMessaging, consentFinancialAi } = req.body ?? {};
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    res.status(400).json({ error: 'Valid email address is required.' });
    return;
  }
  if (!password || typeof password !== 'string' || password.length < 8) {
    res.status(400).json({ error: 'Password must be at least 8 characters.' });
    return;
  }
  if (!fullName || typeof fullName !== 'string' || fullName.trim().length < 2) {
    res.status(400).json({ error: 'Full name is required.' });
    return;
  }

  const normalizedEmail = email.trim().toLowerCase();
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(normalizedEmail);
  if (existing) {
    res.status(409).json({ error: 'An account with this email already exists.' });
    return;
  }

  const userId = crypto.randomUUID();
  const verificationCode = String(Math.floor(100000 + Math.random() * 900000));
  const passHash = bcrypt.hashSync(password, 10);
  const nowISO = new Date().toISOString();

  db.prepare(`
    INSERT INTO users (id, email, password_hash, full_name, role, email_verified, verification_code, consent_messaging, consent_financial_ai, created_at)
    VALUES (?, ?, ?, ?, 'owner', 0, ?, ?, ?, ?)
  `).run(
    userId,
    normalizedEmail,
    passHash,
    fullName.trim(),
    verificationCode,
    consentMessaging ? 1 : 0,
    consentFinancialAi === false ? 0 : 1,
    nowISO
  );

  logAudit({ userId, action: 'USER_SIGNUP', resourceType: 'user', resourceId: userId });

  const token = signSessionToken({
    userId,
    email: normalizedEmail,
    fullName: fullName.trim(),
    role: 'owner',
    businessId: null,
  });
  setSessionCookie(res, token, req);

  res.status(201).json({
    token,
    user: {
      id: userId,
      email: normalizedEmail,
      fullName: fullName.trim(),
      role: 'owner',
      emailVerified: false,
      consentMessaging: Boolean(consentMessaging),
      consentFinancialAi: consentFinancialAi !== false,
    },
    business: null,
    // Exposed only when email provider is not configured so local test verification works smoothly
    devVerificationCode: process.env.RESEND_API_KEY ? undefined : verificationCode,
  });
});

app.post('/api/auth/login', rateLimit(30, 60_000), (req, res) => {
  const { email, password } = req.body ?? {};
  if (!email || !password) {
    res.status(400).json({ error: 'Email and password are required.' });
    return;
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  const user = db
    .prepare('SELECT * FROM users WHERE email = ?')
    .get(normalizedEmail) as Record<string, unknown> | undefined;

  if (!user || !bcrypt.compareSync(String(password), String(user.password_hash))) {
    res.status(401).json({ error: 'Invalid email or password.' });
    return;
  }

  const membership = db
    .prepare('SELECT business_id FROM business_memberships WHERE user_id = ? ORDER BY created_at ASC LIMIT 1')
    .get(String(user.id)) as { business_id: string } | undefined;

  const businessId = membership?.business_id ?? null;
  const business = businessId ? getBusinessById(businessId) : null;

  const token = signSessionToken({
    userId: String(user.id),
    email: String(user.email),
    fullName: String(user.full_name),
    role: String(user.role) as 'owner' | 'member' | 'admin',
    businessId,
  });
  setSessionCookie(res, token, req);

  logAudit({
    businessId,
    userId: String(user.id),
    action: 'USER_LOGIN',
    resourceType: 'user',
    resourceId: String(user.id),
  });

  res.json({
    token,
    user: {
      id: String(user.id),
      email: String(user.email),
      fullName: String(user.full_name),
      role: String(user.role),
      emailVerified: Boolean(user.email_verified),
      consentMessaging: Boolean(user.consent_messaging),
      consentFinancialAi: Boolean(user.consent_financial_ai),
    },
    business,
  });
});

app.post('/api/auth/demo', (req, res) => {
  const demoUser = db
    .prepare('SELECT * FROM users WHERE email = ?')
    .get('demo@sharmatraders.in') as Record<string, unknown> | undefined;
  const demoBiz = db
    .prepare('SELECT id FROM businesses WHERE is_demo = 1 LIMIT 1')
    .get() as { id: string } | undefined;

  if (!demoUser || !demoBiz) {
    res.status(500).json({ error: 'Demo workspace unavailable.' });
    return;
  }

  const business = getBusinessById(demoBiz.id);
  const token = signSessionToken({
    userId: String(demoUser.id),
    email: String(demoUser.email),
    fullName: String(demoUser.full_name),
    role: 'owner',
    businessId: demoBiz.id,
  });
  setSessionCookie(res, token, req);

  res.json({
    token,
    user: {
      id: String(demoUser.id),
      email: String(demoUser.email),
      fullName: String(demoUser.full_name),
      role: 'owner',
      emailVerified: true,
      consentMessaging: true,
      consentFinancialAi: true,
    },
    business,
  });
});

app.post('/api/auth/logout', (req, res) => {
  clearSessionCookie(res, req);
  res.json({ ok: true });
});

app.post('/api/auth/verify-email', requireAuth, (req, res) => {
  const { code } = req.body ?? {};
  const row = db
    .prepare('SELECT verification_code FROM users WHERE id = ?')
    .get(req.auth!.userId) as { verification_code: string | null } | undefined;

  if (!row || !code || String(code).trim() !== row.verification_code) {
    res.status(400).json({ error: 'Invalid verification code.' });
    return;
  }
  db.prepare('UPDATE users SET email_verified = 1, verification_code = NULL WHERE id = ?').run(
    req.auth!.userId
  );
  res.json({ emailVerified: true });
});

app.post('/api/auth/forgot-password', rateLimit(10, 60_000), (req, res) => {
  const { email } = req.body ?? {};
  if (!email) {
    res.status(400).json({ error: 'Email is required.' });
    return;
  }
  const normalized = String(email).trim().toLowerCase();
  const user = db.prepare('SELECT id FROM users WHERE email = ?').get(normalized) as
    | { id: string }
    | undefined;
  if (!user) {
    // Generic response to avoid account enumeration
    res.json({ ok: true, message: 'If an account exists, reset instructions have been prepared.' });
    return;
  }
  const resetToken = crypto.randomBytes(12).toString('hex');
  db.prepare('UPDATE users SET reset_token = ? WHERE id = ?').run(resetToken, user.id);

  res.json({
    ok: true,
    message: 'Password reset token generated.',
    devResetToken: process.env.RESEND_API_KEY ? undefined : resetToken,
  });
});

app.post('/api/auth/reset-password', (req, res) => {
  const { email, token, newPassword } = req.body ?? {};
  if (!email || !token || !newPassword || String(newPassword).length < 8) {
    res.status(400).json({ error: 'Email, valid reset token, and 8+ character password are required.' });
    return;
  }
  const user = db
    .prepare('SELECT id, reset_token FROM users WHERE email = ?')
    .get(String(email).trim().toLowerCase()) as { id: string; reset_token: string | null } | undefined;

  if (!user || !user.reset_token || user.reset_token !== String(token).trim()) {
    res.status(400).json({ error: 'Invalid or expired reset token.' });
    return;
  }
  const hash = bcrypt.hashSync(String(newPassword), 10);
  db.prepare('UPDATE users SET password_hash = ?, reset_token = NULL WHERE id = ?').run(hash, user.id);
  res.json({ ok: true });
});

app.get('/api/auth/me', (req, res) => {
  const rawToken = extractTokenFromRequest(req);
  if (!rawToken) {
    res.json({ authenticated: false, user: null, business: null, subscription: null, integrations: getIntegrationHealth() });
    return;
  }

  const auth = resolveAuthFromToken(rawToken);
  if (!auth) {
    clearSessionCookie(res, req);
    res.json({ authenticated: false, user: null, business: null, subscription: null, integrations: getIntegrationHealth() });
    return;
  }

  const userRow = db
    .prepare('SELECT id, email, full_name, role, email_verified, consent_messaging, consent_financial_ai, created_at FROM users WHERE id = ?')
    .get(auth.userId) as Record<string, unknown> | undefined;

  if (!userRow) {
    clearSessionCookie(res, req);
    res.json({ authenticated: false, user: null, business: null, subscription: null, integrations: getIntegrationHealth() });
    return;
  }

  const business = auth.businessId ? getBusinessById(auth.businessId) : null;
  const sub = auth.businessId ? getBusinessSubscription(auth.businessId) : null;

  res.json({
    authenticated: true,
    user: {
      id: String(userRow.id),
      email: String(userRow.email),
      fullName: String(userRow.full_name),
      role: String(userRow.role),
      emailVerified: Boolean(userRow.email_verified),
      consentMessaging: Boolean(userRow.consent_messaging),
      consentFinancialAi: Boolean(userRow.consent_financial_ai),
      createdAt: String(userRow.created_at),
    },
    business,
    subscription: sub,
    integrations: getIntegrationHealth(),
  });
});

app.post('/api/business/onboarding', requireAuth, (req, res) => {
  const {
    name,
    category,
    email,
    phone,
    location,
    currency,
    gstin,
    openingCashBalance,
    typicalMonthlyExpenses,
  } = req.body ?? {};

  if (!name || !category || !email || !phone || !location) {
    res.status(400).json({ error: 'Business name, category, email, phone, and location are required.' });
    return;
  }

  const opening = Number(openingCashBalance);
  const monthlyExp = Number(typicalMonthlyExpenses);
  if (!Number.isFinite(opening) || !Number.isFinite(monthlyExp) || monthlyExp < 0) {
    res.status(400).json({ error: 'Valid numeric opening cash balance and monthly expenses are required.' });
    return;
  }

  const businessId = crypto.randomUUID();
  const nowISO = new Date().toISOString();

  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO businesses (id, owner_id, name, category, email, phone, location, currency, gstin, opening_cash_balance, typical_monthly_expenses, is_demo, onboarding_completed, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?)
    `).run(
      businessId,
      req.auth!.userId,
      String(name).trim(),
      String(category).trim(),
      String(email).trim(),
      String(phone).trim(),
      String(location).trim(),
      String(currency || 'INR'),
      gstin ? String(gstin).trim().toUpperCase() : null,
      opening,
      monthlyExp,
      nowISO
    );

    db.prepare(`
      INSERT INTO business_memberships (id, business_id, user_id, role, created_at)
      VALUES (?, ?, ?, 'owner', ?)
    `).run(crypto.randomUUID(), businessId, req.auth!.userId, nowISO);

    db.prepare(`
      INSERT INTO subscriptions (id, business_id, plan_id, status, mode, current_period_start, current_period_end, razorpay_subscription_id, created_at)
      VALUES (?, ?, 'growth', 'trialing', 'test', ?, ?, ?, ?)
    `).run(
      crypto.randomUUID(),
      businessId,
      nowISO,
      addDaysISO(todayISO(), 14),
      `sub_trial_${businessId.slice(0, 8)}`,
      nowISO
    );
  });
  tx();

  const token = signSessionToken({
    userId: req.auth!.userId,
    email: req.auth!.email,
    fullName: req.auth!.fullName,
    role: req.auth!.role,
    businessId,
  });
  setSessionCookie(res, token, req);

  logAudit({
    businessId,
    userId: req.auth!.userId,
    action: 'BUSINESS_ONBOARDED',
    resourceType: 'business',
    resourceId: businessId,
  });

  res.status(201).json({ token, business: getBusinessById(businessId) });
});

app.patch('/api/business/profile', requireAuth, requireBusiness, (req, res) => {
  const bId = req.auth!.businessId!;
  const current = getBusinessById(bId)!;
  const { name, category, email, phone, location, gstin, openingCashBalance, typicalMonthlyExpenses } =
    req.body ?? {};

  db.prepare(`
    UPDATE businesses
    SET name = ?, category = ?, email = ?, phone = ?, location = ?, gstin = ?,
        opening_cash_balance = ?, typical_monthly_expenses = ?
    WHERE id = ?
  `).run(
    name ?? current.name,
    category ?? current.category,
    email ?? current.email,
    phone ?? current.phone,
    location ?? current.location,
    gstin !== undefined ? (gstin ? String(gstin).trim().toUpperCase() : null) : current.gstin,
    openingCashBalance !== undefined ? Number(openingCashBalance) : current.openingCashBalance,
    typicalMonthlyExpenses !== undefined ? Number(typicalMonthlyExpenses) : current.typicalMonthlyExpenses,
    bId
  );

  logAudit({
    businessId: bId,
    userId: req.auth!.userId,
    action: 'BUSINESS_PROFILE_UPDATED',
    resourceType: 'business',
    resourceId: bId,
  });

  res.json({ business: getBusinessById(bId) });
});

app.get('/api/business/team', requireAuth, requireBusiness, (req, res) => {
  const rows = db
    .prepare(`
      SELECT bm.id, bm.role, bm.created_at, u.email, u.full_name, u.email_verified
      FROM business_memberships bm
      JOIN users u ON u.id = bm.user_id
      WHERE bm.business_id = ?
      ORDER BY bm.created_at ASC
    `)
    .all(req.auth!.businessId!) as Array<Record<string, unknown>>;

  res.json({
    members: rows.map((r) => ({
      id: String(r.id),
      email: String(r.email),
      fullName: String(r.full_name),
      role: String(r.role),
      emailVerified: Boolean(r.email_verified),
      createdAt: String(r.created_at),
    })),
  });
});

app.post('/api/business/team', requireAuth, requireBusiness, (req, res) => {
  const bId = req.auth!.businessId!;
  const { plan } = getBusinessSubscription(bId);
  const currentCount = (
    db.prepare('SELECT COUNT(*) as c FROM business_memberships WHERE business_id = ?').get(bId) as {
      c: number;
    }
  ).c;

  if (currentCount >= plan.teamSeats) {
    res.status(403).json({
      error: `Your ${plan.name} plan allows up to ${plan.teamSeats} team seat(s). Upgrade to add more members.`,
    });
    return;
  }

  const { email, fullName, role, temporaryPassword } = req.body ?? {};
  if (!email || !fullName) {
    res.status(400).json({ error: 'Member name and email are required.' });
    return;
  }

  const normalized = String(email).trim().toLowerCase();
  let userRow = db.prepare('SELECT id FROM users WHERE email = ?').get(normalized) as
    | { id: string }
    | undefined;
  const nowISO = new Date().toISOString();

  if (!userRow) {
    const newId = crypto.randomUUID();
    const passHash = bcrypt.hashSync(String(temporaryPassword || 'Welcome@123'), 10);
    db.prepare(`
      INSERT INTO users (id, email, password_hash, full_name, role, email_verified, consent_messaging, consent_financial_ai, created_at)
      VALUES (?, ?, ?, ?, 'member', 1, 1, 1, ?)
    `).run(newId, normalized, passHash, String(fullName).trim(), nowISO);
    userRow = { id: newId };
  }

  const already = db
    .prepare('SELECT id FROM business_memberships WHERE business_id = ? AND user_id = ?')
    .get(bId, userRow.id);
  if (already) {
    res.status(409).json({ error: 'User is already a member of this business.' });
    return;
  }

  const membershipId = crypto.randomUUID();
  db.prepare(`
    INSERT INTO business_memberships (id, business_id, user_id, role, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(membershipId, bId, userRow.id, role === 'viewer' ? 'viewer' : 'finance_manager', nowISO);

  logAudit({
    businessId: bId,
    userId: req.auth!.userId,
    action: 'TEAM_MEMBER_ADDED',
    resourceType: 'membership',
    resourceId: membershipId,
    metadata: { email: normalized },
  });

  res.status(201).json({ ok: true });
});

app.get('/api/business/export', requireAuth, requireBusiness, (req, res) => {
  const ctx = getBusinessFullContext(req.auth!.businessId!);
  if (!ctx) {
    res.status(404).json({ error: 'Business not found.' });
    return;
  }
  logAudit({
    businessId: ctx.business.id,
    userId: req.auth!.userId,
    action: 'BUSINESS_DATA_EXPORTED',
    resourceType: 'business',
    resourceId: ctx.business.id,
  });
  res.json({
    exportedAt: new Date().toISOString(),
    business: ctx.business,
    customers: ctx.customers,
    invoices: ctx.invoices,
    payments: ctx.payments,
    expenses: ctx.expenses,
    recurringExpenses: ctx.recurringExpenses,
  });
});

// ==========================================
// 2. DASHBOARD & FORECASTS
// ==========================================
app.get('/api/dashboard', requireAuth, requireBusiness, (req, res) => {
  const ctx = getBusinessFullContext(req.auth!.businessId!);
  if (!ctx) {
    res.status(404).json({ error: 'Business workspace not found.' });
    return;
  }
  res.json({
    business: ctx.business,
    metrics: ctx.dashboard,
    forecast30: ctx.forecast30,
    overdueTop: ctx.overdueInvoices.slice(0, 6),
    recentPayments: ctx.payments.slice(0, 6),
    recentExpenses: ctx.expenses.slice(0, 6),
  });
});

app.get('/api/forecasts', requireAuth, requireBusiness, (req, res) => {
  const horizonParam = Number(req.query.horizon || 30);
  const horizonDays: 7 | 30 | 90 = horizonParam === 7 ? 7 : horizonParam === 90 ? 90 : 30;
  const ctx = getBusinessFullContext(req.auth!.businessId!);
  if (!ctx) {
    res.status(404).json({ error: 'Business not found.' });
    return;
  }

  const forecast = buildCashFlowForecast({
    horizonDays,
    referenceDateISO: ctx.refDate,
    currentCashBalance: ctx.currentCashBalance,
    typicalMonthlyExpenses: ctx.business.typicalMonthlyExpenses,
    invoices: ctx.invoices,
    expenses: ctx.expenses,
    recurringExpenses: ctx.recurringExpenses,
    customerRisks: ctx.customerRisks,
  });

  res.json({ forecast });
});

app.post('/api/forecasts/explain', requireAuth, requireBusiness, rateLimit(20, 60_000), async (req, res) => {
  const bId = req.auth!.businessId!;
  const { plan } = getBusinessSubscription(bId);
  if (!plan.aiEnabled) {
    res.status(403).json({
      error: 'AI cash flow explanation requires Growth (₹499/mo) or Business (₹4,999/mo) plan.',
      code: 'PLAN_UPGRADE_REQUIRED',
    });
    return;
  }

  const horizonParam = Number(req.body?.horizonDays || 30);
  const horizonDays: 7 | 30 | 90 = horizonParam === 7 ? 7 : horizonParam === 90 ? 90 : 30;
  const rawLang = req.body?.language;
  const lang: 'en' | 'hi' | 'kn' = rawLang === 'hi' ? 'hi' : rawLang === 'kn' ? 'kn' : 'en';
  const ctx = getBusinessFullContext(bId)!;
  const forecast = buildCashFlowForecast({
    horizonDays,
    referenceDateISO: ctx.refDate,
    currentCashBalance: ctx.currentCashBalance,
    typicalMonthlyExpenses: ctx.business.typicalMonthlyExpenses,
    invoices: ctx.invoices,
    expenses: ctx.expenses,
    recurringExpenses: ctx.recurringExpenses,
    customerRisks: ctx.customerRisks,
  });

  try {
    const explanation = await explainCashFlowForecastAI({
      businessName: ctx.business.name,
      forecast,
      topOverdueInvoices: ctx.overdueInvoices.slice(0, 5),
      language: lang,
    });

    db.prepare(`
      INSERT INTO forecast_snapshots (id, business_id, horizon_days, opening_balance, projected_inflow, projected_outflow, projected_closing_balance, shortage_detected, ai_summary, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      crypto.randomUUID(),
      bId,
      horizonDays,
      forecast.openingBalance,
      forecast.totalExpectedInflows,
      forecast.totalExpectedOutflows,
      forecast.projectedClosingBalance,
      forecast.shortageAlerts.length > 0 ? 1 : 0,
      explanation.summary,
      new Date().toISOString()
    );

    res.json(explanation);
  } catch (err) {
    res.status(502).json({
      error: err instanceof Error ? err.message : 'Unable to generate AI forecast explanation.',
    });
  }
});

// ==========================================
// 3. CUSTOMERS & PAYMENT RISK SCORING
// ==========================================
app.get('/api/customers', requireAuth, requireBusiness, (req, res) => {
  const bId = req.auth!.businessId!;
  const customers = getCustomersByBusiness(bId);
  const invoices = getInvoicesByBusiness(bId);
  const payments = getPaymentsByBusiness(bId);
  const riskSummaries = computeCustomerRiskSummaries(customers, invoices, payments, todayISO());
  const riskMap = new Map(riskSummaries.map((r) => [r.customerId, r]));

  res.json({
    customers: customers.map((c) => ({
      ...c,
      risk: riskMap.get(c.id),
    })),
  });
});

app.post('/api/customers', requireAuth, requireBusiness, (req, res) => {
  const bId = req.auth!.businessId!;
  const { name, businessName, email, phone, gstin, paymentTermsDays } = req.body ?? {};
  if (!name || !businessName || !email || !phone) {
    res.status(400).json({ error: 'Customer name, business name, email, and phone are required.' });
    return;
  }

  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO customers (id, business_id, name, business_name, email, phone, gstin, payment_terms_days, is_simulated, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
  `).run(
    id,
    bId,
    String(name).trim(),
    String(businessName).trim(),
    String(email).trim(),
    String(phone).trim(),
    gstin ? String(gstin).trim().toUpperCase() : null,
    Math.max(1, Number(paymentTermsDays) || 15),
    new Date().toISOString()
  );

  logAudit({ businessId: bId, userId: req.auth!.userId, action: 'CUSTOMER_CREATED', resourceType: 'customer', resourceId: id });
  res.status(201).json({ id });
});

app.patch('/api/customers/:id', requireAuth, requireBusiness, (req, res) => {
  const bId = req.auth!.businessId!;
  const existing = db
    .prepare('SELECT * FROM customers WHERE id = ? AND business_id = ?')
    .get(req.params.id, bId) as Record<string, unknown> | undefined;
  if (!existing) {
    res.status(404).json({ error: 'Customer not found in your business workspace.' });
    return;
  }

  const { name, businessName, email, phone, gstin, paymentTermsDays } = req.body ?? {};
  db.prepare(`
    UPDATE customers
    SET name = ?, business_name = ?, email = ?, phone = ?, gstin = ?, payment_terms_days = ?
    WHERE id = ? AND business_id = ?
  `).run(
    name ?? existing.name,
    businessName ?? existing.business_name,
    email ?? existing.email,
    phone ?? existing.phone,
    gstin !== undefined ? (gstin ? String(gstin).trim().toUpperCase() : null) : existing.gstin,
    paymentTermsDays !== undefined ? Number(paymentTermsDays) : existing.payment_terms_days,
    req.params.id,
    bId
  );

  res.json({ ok: true });
});

app.delete('/api/customers/:id', requireAuth, requireBusiness, (req, res) => {
  const bId = req.auth!.businessId!;
  const invCount = (
    db
      .prepare('SELECT COUNT(*) as c FROM invoices WHERE customer_id = ? AND business_id = ?')
      .get(req.params.id, bId) as { c: number }
  ).c;
  if (invCount > 0) {
    res.status(400).json({ error: 'Cannot delete a customer with existing invoices.' });
    return;
  }
  const info = db
    .prepare('DELETE FROM customers WHERE id = ? AND business_id = ?')
    .run(req.params.id, bId);
  if (info.changes === 0) {
    res.status(404).json({ error: 'Customer not found.' });
    return;
  }
  res.json({ ok: true });
});

// ==========================================
// 4. SMART INVOICES & PAYMENTS
// ==========================================
app.get('/api/invoices', requireAuth, requireBusiness, (req, res) => {
  const invoices = getInvoicesByBusiness(req.auth!.businessId!);
  const payments = getPaymentsByBusiness(req.auth!.businessId!);
  res.json({ invoices, payments });
});

app.post('/api/invoices', requireAuth, requireBusiness, (req, res) => {
  const bId = req.auth!.businessId!;
  const { plan } = getBusinessSubscription(bId);
  const currentMonth = todayISO().slice(0, 7);
  const monthCount = (
    db
      .prepare('SELECT COUNT(*) as c FROM invoices WHERE business_id = ? AND issue_date LIKE ?')
      .get(bId, `${currentMonth}%`) as { c: number }
  ).c;

  if (monthCount >= plan.invoiceLimitPerMonth) {
    res.status(403).json({
      error: `Monthly invoice limit (${plan.invoiceLimitPerMonth}) reached for your ${plan.name} plan.`,
      code: 'PLAN_LIMIT_REACHED',
    });
    return;
  }

  const { customerId, invoiceNumber, issueDate, dueDate, status, discountAmount, notes, items } =
    req.body ?? {};

  if (!customerId || !Array.isArray(items) || items.length === 0) {
    res.status(400).json({ error: 'Customer and at least one line item are required.' });
    return;
  }

  const cust = db
    .prepare('SELECT id FROM customers WHERE id = ? AND business_id = ?')
    .get(customerId, bId);
  if (!cust) {
    res.status(404).json({ error: 'Selected customer does not belong to your business.' });
    return;
  }

  const cleanItems = items.map((it: Record<string, unknown>) => ({
    description: String(it.description || '').trim(),
    hsnSac: it.hsnSac ? String(it.hsnSac).trim() : null,
    quantity: Math.max(0.01, Number(it.quantity) || 1),
    unitPrice: Math.max(0, Number(it.unitPrice) || 0),
    gstRate: Math.max(0, Number(it.gstRate) || 0),
  }));

  if (cleanItems.some((i) => !i.description)) {
    res.status(400).json({ error: 'Every invoice item must have a description.' });
    return;
  }

  const totals = calculateInvoiceTotals(cleanItems, Number(discountAmount) || 0);
  const invId = crypto.randomUUID();
  const invNum =
    invoiceNumber && String(invoiceNumber).trim()
      ? String(invoiceNumber).trim()
      : `INV-${Math.floor(1100 + Math.random() * 8899)}`;
  const iDate = issueDate || todayISO();
  const dDate = dueDate || addDaysISO(iDate, 15);
  const initialStatus = status === 'Draft' ? 'Draft' : resolveInvoiceStatus({ status: 'Sent', totalAmount: totals.totalAmount, paidAmount: 0, dueDate: dDate }, todayISO());
  const payToken = `pay_${crypto.randomBytes(8).toString('hex')}`;

  try {
    const tx = db.transaction(() => {
      db.prepare(`
        INSERT INTO invoices (id, business_id, customer_id, invoice_number, issue_date, due_date, status, subtotal, discount_amount, gst_amount, total_amount, paid_amount, notes, payment_link_token, is_simulated, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 0, ?)
      `).run(
        invId,
        bId,
        customerId,
        invNum,
        iDate,
        dDate,
        initialStatus,
        totals.subtotal,
        totals.discountApplied,
        totals.gstAmount,
        totals.totalAmount,
        notes ? String(notes) : null,
        payToken,
        new Date().toISOString()
      );

      const insertItem = db.prepare(`
        INSERT INTO invoice_items (id, invoice_id, description, hsn_sac, quantity, unit_price, gst_rate, line_total)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      cleanItems.forEach((ci, idx) => {
        insertItem.run(
          crypto.randomUUID(),
          invId,
          ci.description,
          ci.hsnSac,
          ci.quantity,
          ci.unitPrice,
          ci.gstRate,
          totals.computedItems[idx].lineTotal
        );
      });
    });
    tx();
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error && err.message.includes('UNIQUE') ? `Invoice number ${invNum} already exists.` : 'Failed to create invoice.',
    });
    return;
  }

  logAudit({
    businessId: bId,
    userId: req.auth!.userId,
    action: 'INVOICE_CREATED',
    resourceType: 'invoice',
    resourceId: invId,
    metadata: { invoiceNumber: invNum, totalAmount: totals.totalAmount },
  });

  res.status(201).json({ id: invId, invoiceNumber: invNum });
});

app.patch('/api/invoices/:id', requireAuth, requireBusiness, (req, res) => {
  const bId = req.auth!.businessId!;
  const existing = db
    .prepare('SELECT * FROM invoices WHERE id = ? AND business_id = ?')
    .get(req.params.id, bId) as Record<string, unknown> | undefined;

  if (!existing) {
    res.status(404).json({ error: 'Invoice not found.' });
    return;
  }

  const { dueDate, status, notes, discountAmount, items } = req.body ?? {};
  const tx = db.transaction(() => {
    if (Array.isArray(items) && items.length > 0 && existing.status === 'Draft') {
      const cleanItems = items.map((it: Record<string, unknown>) => ({
        description: String(it.description || '').trim(),
        hsnSac: it.hsnSac ? String(it.hsnSac).trim() : null,
        quantity: Math.max(0.01, Number(it.quantity) || 1),
        unitPrice: Math.max(0, Number(it.unitPrice) || 0),
        gstRate: Math.max(0, Number(it.gstRate) || 0),
      }));
      const totals = calculateInvoiceTotals(
        cleanItems,
        discountAmount !== undefined ? Number(discountAmount) : Number(existing.discount_amount)
      );

      db.prepare('DELETE FROM invoice_items WHERE invoice_id = ?').run(req.params.id);
      const insertItem = db.prepare(`
        INSERT INTO invoice_items (id, invoice_id, description, hsn_sac, quantity, unit_price, gst_rate, line_total)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      cleanItems.forEach((ci, idx) => {
        insertItem.run(
          crypto.randomUUID(),
          req.params.id,
          ci.description,
          ci.hsnSac,
          ci.quantity,
          ci.unitPrice,
          ci.gstRate,
          totals.computedItems[idx].lineTotal
        );
      });

      db.prepare(`
        UPDATE invoices
        SET due_date = ?, status = ?, notes = ?, subtotal = ?, discount_amount = ?, gst_amount = ?, total_amount = ?
        WHERE id = ? AND business_id = ?
      `).run(
        dueDate ?? existing.due_date,
        status ?? existing.status,
        notes !== undefined ? notes : existing.notes,
        totals.subtotal,
        totals.discountApplied,
        totals.gstAmount,
        totals.totalAmount,
        req.params.id,
        bId
      );
    } else {
      const nextStatus = status === 'Cancelled' ? 'Cancelled' : status === 'Sent' && existing.status === 'Draft' ? 'Sent' : existing.status;
      db.prepare(`
        UPDATE invoices SET due_date = ?, status = ?, notes = ? WHERE id = ? AND business_id = ?
      `).run(
        dueDate ?? existing.due_date,
        nextStatus,
        notes !== undefined ? notes : existing.notes,
        req.params.id,
        bId
      );
      if (nextStatus !== 'Cancelled' && nextStatus !== 'Draft') {
        recalculateInvoicePaymentTotals(req.params.id, todayISO());
      }
    }
  });
  tx();

  res.json({ ok: true });
});

app.delete('/api/invoices/:id', requireAuth, requireBusiness, (req, res) => {
  const bId = req.auth!.businessId!;
  const existing = db
    .prepare('SELECT status FROM invoices WHERE id = ? AND business_id = ?')
    .get(req.params.id, bId) as { status: string } | undefined;

  if (!existing) {
    res.status(404).json({ error: 'Invoice not found.' });
    return;
  }
  if (existing.status !== 'Draft') {
    res.status(400).json({ error: 'Only Draft invoices can be deleted. Cancel sent invoices instead.' });
    return;
  }
  db.prepare('DELETE FROM invoices WHERE id = ? AND business_id = ?').run(req.params.id, bId);
  res.json({ ok: true });
});

app.post('/api/invoices/:id/send', requireAuth, requireBusiness, async (req, res) => {
  const bId = req.auth!.businessId!;
  const inv = getInvoicesByBusiness(bId).find((i) => i.id === req.params.id);
  if (!inv) {
    res.status(404).json({ error: 'Invoice not found.' });
    return;
  }
  if (inv.status === 'Draft') {
    const resolved = resolveInvoiceStatus({ ...inv, status: 'Sent' }, todayISO());
    db.prepare('UPDATE invoices SET status = ? WHERE id = ? AND business_id = ?').run(
      resolved,
      inv.id,
      bId
    );
  }

  const business = getBusinessById(bId)!;
  let deliveryMode: 'email_sent' | 'preview_only' = 'preview_only';
  if (process.env.RESEND_API_KEY && inv.customerEmail) {
    try {
      const resp = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: process.env.EMAIL_FROM || 'billing@flowguard.in',
          to: [inv.customerEmail],
          subject: `Invoice ${inv.invoiceNumber} from ${business.name} (${formatINR(inv.totalAmount)})`,
          text: `Dear ${inv.customerName},\n\nPlease find invoice ${inv.invoiceNumber} for ${formatINR(inv.totalAmount)} due on ${inv.dueDate}.\n\nRegards,\n${business.name}`,
        }),
      });
      if (resp.ok) deliveryMode = 'email_sent';
    } catch {
      deliveryMode = 'preview_only';
    }
  }

  logAudit({
    businessId: bId,
    userId: req.auth!.userId,
    action: 'INVOICE_SENT',
    resourceType: 'invoice',
    resourceId: inv.id,
    metadata: { deliveryMode },
  });

  res.json({
    ok: true,
    deliveryMode,
    message:
      deliveryMode === 'email_sent'
        ? `Invoice emailed to ${inv.customerEmail}.`
        : 'Invoice marked as Sent. Email provider credentials are not configured — share PDF or payment link manually.',
  });
});

app.post('/api/invoices/:id/payments', requireAuth, requireBusiness, (req, res) => {
  const bId = req.auth!.businessId!;
  const inv = db
    .prepare('SELECT * FROM invoices WHERE id = ? AND business_id = ?')
    .get(req.params.id, bId) as Record<string, unknown> | undefined;

  if (!inv) {
    res.status(404).json({ error: 'Invoice not found.' });
    return;
  }
  if (inv.status === 'Cancelled') {
    res.status(400).json({ error: 'Cannot record payment on a cancelled invoice.' });
    return;
  }

  const { amount, paymentDate, method, referenceId, notes } = req.body ?? {};
  const payAmount = Math.round((Number(amount) || 0) * 100) / 100;
  const remaining = Math.round((Number(inv.total_amount) - Number(inv.paid_amount)) * 100) / 100;

  if (payAmount <= 0) {
    res.status(400).json({ error: 'Payment amount must be greater than zero.' });
    return;
  }
  if (payAmount > remaining + 0.01) {
    res.status(400).json({ error: `Payment exceeds remaining balance of ${formatINR(remaining)}.` });
    return;
  }

  const payId = crypto.randomUUID();
  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO payments (id, business_id, invoice_id, amount, payment_date, method, reference_id, notes, is_simulated, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
    `).run(
      payId,
      bId,
      req.params.id,
      payAmount,
      paymentDate || todayISO(),
      method || 'UPI',
      referenceId ? String(referenceId).trim() : null,
      notes ? String(notes).trim() : null,
      new Date().toISOString()
    );
    recalculateInvoicePaymentTotals(req.params.id, todayISO());
  });
  tx();

  logAudit({
    businessId: bId,
    userId: req.auth!.userId,
    action: 'PAYMENT_RECORDED',
    resourceType: 'payment',
    resourceId: payId,
    metadata: { invoiceId: req.params.id, amount: payAmount },
  });

  res.status(201).json({ id: payId });
});

// Public / Customer Payment Link Checkout (Razorpay Test Mode)
app.get('/api/pay/:token', (req, res) => {
  const row = db
    .prepare(`
      SELECT i.*, b.name as business_name, b.gstin as business_gstin, b.location as business_location,
             c.name as customer_name, c.business_name as customer_business_name
      FROM invoices i
      JOIN businesses b ON b.id = i.business_id
      JOIN customers c ON c.id = i.customer_id
      WHERE i.payment_link_token = ?
    `)
    .get(req.params.token) as Record<string, unknown> | undefined;

  if (!row) {
    res.status(404).json({ error: 'Invalid payment link.' });
    return;
  }
  const balance = Math.max(0, Number(row.total_amount) - Number(row.paid_amount));
  res.json({
    invoiceNumber: String(row.invoice_number),
    businessName: String(row.business_name),
    businessLocation: String(row.business_location),
    customerName: String(row.customer_name),
    customerBusinessName: String(row.customer_business_name),
    dueDate: String(row.due_date),
    totalAmount: Number(row.total_amount),
    paidAmount: Number(row.paid_amount),
    balanceDue: Math.round(balance * 100) / 100,
    status: resolveInvoiceStatus(
      {
        status: String(row.status) as 'Sent',
        totalAmount: Number(row.total_amount),
        paidAmount: Number(row.paid_amount),
        dueDate: String(row.due_date),
      },
      todayISO()
    ),
    mode: process.env.RAZORPAY_KEY_ID ? 'razorpay_configured' : 'razorpay_test_simulation',
  });
});

app.post('/api/pay/:token/checkout', (req, res) => {
  const inv = db
    .prepare('SELECT * FROM invoices WHERE payment_link_token = ?')
    .get(req.params.token) as Record<string, unknown> | undefined;

  if (!inv) {
    res.status(404).json({ error: 'Payment link not found.' });
    return;
  }
  const remaining = Math.round((Number(inv.total_amount) - Number(inv.paid_amount)) * 100) / 100;
  if (remaining <= 0) {
    res.status(400).json({ error: 'Invoice is already fully paid.' });
    return;
  }

  const reqAmount = req.body?.amount !== undefined ? Number(req.body.amount) : remaining;
  const payAmount = Math.min(remaining, Math.max(1, Math.round(reqAmount * 100) / 100));
  const eventId = req.body?.idempotencyKey
    ? String(req.body.idempotencyKey)
    : `rzp_test_evt_${crypto.randomBytes(6).toString('hex')}`;

  // Duplicate webhook protection
  const dup = db.prepare('SELECT id FROM payments WHERE webhook_event_id = ?').get(eventId);
  if (dup) {
    res.json({ ok: true, duplicateIgnored: true });
    return;
  }

  const payId = crypto.randomUUID();
  const rzpRef = `pay_test_${crypto.randomBytes(5).toString('hex')}`;
  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO payments (id, business_id, invoice_id, amount, payment_date, method, reference_id, webhook_event_id, notes, is_simulated, created_at)
      VALUES (?, ?, ?, ?, ?, 'Razorpay Test', ?, ?, 'Simulated Razorpay Test Mode checkout', 1, ?)
    `).run(
      payId,
      String(inv.business_id),
      String(inv.id),
      payAmount,
      todayISO(),
      rzpRef,
      eventId,
      new Date().toISOString()
    );
    recalculateInvoicePaymentTotals(String(inv.id), todayISO());
  });
  tx();

  res.status(201).json({
    ok: true,
    paymentId: payId,
    referenceId: rzpRef,
    amountPaid: payAmount,
    simulated: true,
  });
});

app.post('/api/webhooks/razorpay', (req, res) => {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  const signature = req.headers['x-razorpay-signature'];
  if (secret && typeof signature === 'string') {
    const expected = crypto.createHmac('sha256', secret).update(JSON.stringify(req.body)).digest('hex');
    if (expected !== signature) {
      res.status(401).json({ error: 'Invalid webhook signature.' });
      return;
    }
  }

  const eventId = String(req.body?.event_id || req.headers['x-razorpay-event-id'] || '');
  if (!eventId) {
    res.status(400).json({ error: 'Missing webhook event_id for idempotency.' });
    return;
  }
  const existing = db.prepare('SELECT id FROM payments WHERE webhook_event_id = ?').get(eventId);
  if (existing) {
    res.json({ status: 'duplicate_ignored' });
    return;
  }
  res.json({ status: 'verified', eventId });
});

// ==========================================
// 5. AI PAYMENT RECOVERY ASSISTANT
// ==========================================
app.get('/api/recovery/overdue', requireAuth, requireBusiness, (req, res) => {
  const bId = req.auth!.businessId!;
  const refDate = todayISO();
  const customers = getCustomersByBusiness(bId);
  const invoices = getInvoicesByBusiness(bId);
  const payments = getPaymentsByBusiness(bId);
  const risks = computeCustomerRiskSummaries(customers, invoices, payments, refDate);
  const riskMap = new Map(risks.map((r) => [r.customerId, r]));

  const queue = invoices
    .filter((i) => i.status === 'Overdue' || (i.status !== 'Paid' && i.status !== 'Draft' && i.status !== 'Cancelled'))
    .map((inv) => {
      const overdueDays = getOverdueDays(inv.dueDate, refDate);
      const outstandingAmount = Math.max(0, Math.round((inv.totalAmount - inv.paidAmount) * 100) / 100);
      const recommendedCategory = recommendReminderCategory(overdueDays);
      return {
        invoice: inv,
        overdueDays,
        outstandingAmount,
        recommendedCategory,
        customerRisk: riskMap.get(inv.customerId) ?? null,
      };
    })
    .filter((x) => x.outstandingAmount > 0)
    .sort((a, b) => b.overdueDays - a.overdueDays);

  const logs = getReminderLogsByBusiness(bId);
  res.json({ queue, logs });
});

app.post('/api/recovery/generate', requireAuth, requireBusiness, rateLimit(25, 60_000), async (req, res) => {
  const bId = req.auth!.businessId!;
  const { invoiceId, category, language, mode } = req.body ?? {};
  const inv = getInvoicesByBusiness(bId).find((i) => i.id === invoiceId);
  if (!inv) {
    res.status(404).json({ error: 'Invoice not found.' });
    return;
  }

  const business = getBusinessById(bId)!;
  const refDate = todayISO();
  const overdueDays = getOverdueDays(inv.dueDate, refDate);
  const outstandingAmount = Math.max(0, Math.round((inv.totalAmount - inv.paidAmount) * 100) / 100);
  const resolvedCategory: ReminderCategory = category || recommendReminderCategory(overdueDays);
  const lang: 'en' | 'hi' | 'kn' =
    language === 'hi' ? 'hi' : language === 'kn' ? 'kn' : 'en';

  if (mode === 'template') {
    const tpl = buildStandardReminderTemplate({
      businessName: business.name,
      invoice: inv,
      overdueDays,
      outstandingAmount,
      category: resolvedCategory,
      language: lang,
    });
    res.json({ ...tpl, source: 'standard_template' });
    return;
  }

  const { plan } = getBusinessSubscription(bId);
  if (!plan.aiEnabled) {
    res.status(403).json({
      error: 'AI reminder generation requires Growth (₹499/mo) or Business (₹4,999/mo) plan. Use Standard Template mode or upgrade.',
      code: 'PLAN_UPGRADE_REQUIRED',
    });
    return;
  }

  const customers = getCustomersByBusiness(bId);
  const invoices = getInvoicesByBusiness(bId);
  const payments = getPaymentsByBusiness(bId);
  const risks = computeCustomerRiskSummaries(customers, invoices, payments, refDate);
  const custRisk = risks.find((r) => r.customerId === inv.customerId);

  try {
    const aiResult = await generatePaymentReminderAI({
      businessName: business.name,
      invoice: inv,
      overdueDays,
      outstandingAmount,
      customerRisk: custRisk,
      category: resolvedCategory,
      language: lang,
    });
    res.json({ ...aiResult, source: 'gemini_ai' });
  } catch (err) {
    res.status(502).json({
      error: err instanceof Error ? err.message : 'AI reminder generation failed.',
    });
  }
});

app.post('/api/recovery/send', requireAuth, requireBusiness, async (req, res) => {
  const bId = req.auth!.businessId!;
  const { invoiceId, category, language, channel, subject, messageText } = req.body ?? {};
  const inv = getInvoicesByBusiness(bId).find((i) => i.id === invoiceId);
  if (!inv) {
    res.status(404).json({ error: 'Invoice not found.' });
    return;
  }
  if (!messageText || !String(messageText).trim()) {
    res.status(400).json({ error: 'Reminder message text is required.' });
    return;
  }

  const business = getBusinessById(bId)!;
  const ch: 'email' | 'whatsapp' | 'copy' =
    channel === 'whatsapp' ? 'whatsapp' : channel === 'copy' ? 'copy' : 'email';

  let deliveryStatus: 'sent_live' | 'preview_only' | 'copied' | 'failed' =
    ch === 'copy' ? 'copied' : 'preview_only';
  let statusNote = '';

  if (ch === 'email') {
    if (process.env.RESEND_API_KEY && inv.customerEmail) {
      try {
        const resp = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: process.env.EMAIL_FROM || 'billing@flowguard.in',
            to: [inv.customerEmail],
            subject: subject || `Payment Reminder: ${inv.invoiceNumber}`,
            text: String(messageText),
          }),
        });
        if (resp.ok) {
          deliveryStatus = 'sent_live';
          statusNote = `Email dispatched to ${inv.customerEmail}.`;
        } else {
          deliveryStatus = 'failed';
          statusNote = 'Email provider rejected dispatch; logged for manual follow-up.';
        }
      } catch {
        deliveryStatus = 'failed';
        statusNote = 'Email provider connection failed; logged as unsent.';
      }
    } else {
      deliveryStatus = 'preview_only';
      statusNote =
        'Email provider credentials (RESEND_API_KEY) are not configured. Reminder logged as approved preview — copy and send via your email client.';
    }
  } else if (ch === 'whatsapp') {
    const { plan } = getBusinessSubscription(bId);
    if (!plan.whatsappEnabled) {
      res.status(403).json({
        error: 'WhatsApp Business integration is available on the Business (₹4,999/mo) plan.',
      });
      return;
    }
    if (process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID && inv.customerPhone) {
      // Meta WhatsApp Business Cloud API dispatch
      try {
        const cleanPhone = inv.customerPhone.replace(/[^0-9]/g, '');
        const resp = await fetch(
          `https://graph.facebook.com/v19.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              messaging_product: 'whatsapp',
              to: cleanPhone,
              type: 'text',
              text: { body: String(messageText) },
            }),
          }
        );
        if (resp.ok) {
          deliveryStatus = 'sent_live';
          statusNote = `WhatsApp Business message sent to ${inv.customerPhone}.`;
        } else {
          deliveryStatus = 'preview_only';
          statusNote = 'WhatsApp template approval/credentials check failed; saved as manual share preview.';
        }
      } catch {
        deliveryStatus = 'preview_only';
        statusNote = 'WhatsApp Cloud API unreachable; saved as manual share preview.';
      }
    } else {
      deliveryStatus = 'preview_only';
      statusNote =
        'WhatsApp Business Cloud API credentials are not configured. Approved message logged as preview — use Copy or WhatsApp Web manual share.';
    }
  } else {
    statusNote = 'Approved reminder copied & logged to history.';
  }

  const logId = crypto.randomUUID();
  db.prepare(`
    INSERT INTO reminder_logs (id, business_id, invoice_id, customer_id, category, language, channel, delivery_status, message_text, customer_response, sent_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
  `).run(
    logId,
    bId,
    inv.id,
    inv.customerId,
    category || 'Friendly reminder',
    language === 'hi' ? 'hi' : language === 'kn' ? 'kn' : 'en',
    ch,
    deliveryStatus,
    String(messageText),
    new Date().toISOString()
  );

  logAudit({
    businessId: bId,
    userId: req.auth!.userId,
    action: 'REMINDER_LOGGED',
    resourceType: 'reminder_log',
    resourceId: logId,
    metadata: { channel: ch, deliveryStatus, businessName: business.name },
  });

  res.status(201).json({ id: logId, deliveryStatus, statusNote });
});

app.patch('/api/recovery/logs/:id', requireAuth, requireBusiness, (req, res) => {
  const bId = req.auth!.businessId!;
  const { customerResponse } = req.body ?? {};
  const info = db
    .prepare('UPDATE reminder_logs SET customer_response = ? WHERE id = ? AND business_id = ?')
    .run(customerResponse ? String(customerResponse) : null, req.params.id, bId);
  if (info.changes === 0) {
    res.status(404).json({ error: 'Reminder log not found.' });
    return;
  }
  res.json({ ok: true });
});

// ==========================================
// 6. EXPENSES & RECURRING EXPENSES
// ==========================================
app.get('/api/expenses', requireAuth, requireBusiness, (req, res) => {
  const bId = req.auth!.businessId!;
  res.json({
    expenses: getExpensesByBusiness(bId),
    recurring: getRecurringExpensesByBusiness(bId),
  });
});

app.post('/api/expenses', requireAuth, requireBusiness, (req, res) => {
  const bId = req.auth!.businessId!;
  const { title, vendorName, category, amount, expenseDate, dueDate, status, receiptName, notes } =
    req.body ?? {};
  if (!title || !vendorName || !category || Number(amount) <= 0) {
    res.status(400).json({ error: 'Title, vendor, category, and positive amount are required.' });
    return;
  }

  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO expenses (id, business_id, title, vendor_name, category, amount, expense_date, due_date, status, receipt_name, notes, is_simulated, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
  `).run(
    id,
    bId,
    String(title).trim(),
    String(vendorName).trim(),
    String(category),
    Math.round(Number(amount) * 100) / 100,
    expenseDate || todayISO(),
    dueDate || expenseDate || todayISO(),
    status === 'Pending' || status === 'Scheduled' ? status : 'Paid',
    receiptName ? String(receiptName).trim() : null,
    notes ? String(notes).trim() : null,
    new Date().toISOString()
  );

  logAudit({ businessId: bId, userId: req.auth!.userId, action: 'EXPENSE_CREATED', resourceType: 'expense', resourceId: id });
  res.status(201).json({ id });
});

app.patch('/api/expenses/:id', requireAuth, requireBusiness, (req, res) => {
  const bId = req.auth!.businessId!;
  const { status, notes } = req.body ?? {};
  const info = db
    .prepare('UPDATE expenses SET status = COALESCE(?, status), notes = COALESCE(?, notes) WHERE id = ? AND business_id = ?')
    .run(status ?? null, notes ?? null, req.params.id, bId);
  if (info.changes === 0) {
    res.status(404).json({ error: 'Expense not found.' });
    return;
  }
  res.json({ ok: true });
});

app.delete('/api/expenses/:id', requireAuth, requireBusiness, (req, res) => {
  const bId = req.auth!.businessId!;
  const info = db
    .prepare('DELETE FROM expenses WHERE id = ? AND business_id = ?')
    .run(req.params.id, bId);
  if (info.changes === 0) {
    res.status(404).json({ error: 'Expense not found.' });
    return;
  }
  res.json({ ok: true });
});

app.post('/api/expenses/import', requireAuth, requireBusiness, (req, res) => {
  const bId = req.auth!.businessId!;
  const { rows } = req.body ?? {};
  if (!Array.isArray(rows) || rows.length === 0) {
    res.status(400).json({ error: 'CSV rows array is required.' });
    return;
  }

  const insert = db.prepare(`
    INSERT INTO expenses (id, business_id, title, vendor_name, category, amount, expense_date, due_date, status, receipt_name, notes, is_simulated, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'Imported from CSV', 0, ?)
  `);
  const nowISO = new Date().toISOString();
  let imported = 0;

  const tx = db.transaction(() => {
    for (const r of rows) {
      const amt = Number(r.amount);
      if (!r.title || !Number.isFinite(amt) || amt <= 0) continue;
      insert.run(
        crypto.randomUUID(),
        bId,
        String(r.title).trim(),
        String(r.vendorName || 'Vendor').trim(),
        String(r.category || 'Other').trim(),
        Math.round(amt * 100) / 100,
        r.expenseDate || todayISO(),
        r.expenseDate || todayISO(),
        r.status === 'Pending' ? 'Pending' : 'Paid',
        nowISO
      );
      imported += 1;
    }
  });
  tx();

  res.status(201).json({ imported });
});

app.post('/api/recurring-expenses', requireAuth, requireBusiness, (req, res) => {
  const bId = req.auth!.businessId!;
  const { title, vendorName, category, amount, frequency, nextDueDate } = req.body ?? {};
  if (!title || !vendorName || !category || Number(amount) <= 0) {
    res.status(400).json({ error: 'Title, vendor, category, and positive amount are required.' });
    return;
  }
  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO recurring_expenses (id, business_id, title, vendor_name, category, amount, frequency, next_due_date, active, is_simulated, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?)
  `).run(
    id,
    bId,
    String(title).trim(),
    String(vendorName).trim(),
    String(category),
    Math.round(Number(amount) * 100) / 100,
    frequency === 'Weekly' || frequency === 'Quarterly' ? frequency : 'Monthly',
    nextDueDate || addDaysISO(todayISO(), 15),
    new Date().toISOString()
  );
  res.status(201).json({ id });
});

app.delete('/api/recurring-expenses/:id', requireAuth, requireBusiness, (req, res) => {
  const info = db
    .prepare('DELETE FROM recurring_expenses WHERE id = ? AND business_id = ?')
    .run(req.params.id, req.auth!.businessId!);
  if (info.changes === 0) {
    res.status(404).json({ error: 'Recurring rule not found.' });
    return;
  }
  res.json({ ok: true });
});

// ==========================================
// 7. AI FINANCIAL COPILOT
// ==========================================
app.get('/api/copilot/history', requireAuth, requireBusiness, (req, res) => {
  const rows = db
    .prepare('SELECT * FROM ai_conversations WHERE business_id = ? ORDER BY created_at DESC LIMIT 20')
    .all(req.auth!.businessId!) as Array<Record<string, unknown>>;

  res.json({
    history: rows.map((r) => ({
      id: String(r.id),
      question: String(r.question),
      answer: String(r.answer),
      sourceFigures: JSON.parse(String(r.source_figures_json || '[]')),
      createdAt: String(r.created_at),
    })),
  });
});

app.post('/api/copilot/ask', requireAuth, requireBusiness, rateLimit(20, 60_000), async (req, res) => {
  const bId = req.auth!.businessId!;
  const { plan } = getBusinessSubscription(bId);
  if (!plan.aiEnabled) {
    res.status(403).json({
      error: 'AI Financial Copilot requires Growth (₹499/mo) or Business (₹4,999/mo) plan.',
      code: 'PLAN_UPGRADE_REQUIRED',
    });
    return;
  }

  const { question, language } = req.body ?? {};
  if (!question || !String(question).trim()) {
    res.status(400).json({ error: 'Please enter a financial question.' });
    return;
  }
  const lang: 'en' | 'hi' | 'kn' =
    language === 'hi' ? 'hi' : language === 'kn' ? 'kn' : 'en';

  const ctx = getBusinessFullContext(bId)!;

  // Build strict single-business grounded snapshot
  const expenseByCat = new Map<string, number>();
  for (const e of ctx.expenses) {
    if (e.expenseDate.startsWith(ctx.refDate.slice(0, 7))) {
      expenseByCat.set(e.category, (expenseByCat.get(e.category) ?? 0) + e.amount);
    }
  }

  const contextSnapshot = {
    businessName: ctx.business.name,
    asOfDate: ctx.refDate,
    availableCashBalanceINR: ctx.dashboard.availableCashBalance,
    totalOutstandingReceivablesINR: ctx.dashboard.totalOutstandingReceivables,
    totalOverduePaymentsINR: ctx.dashboard.totalOverduePayments,
    overdueInvoicesCount: ctx.dashboard.overdueCount,
    projectedCashAfter30DaysINR: ctx.forecast30.projectedClosingBalance,
    expected30dInflowsINR: ctx.forecast30.totalExpectedInflows,
    expected30dOutflowsINR: ctx.forecast30.totalExpectedOutflows,
    shortageAlerts30d: ctx.forecast30.shortageAlerts,
    topOverdueInvoices: ctx.overdueInvoices.slice(0, 8),
    topDebtorsByOutstanding: [...ctx.customerRisks]
      .sort((a, b) => b.outstandingBalance - a.outstandingBalance)
      .slice(0, 6)
      .map((c) => ({
        customer: c.businessName,
        contact: c.name,
        outstandingINR: c.outstandingBalance,
        riskLevel: c.riskLevel,
        avgDelayDays: c.averagePaymentDelayDays,
      })),
    currentMonthExpensesByCategoryINR: Object.fromEntries(expenseByCat.entries()),
    upcomingPendingBillsINR: ctx.expenses
      .filter((e) => e.status !== 'Paid')
      .map((e) => ({ title: e.title, amountINR: e.amount, dueDate: e.dueDate })),
  };

  try {
    const aiReply = await askFinancialCopilotAI({
      businessName: ctx.business.name,
      question: String(question).trim(),
      contextSnapshot,
      language: lang,
    });

    const convId = crypto.randomUUID();
    db.prepare(`
      INSERT INTO ai_conversations (id, business_id, user_id, question, answer, source_figures_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      convId,
      bId,
      req.auth!.userId,
      String(question).trim(),
      aiReply.answer,
      JSON.stringify({ sourceFigures: aiReply.sourceFigures, assumptions: aiReply.assumptions }),
      new Date().toISOString()
    );

    res.json({ id: convId, ...aiReply });
  } catch (err) {
    res.status(502).json({
      error: err instanceof Error ? err.message : 'Unable to reach AI Financial Copilot.',
    });
  }
});

// ==========================================
// 8. SUBSCRIPTIONS & BILLING
// ==========================================
app.get('/api/billing/plans', (_req, res) => {
  res.json({ plans: getSubscriptionPlans() });
});

app.get('/api/billing/subscription', requireAuth, requireBusiness, (req, res) => {
  const bId = req.auth!.businessId!;
  const sub = getBusinessSubscription(bId);
  const business = getBusinessById(bId);
  const history = db
    .prepare('SELECT * FROM billing_history WHERE business_id = ? ORDER BY created_at DESC')
    .all(bId);
  res.json({
    ...sub,
    history,
    businessName: business?.name ?? 'FlowGuard Workspace',
    businessEmail: business?.email ?? req.auth!.email,
    businessPhone: business?.phone ?? '',
    razorpayConfigured: Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET),
    razorpayKeyId: process.env.RAZORPAY_KEY_ID || null,
  });
});

app.post('/api/billing/create-order', requireAuth, requireBusiness, async (req, res) => {
  const bId = req.auth!.businessId!;
  const { planId } = req.body ?? {};
  const plans = getSubscriptionPlans();
  const targetPlan = plans.find((p) => p.id === (planId as SubscriptionPlanTier));
  if (!targetPlan) {
    res.status(400).json({ error: 'Invalid subscription plan.' });
    return;
  }

  const business = getBusinessById(bId);
  const amountPaise = Math.round(targetPlan.monthlyPriceInr * 100);
  const receipt = `fg_${bId.slice(0, 8)}_${Date.now()}`;

  if (amountPaise > 0 && process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
    try {
      const authHeader = Buffer.from(
        `${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`
      ).toString('base64');
      const rzpRes = await fetch('https://api.razorpay.com/v1/orders', {
        method: 'POST',
        headers: {
          Authorization: `Basic ${authHeader}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          amount: amountPaise,
          currency: 'INR',
          receipt,
          notes: { businessId: bId, planId: targetPlan.id },
        }),
      });
      if (rzpRes.ok) {
        const rzpOrder = (await rzpRes.json()) as { id: string; amount: number; currency: string };
        res.json({
          orderId: rzpOrder.id,
          amountPaise: rzpOrder.amount,
          amountInr: targetPlan.monthlyPriceInr,
          currency: rzpOrder.currency,
          mode: 'live',
          keyId: process.env.RAZORPAY_KEY_ID,
          plan: targetPlan,
          prefill: {
            name: business?.name ?? req.auth!.fullName,
            email: business?.email ?? req.auth!.email,
            contact: business?.phone ?? '',
          },
        });
        return;
      }
    } catch {
      // Fall through to test order if network unreachable
    }
  }

  res.json({
    orderId: `order_test_${crypto.randomBytes(6).toString('hex')}`,
    amountPaise,
    amountInr: targetPlan.monthlyPriceInr,
    currency: 'INR',
    mode: 'test',
    keyId: 'rzp_test_flowguard_sandbox',
    plan: targetPlan,
    prefill: {
      name: business?.name ?? req.auth!.fullName,
      email: business?.email ?? req.auth!.email,
      contact: business?.phone ?? '',
    },
  });
});

app.post('/api/billing/checkout', requireAuth, requireBusiness, (req, res) => {
  const bId = req.auth!.businessId!;
  const { planId, orderId, paymentMethod, paymentDetail, razorpayPaymentId, razorpaySignature } =
    req.body ?? {};
  const plans = getSubscriptionPlans();
  const targetPlan = plans.find((p) => p.id === (planId as SubscriptionPlanTier));
  if (!targetPlan) {
    res.status(400).json({ error: 'Invalid subscription plan.' });
    return;
  }

  let billingMode: 'test' | 'live' = 'test';
  if (
    targetPlan.monthlyPriceInr > 0 &&
    razorpayPaymentId &&
    razorpaySignature &&
    orderId &&
    process.env.RAZORPAY_KEY_SECRET
  ) {
    const expectedSig = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(`${orderId}|${razorpayPaymentId}`)
      .digest('hex');
    if (expectedSig !== razorpaySignature) {
      res.status(400).json({ error: 'Razorpay payment signature verification failed.' });
      return;
    }
    billingMode = 'live';
  }

  const nowISO = new Date().toISOString();
  const endISO = addDaysISO(todayISO(), 30) + 'T23:59:59Z';
  const rzpSubId = `sub_${billingMode}_${crypto.randomBytes(5).toString('hex')}`;
  const rzpPayId =
    targetPlan.monthlyPriceInr === 0
      ? `plan_free_${crypto.randomBytes(4).toString('hex')}`
      : razorpayPaymentId || `pay_${billingMode}_${crypto.randomBytes(5).toString('hex')}`;

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM subscriptions WHERE business_id = ?').run(bId);
    db.prepare(`
      INSERT INTO subscriptions (id, business_id, plan_id, status, mode, current_period_start, current_period_end, razorpay_subscription_id, created_at)
      VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?)
    `).run(crypto.randomUUID(), bId, targetPlan.id, billingMode, nowISO, endISO, rzpSubId, nowISO);

    db.prepare(`
      INSERT INTO billing_history (id, business_id, plan_id, amount_inr, status, mode, razorpay_payment_id, created_at)
      VALUES (?, ?, ?, ?, 'paid', ?, ?, ?)
    `).run(crypto.randomUUID(), bId, targetPlan.id, targetPlan.monthlyPriceInr, billingMode, rzpPayId, nowISO);
  });
  tx();

  logAudit({
    businessId: bId,
    userId: req.auth!.userId,
    action: 'SUBSCRIPTION_UPDATED',
    resourceType: 'subscription',
    resourceId: rzpSubId,
    metadata: {
      planId: targetPlan.id,
      amountInr: targetPlan.monthlyPriceInr,
      mode: billingMode,
      orderId: orderId || null,
      paymentMethod: paymentMethod || (targetPlan.monthlyPriceInr === 0 ? 'free_tier' : 'upi'),
      paymentDetail: paymentDetail || null,
    },
  });

  res.json({
    ok: true,
    mode: billingMode,
    subscription: getBusinessSubscription(bId),
    paymentId: rzpPayId,
    orderId: orderId || null,
    paymentMethod: paymentMethod || null,
  });
});

app.post('/api/billing/cancel', requireAuth, requireBusiness, (req, res) => {
  const bId = req.auth!.businessId!;
  db.prepare(`UPDATE subscriptions SET status = 'cancelled' WHERE business_id = ?`).run(bId);
  logAudit({
    businessId: bId,
    userId: req.auth!.userId,
    action: 'SUBSCRIPTION_CANCELLED',
    resourceType: 'subscription',
  });
  res.json({ ok: true });
});

// ==========================================
// 9. PROTECTED ADMIN CONSOLE (AGGREGATE ONLY)
// ==========================================
app.get('/api/admin/overview', requireAuth, requireAdmin, (_req, res) => {
  const totalBusinesses = (db.prepare('SELECT COUNT(*) as c FROM businesses').get() as { c: number }).c;
  const totalUsers = (db.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number }).c;
  const activeSubs = db
    .prepare(`
      SELECT s.plan_id, p.monthly_price_inr
      FROM subscriptions s
      JOIN subscription_plans p ON p.id = s.plan_id
      WHERE s.status IN ('active', 'trialing')
    `)
    .all() as Array<{ plan_id: string; monthly_price_inr: number }>;

  const cancelledCount = (
    db.prepare("SELECT COUNT(*) as c FROM subscriptions WHERE status = 'cancelled'").get() as { c: number }
  ).c;

  const mrr = activeSubs.reduce((sum, s) => sum + Number(s.monthly_price_inr), 0);

  // Aggregate usage counts only — NO private customer/invoice/cash data exposed to admin
  const totalInvoicesPlatform = (db.prepare('SELECT COUNT(*) as c FROM invoices').get() as { c: number }).c;
  const totalAiCalls = (db.prepare('SELECT COUNT(*) as c FROM ai_conversations').get() as { c: number }).c;
  const recentAuditLogs = db
    .prepare('SELECT id, action, resource_type, created_at FROM audit_logs ORDER BY created_at DESC LIMIT 25')
    .all();

  res.json({
    metrics: {
      totalBusinesses,
      totalUsers,
      activeSubscriptions: activeSubs.length,
      cancellations: cancelledCount,
      mrrInr: mrr,
      totalInvoicesPlatform,
      totalAiCalls,
    },
    plans: getSubscriptionPlans(),
    integrationHealth: getIntegrationHealth(),
    recentAuditLogs,
  });
});

app.patch('/api/admin/plans/:id', requireAuth, requireAdmin, (req, res) => {
  const { monthlyPriceInr, invoiceLimitPerMonth } = req.body ?? {};
  const price = Number(monthlyPriceInr);
  const limit = Number(invoiceLimitPerMonth);
  if (!Number.isFinite(price) || price < 0 || !Number.isFinite(limit) || limit < 1) {
    res.status(400).json({ error: 'Valid plan price and monthly invoice limit are required.' });
    return;
  }

  const info = db
    .prepare('UPDATE subscription_plans SET monthly_price_inr = ?, invoice_limit_per_month = ? WHERE id = ?')
    .run(price, limit, req.params.id);
  if (info.changes === 0) {
    res.status(404).json({ error: 'Plan not found.' });
    return;
  }
  logAudit({
    userId: req.auth!.userId,
    action: 'ADMIN_PLAN_UPDATED',
    resourceType: 'subscription_plan',
    resourceId: req.params.id,
    metadata: { monthlyPriceInr: price, invoiceLimitPerMonth: limit },
  });
  res.json({ plans: getSubscriptionPlans() });
});

// ==========================================
// 10. VITE MIDDLEWARE / STATIC SERVING
// ==========================================
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    if (fs.existsSync(distPath)) {
      app.use(express.static(distPath));
      app.get('*', (_req, res) => {
        res.sendFile(path.join(distPath, 'index.html'));
      });
    }
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`FlowGuard AI server running on http://localhost:${PORT}`);
  });
}

// Start server when executed as entrypoint
const isMain =
  process.argv[1] &&
  (process.argv[1].endsWith('server.ts') || process.argv[1].endsWith('server.js'));

if (isMain || process.env.START_SERVER === '1') {
  startServer();
}
