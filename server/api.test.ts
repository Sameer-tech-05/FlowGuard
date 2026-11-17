import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import bcrypt from 'bcryptjs';
import { db, initDatabase } from './db';
import {
  buildStandardReminderTemplate,
  getBusinessFullContext,
  getInvoicesByBusiness,
  recalculateInvoicePaymentTotals,
  todayISO,
} from './queries';
import { calculateInvoiceTotals } from '../src/lib/finance';
import { app } from '../server';

initDatabase();

test('Demo business Sharma Wholesale Traders is seeded with 25 customers, 60 invoices, and overdue items', () => {
  const demo = db.prepare('SELECT id, name FROM businesses WHERE is_demo = 1 LIMIT 1').get() as
    | { id: string; name: string }
    | undefined;
  assert.ok(demo);
  assert.equal(demo.name, 'Sharma Wholesale Traders');

  const ctx = getBusinessFullContext(demo.id);
  assert.ok(ctx);
  assert.equal(ctx.customers.length, 25);
  assert.equal(ctx.invoices.length, 60);
  assert.ok(ctx.overdueInvoices.length >= 4, 'Should have multiple overdue invoices');
  assert.ok(ctx.forecast30.shortageAlerts.length >= 1, 'Should detect upcoming working capital pressure');
});

test('Multi-tenant isolation, invoice creation, partial payment, and expense entry work atomically', () => {
  const userId = crypto.randomUUID();
  const bizId = crypto.randomUUID();
  const custId = crypto.randomUUID();
  const invId = crypto.randomUUID();
  const nowISO = new Date().toISOString();
  const today = todayISO();

  try {
    db.prepare(`
      INSERT INTO users (id, email, password_hash, full_name, role, email_verified, created_at)
      VALUES (?, ?, ?, 'Test Founder', 'owner', 1, ?)
    `).run(userId, `test_${userId}@example.com`, bcrypt.hashSync('Test@1234', 8), nowISO);

    db.prepare(`
      INSERT INTO businesses (id, owner_id, name, category, email, phone, location, currency, opening_cash_balance, typical_monthly_expenses, is_demo, onboarding_completed, created_at)
      VALUES (?, ?, 'Isolation Test Co', 'Agency', 'co@example.com', '9999999999', 'Pune', 'INR', 100000, 30000, 0, 1, ?)
    `).run(bizId, userId, nowISO);

    db.prepare(`
      INSERT INTO customers (id, business_id, name, business_name, email, phone, payment_terms_days, is_simulated, created_at)
      VALUES (?, ?, 'Client A', 'Client A Pvt Ltd', 'clienta@example.com', '9800000000', 15, 0, ?)
    `).run(custId, bizId, nowISO);

    const totals = calculateInvoiceTotals([{ quantity: 2, unitPrice: 10000, gstRate: 18 }], 0);
    db.prepare(`
      INSERT INTO invoices (id, business_id, customer_id, invoice_number, issue_date, due_date, status, subtotal, discount_amount, gst_amount, total_amount, paid_amount, is_simulated, created_at)
      VALUES (?, ?, ?, 'INV-TEST-1', ?, ?, 'Sent', ?, 0, ?, ?, 0, 0, ?)
    `).run(invId, bizId, custId, today, today, totals.subtotal, totals.gstAmount, totals.totalAmount, nowISO);

    // Record partial payment of ₹10,000 against ₹23,600
    db.prepare(`
      INSERT INTO payments (id, business_id, invoice_id, amount, payment_date, method, is_simulated, created_at)
      VALUES (?, ?, ?, 10000, ?, 'UPI', 0, ?)
    `).run(crypto.randomUUID(), bizId, invId, today, nowISO);

    recalculateInvoicePaymentTotals(invId, today);

    // Add paid expense of ₹15,000
    db.prepare(`
      INSERT INTO expenses (id, business_id, title, vendor_name, category, amount, expense_date, status, is_simulated, created_at)
      VALUES (?, ?, 'Cloud Hosting', 'AWS', 'Software', 15000, ?, 'Paid', 0, ?)
    `).run(crypto.randomUUID(), bizId, today, nowISO);

    const ctx = getBusinessFullContext(bizId)!;
    assert.equal(ctx.customers.length, 1);
    assert.equal(ctx.invoices[0].status, 'Partially Paid');
    assert.equal(ctx.invoices[0].paidAmount, 10000);
    // Cash = 100000 + 10000 - 15000 = 95000
    assert.equal(ctx.dashboard.availableCashBalance, 95000);
    // Outstanding = 23600 - 10000 = 13600
    assert.equal(ctx.dashboard.totalOutstandingReceivables, 13600);
  } finally {
    // Clean up test records so demo DB remains pristine
    db.prepare('DELETE FROM businesses WHERE id = ?').run(bizId);
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  }
});

test('HTTP auth login, signup, onboarding, and Bearer token verification work without cookies (iframe safe)', async () => {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  let createdUserId: string | null = null;
  let createdBizId: string | null = null;

  try {
    // 1. Invalid login returns 401
    const badRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'demo@sharmatraders.in', password: 'WrongPassword1' }),
    });
    assert.equal(badRes.status, 401);

    // 2. Demo login via email/password returns Bearer token & user
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'demo@sharmatraders.in', password: 'Demo@1234' }),
    });
    assert.equal(loginRes.status, 200);
    const loginData = (await loginRes.json()) as { token?: string; user: { email: string }; business: { name: string } };
    assert.ok(loginData.token);
    assert.equal(loginData.user.email, 'demo@sharmatraders.in');
    assert.equal(loginData.business.name, 'Sharma Wholesale Traders');

    // 3. /api/auth/me works solely with Authorization Bearer header (no cookies)
    const meRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${loginData.token}` },
    });
    assert.equal(meRes.status, 200);
    const meData = (await meRes.json()) as { authenticated: boolean; user: { email: string } };
    assert.equal(meData.authenticated, true);
    assert.equal(meData.user.email, 'demo@sharmatraders.in');

    // 4. Stale/invalid Bearer token on /api/auth/me gracefully returns authenticated: false (200)
    const staleMeRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: 'Bearer invalid.jwt.token' },
    });
    assert.equal(staleMeRes.status, 200);
    const staleMeData = (await staleMeRes.json()) as { authenticated: boolean };
    assert.equal(staleMeData.authenticated, false);

    // 5. Signup + Onboarding flow via Bearer tokens
    const testEmail = `auth_test_${crypto.randomUUID().slice(0, 8)}@example.com`;
    const signupRes = await fetch(`${baseUrl}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testEmail,
        password: 'Password@123',
        fullName: 'Auth Test Founder',
        consentMessaging: true,
        consentFinancialAi: true,
      }),
    });
    assert.equal(signupRes.status, 201);
    const signupData = (await signupRes.json()) as { token?: string; user: { id: string } };
    assert.ok(signupData.token);
    createdUserId = signupData.user.id;

    const onboardRes = await fetch(`${baseUrl}/api/business/onboarding`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${signupData.token}`,
      },
      body: JSON.stringify({
        name: 'Auth Test Traders',
        category: 'Wholesale & Distribution',
        email: testEmail,
        phone: '+91 9876543210',
        location: 'Jaipur, Rajasthan',
        currency: 'INR',
        openingCashBalance: 350000,
        typicalMonthlyExpenses: 90000,
      }),
    });
    assert.equal(onboardRes.status, 201);
    const onboardData = (await onboardRes.json()) as { token?: string; business: { id: string; name: string } };
    assert.ok(onboardData.token);
    assert.equal(onboardData.business.name, 'Auth Test Traders');
    createdBizId = onboardData.business.id;

    // 6. Isolated dashboard loads with Bearer token from onboarding and zero demo data
    const dashRes = await fetch(`${baseUrl}/api/dashboard`, {
      headers: { Authorization: `Bearer ${onboardData.token}` },
    });
    assert.equal(dashRes.status, 200);
    const dashData = (await dashRes.json()) as { business: { name: string }; metrics: { availableCashBalance: number; totalOutstandingReceivables: number } };
    assert.equal(dashData.business.name, 'Auth Test Traders');
    assert.equal(dashData.metrics.availableCashBalance, 350000);
    assert.equal(dashData.metrics.totalOutstandingReceivables, 0);

    // 7. Billing plans & Razorpay create-order + plan switch
    const plansRes = await fetch(`${baseUrl}/api/billing/plans`);
    assert.equal(plansRes.status, 200);
    const plansData = (await plansRes.json()) as {
      plans: Array<{ id: string; name: string; monthlyPriceInr: number; aiEnabled: boolean }>;
    };
    assert.deepEqual(
      plansData.plans.map((p) => ({
        id: p.id,
        name: p.name,
        price: p.monthlyPriceInr,
        aiEnabled: p.aiEnabled,
      })),
      [
        { id: 'free', name: 'Free', price: 0, aiEnabled: true },
        { id: 'growth', name: 'Growth', price: 499, aiEnabled: true },
        { id: 'business', name: 'Business', price: 4999, aiEnabled: true },
      ]
    );

    const orderRes = await fetch(`${baseUrl}/api/billing/create-order`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${onboardData.token}`,
      },
      body: JSON.stringify({ planId: 'business' }),
    });
    assert.equal(orderRes.status, 200);
    const orderData = (await orderRes.json()) as { orderId: string; amountPaise: number; amountInr: number };
    assert.ok(orderData.orderId);
    assert.equal(orderData.amountInr, 4999);
    assert.equal(orderData.amountPaise, 499900);

    const checkoutRes = await fetch(`${baseUrl}/api/billing/checkout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${onboardData.token}`,
      },
      body: JSON.stringify({
        planId: 'business',
        orderId: orderData.orderId,
        paymentMethod: 'upi',
        paymentDetail: 'success@razorpay',
      }),
    });
    assert.equal(checkoutRes.status, 200);
    const checkoutData = (await checkoutRes.json()) as {
      ok: boolean;
      subscription: { plan: { id: string; monthlyPriceInr: number } };
    };
    assert.equal(checkoutData.ok, true);
    assert.equal(checkoutData.subscription.plan.id, 'business');
    assert.equal(checkoutData.subscription.plan.monthlyPriceInr, 4999);

    // Switch down to Free (₹0)
    const freeRes = await fetch(`${baseUrl}/api/billing/checkout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${onboardData.token}`,
      },
      body: JSON.stringify({ planId: 'free', paymentMethod: 'free_tier' }),
    });
    assert.equal(freeRes.status, 200);
    const freeData = (await freeRes.json()) as { subscription: { plan: { id: string } } };
    assert.equal(freeData.subscription.plan.id, 'free');

    // 8. Hindi & Kannada recovery template generation
    const demoInvoices = getInvoicesByBusiness('demo-biz-sharma-0001');
    const overdueDemoInv = demoInvoices.find((i) => i.status === 'Overdue') ?? demoInvoices[0];
    const knTpl = buildStandardReminderTemplate({
      businessName: 'Sharma Wholesale Traders',
      invoice: overdueDemoInv,
      overdueDays: 7,
      outstandingAmount: 15000,
      category: '7 days overdue',
      language: 'kn',
    });
    assert.ok(knTpl.message.includes('ನಮಸ್ಕಾರ'));
    assert.ok(knTpl.message.includes(overdueDemoInv.invoiceNumber));

    const hiTpl = buildStandardReminderTemplate({
      businessName: 'Sharma Wholesale Traders',
      invoice: overdueDemoInv,
      overdueDays: 7,
      outstandingAmount: 15000,
      category: '7 days overdue',
      language: 'hi',
    });
    assert.ok(hiTpl.message.includes('नमस्ते'));
    assert.ok(hiTpl.message.includes(overdueDemoInv.invoiceNumber));
  } finally {
    if (createdBizId) {
      db.prepare('DELETE FROM businesses WHERE id = ?').run(createdBizId);
    }
    if (createdUserId) {
      db.prepare('DELETE FROM users WHERE id = ?').run(createdUserId);
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
