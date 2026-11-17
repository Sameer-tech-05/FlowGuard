import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { addDaysISO, calculateInvoiceTotals, resolveInvoiceStatus } from '../src/lib/finance';
import type { ExpenseCategory } from '../src/lib/types';

const DATA_DIR = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'flowguard.db');
export const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function initDatabase(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      full_name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'member', 'admin')),
      email_verified INTEGER NOT NULL DEFAULT 0,
      verification_code TEXT,
      reset_token TEXT,
      consent_messaging INTEGER NOT NULL DEFAULT 0,
      consent_financial_ai INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS businesses (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT NOT NULL,
      location TEXT NOT NULL,
      currency TEXT NOT NULL DEFAULT 'INR',
      gstin TEXT,
      opening_cash_balance REAL NOT NULL DEFAULT 0,
      typical_monthly_expenses REAL NOT NULL DEFAULT 0,
      is_demo INTEGER NOT NULL DEFAULT 0,
      onboarding_completed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS business_memberships (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'member',
      created_at TEXT NOT NULL,
      UNIQUE (business_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      business_name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT NOT NULL,
      gstin TEXT,
      payment_terms_days INTEGER NOT NULL DEFAULT 15,
      is_simulated INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_customers_business ON customers(business_id);

    CREATE TABLE IF NOT EXISTS invoices (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
      invoice_number TEXT NOT NULL,
      issue_date TEXT NOT NULL,
      due_date TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('Draft', 'Sent', 'Partially Paid', 'Paid', 'Overdue', 'Cancelled')),
      subtotal REAL NOT NULL DEFAULT 0,
      discount_amount REAL NOT NULL DEFAULT 0,
      gst_amount REAL NOT NULL DEFAULT 0,
      total_amount REAL NOT NULL DEFAULT 0,
      paid_amount REAL NOT NULL DEFAULT 0,
      notes TEXT,
      payment_link_token TEXT UNIQUE,
      is_simulated INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      UNIQUE (business_id, invoice_number)
    );
    CREATE INDEX IF NOT EXISTS idx_invoices_business_status ON invoices(business_id, status);
    CREATE INDEX IF NOT EXISTS idx_invoices_due_date ON invoices(business_id, due_date);

    CREATE TABLE IF NOT EXISTS invoice_items (
      id TEXT PRIMARY KEY,
      invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
      description TEXT NOT NULL,
      hsn_sac TEXT,
      quantity REAL NOT NULL,
      unit_price REAL NOT NULL,
      gst_rate REAL NOT NULL DEFAULT 18,
      line_total REAL NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_invoice_items_inv ON invoice_items(invoice_id);

    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
      amount REAL NOT NULL CHECK (amount > 0),
      payment_date TEXT NOT NULL,
      method TEXT NOT NULL,
      reference_id TEXT,
      webhook_event_id TEXT UNIQUE,
      notes TEXT,
      is_simulated INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_payments_business ON payments(business_id, payment_date);

    CREATE TABLE IF NOT EXISTS expenses (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      vendor_name TEXT NOT NULL,
      category TEXT NOT NULL,
      amount REAL NOT NULL CHECK (amount >= 0),
      expense_date TEXT NOT NULL,
      due_date TEXT,
      status TEXT NOT NULL DEFAULT 'Paid' CHECK (status IN ('Paid', 'Pending', 'Scheduled')),
      receipt_name TEXT,
      notes TEXT,
      is_simulated INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_expenses_business ON expenses(business_id, expense_date);

    CREATE TABLE IF NOT EXISTS recurring_expenses (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      vendor_name TEXT NOT NULL,
      category TEXT NOT NULL,
      amount REAL NOT NULL CHECK (amount >= 0),
      frequency TEXT NOT NULL CHECK (frequency IN ('Weekly', 'Monthly', 'Quarterly')),
      next_due_date TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      is_simulated INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS reminder_templates (
      id TEXT PRIMARY KEY,
      business_id TEXT REFERENCES businesses(id) ON DELETE CASCADE,
      category TEXT NOT NULL,
      language TEXT NOT NULL,
      subject TEXT NOT NULL,
      body_template TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS reminder_logs (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
      customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      category TEXT NOT NULL,
      language TEXT NOT NULL,
      channel TEXT NOT NULL,
      delivery_status TEXT NOT NULL,
      message_text TEXT NOT NULL,
      customer_response TEXT,
      sent_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_reminder_logs_business ON reminder_logs(business_id, sent_at);

    CREATE TABLE IF NOT EXISTS forecast_snapshots (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      horizon_days INTEGER NOT NULL,
      opening_balance REAL NOT NULL,
      projected_inflow REAL NOT NULL,
      projected_outflow REAL NOT NULL,
      projected_closing_balance REAL NOT NULL,
      shortage_detected INTEGER NOT NULL DEFAULT 0,
      ai_summary TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ai_conversations (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      question TEXT NOT NULL,
      answer TEXT NOT NULL,
      source_figures_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS subscription_plans (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      tagline TEXT NOT NULL,
      monthly_price_inr REAL NOT NULL,
      invoice_limit_per_month INTEGER NOT NULL,
      features_json TEXT NOT NULL,
      ai_enabled INTEGER NOT NULL DEFAULT 0,
      whatsapp_enabled INTEGER NOT NULL DEFAULT 0,
      team_seats INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS subscriptions (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      plan_id TEXT NOT NULL REFERENCES subscription_plans(id),
      status TEXT NOT NULL DEFAULT 'active',
      mode TEXT NOT NULL DEFAULT 'test',
      current_period_start TEXT NOT NULL,
      current_period_end TEXT NOT NULL,
      razorpay_subscription_id TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS billing_history (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      plan_id TEXT NOT NULL,
      amount_inr REAL NOT NULL,
      status TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'test',
      razorpay_payment_id TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      business_id TEXT REFERENCES businesses(id) ON DELETE SET NULL,
      user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      resource_type TEXT NOT NULL,
      resource_id TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
  `);

  seedSubscriptionPlans();
  seedDemoBusiness();
}

function seedSubscriptionPlans(): void {
  const migrateTx = db.transaction(() => {
    const upsertPlan = db.prepare(`
      INSERT INTO subscription_plans (id, name, tagline, monthly_price_inr, invoice_limit_per_month, features_json, ai_enabled, whatsapp_enabled, team_seats)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        tagline = excluded.tagline,
        monthly_price_inr = excluded.monthly_price_inr,
        invoice_limit_per_month = excluded.invoice_limit_per_month,
        features_json = excluded.features_json,
        ai_enabled = excluded.ai_enabled,
        whatsapp_enabled = excluded.whatsapp_enabled,
        team_seats = excluded.team_seats
    `);

    upsertPlan.run(
      'free',
      'Free',
      'For solo founders & freelancers getting started',
      0,
      50,
      JSON.stringify([
        'Up to 50 invoices / month',
        'Customer directory & GST invoicing',
        'Expense & receipt tracking',
        'AI Payment Recovery, Forecast & Copilot (EN/HI/KN)',
        'Standard EN/HI/KN reminder templates',
      ]),
      1,
      0,
      1
    );

    upsertPlan.run(
      'growth',
      'Growth',
      'For growing wholesalers, agencies & MSMEs',
      499,
      300,
      JSON.stringify([
        'Up to 300 invoices / month',
        '7/30/90-day AI cash flow forecasting',
        'AI payment reminder generation (EN/HI/KN)',
        'Explainable customer payment risk scoring',
        'AI Financial Copilot with database grounding',
        'PDF & CSV analytics reports',
      ]),
      1,
      0,
      3
    );

    upsertPlan.run(
      'business',
      'Business',
      'For scaling operations & multi-user finance teams',
      4999,
      2000,
      JSON.stringify([
        'Up to 2,000 invoices / month',
        'Advanced cash shortage early-warning',
        'Up to 10 team member seats',
        'AI Financial Copilot (EN/HI/KN)',
        'WhatsApp Business Cloud API integration',
        'Priority support & audit exports',
      ]),
      1,
      1,
      10
    );

    // Migrate legacy plan IDs after new plans exist to satisfy foreign keys
    db.prepare(`UPDATE subscriptions SET plan_id = 'free' WHERE plan_id = 'starter'`).run();
    db.prepare(`UPDATE subscriptions SET plan_id = 'business' WHERE plan_id = 'business_pro'`).run();
    db.prepare(`UPDATE billing_history SET plan_id = 'free' WHERE plan_id = 'starter'`).run();
    db.prepare(`UPDATE billing_history SET plan_id = 'business' WHERE plan_id = 'business_pro'`).run();
    db.prepare(`UPDATE billing_history SET amount_inr = 4999 WHERE plan_id = 'business' AND razorpay_payment_id = 'pay_test_demo_001'`).run();
    db.prepare(`DELETE FROM subscription_plans WHERE id IN ('starter', 'business_pro')`).run();
  });
  migrateTx();
}

export function seedDemoBusiness(): void {
  const existingDemo = db
    .prepare('SELECT id FROM businesses WHERE is_demo = 1 LIMIT 1')
    .get() as { id: string } | undefined;
  if (existingDemo) return;

  const todayISO = new Date().toISOString().slice(0, 10);
  const nowISO = new Date().toISOString();

  const demoUserId = 'demo-user-sharma-0001';
  const adminUserId = 'admin-user-flowguard-0001';
  const demoBusinessId = 'demo-biz-sharma-0001';

  const demoPassHash = bcrypt.hashSync('Demo@1234', 10);
  const adminPassHash = bcrypt.hashSync('Admin@1234', 10);

  const tx = db.transaction(() => {
    db.prepare(`
      INSERT OR IGNORE INTO users (id, email, password_hash, full_name, role, email_verified, consent_messaging, consent_financial_ai, created_at)
      VALUES (?, ?, ?, ?, ?, 1, 1, 1, ?)
    `).run(demoUserId, 'demo@sharmatraders.in', demoPassHash, 'Rajesh Sharma', 'owner', nowISO);

    db.prepare(`
      INSERT OR IGNORE INTO users (id, email, password_hash, full_name, role, email_verified, consent_messaging, consent_financial_ai, created_at)
      VALUES (?, ?, ?, ?, ?, 1, 1, 1, ?)
    `).run(adminUserId, 'admin@flowguard.in', adminPassHash, 'FlowGuard Platform Admin', 'admin', nowISO);

    db.prepare(`
      INSERT INTO businesses (id, owner_id, name, category, email, phone, location, currency, gstin, opening_cash_balance, typical_monthly_expenses, is_demo, onboarding_completed, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'INR', ?, ?, ?, 1, 1, ?)
    `).run(
      demoBusinessId,
      demoUserId,
      'Sharma Wholesale Traders',
      'FMCG & Kirana Wholesale Distribution',
      'accounts@sharmatraders.in',
      '+91 98110 45210',
      'Okhla Industrial Area, New Delhi',
      '07AABCS1429B1Z5',
      1250000,
      365000,
      nowISO
    );

    db.prepare(`
      INSERT INTO business_memberships (id, business_id, user_id, role, created_at)
      VALUES (?, ?, ?, 'owner', ?)
    `).run(crypto.randomUUID(), demoBusinessId, demoUserId, nowISO);

    db.prepare(`
      INSERT INTO subscriptions (id, business_id, plan_id, status, mode, current_period_start, current_period_end, razorpay_subscription_id, created_at)
      VALUES (?, ?, 'business', 'active', 'test', ?, ?, 'sub_test_demo_sharma', ?)
    `).run(crypto.randomUUID(), demoBusinessId, nowISO, addDaysISO(todayISO, 30), nowISO);

    db.prepare(`
      INSERT INTO billing_history (id, business_id, plan_id, amount_inr, status, mode, razorpay_payment_id, created_at)
      VALUES (?, ?, 'business', 4999, 'paid', 'test', 'pay_test_demo_001', ?)
    `).run(crypto.randomUUID(), demoBusinessId, nowISO);

    // 25 realistic Indian customers across NCR & North India
    const customerSeeds = [
      ['Rahul Verma', 'Verma Supermart Pvt Ltd', 'rahul@vermasupermart.in', '+91 98112 34001', '07AAACV2234K1Z2', 15],
      ['Sunita Agarwal', 'Agarwal Kirana Bhandar', 'sunita@agarwalkirana.in', '+91 98112 34002', '07AABCA4412M1Z8', 15],
      ['Vikram Malhotra', 'Malhotra Provision Stores', 'vikram@malhotrastores.in', '+91 98112 34003', '09AABCM8831L1Z4', 30],
      ['Deepak Bansal', 'Bansal Mega Mart', 'deepak@bansalmegamart.in', '+91 98112 34004', '07AAACB5519P1Z1', 15],
      ['Meena Joshi', 'Joshi Cash & Carry', 'meena@joshicashcarry.in', '+91 98112 34005', '06AAADJ9012N1Z7', 21],
      ['Arjun Kapoor', 'Kapoor Hospitality Supplies', 'arjun@kapoorhospitality.in', '+91 98112 34006', '07AAACK3310E1Z9', 30],
      ['Priya Nair', 'FreshBasket Retail LLP', 'priya@freshbasket.in', '+91 98112 34007', '07AABCF7721G1Z3', 15],
      ['Suresh Yadav', 'Yadav Distributors Gurgaon', 'suresh@yadavdist.in', '+91 98112 34008', '06AAACY1109D1Z6', 15],
      ['Kavita Mittal', 'Mittal Grocers & Departmental', 'kavita@mittalgrocers.in', '+91 98112 34009', '07AAACM9845Q1Z5', 15],
      ['Manoj Tiwari', 'Tiwari Daily Needs', 'manoj@tiwarineeds.in', '+91 98112 34010', null, 15],
      ['Neha Saxena', 'Saxena Catering & Foods', 'neha@saxenafoods.in', '+91 98112 34011', '09AAACS4401R1Z2', 30],
      ['Amitabh Jain', 'Jain Brothers Trading Co', 'amit@jainbrothers.in', '+91 98112 34012', '07AAACJ6621T1Z0', 15],
      ['Ritu Chauhan', 'Chauhan Mini Mart', 'ritu@chauhanmart.in', '+91 98112 34013', null, 15],
      ['Karan Mehta', 'Mehta Retail Hub Noida', 'karan@mehtahub.in', '+91 98112 34014', '09AAACM2281F1Z8', 21],
      ['Pooja Sethi', 'Sethi Bakers & Confectionery', 'pooja@sethibakers.in', '+91 98112 34015', '07AAACS5590B1Z4', 15],
      ['Harish Khatri', 'Khatri Wholesale Depot', 'harish@khatridepot.in', '+91 98112 34016', '06AAACK8812H1Z1', 30],
      ['Anjali Khanna', 'Khanna Family Bazaar', 'anjali@khannabazaar.in', '+91 98112 34017', '07AAACK4477C1Z7', 15],
      ['Nitin Goel', 'Goel Agro & Grains', 'nitin@goelgrains.in', '+91 98112 34018', '09AAACG7712M1Z3', 15],
      ['Swati Kulkarni', 'Annapurna Tiffin Services', 'swati@annapurnatiffins.in', '+91 98112 34019', null, 15],
      ['Rohan Bhatia', 'Bhatia Express Retail', 'rohan@bhatiaexpress.in', '+91 98112 34020', '07AAACB9921J1Z6', 21],
      ['Gaurav Singhal', 'Singhal Sweet House', 'gaurav@singhalsweets.in', '+91 98112 34021', '07AAACS3391K1Z9', 15],
      ['Seema Arora', 'Arora General Store', 'seema@arorastore.in', '+91 98112 34022', null, 15],
      ['Vivek Pandey', 'Pandey Foods & Beverages', 'vivek@pandeyfoods.in', '+91 98112 34023', '09AAACP1108L1Z5', 30],
      ['Divya Tandon', 'Tandon Modern Bazaar', 'divya@tandonbazaar.in', '+91 98112 34024', '07AAACT6629N1Z2', 15],
      ['Sanjay Rawat', 'Rawat Hotel Suppliers', 'sanjay@rawathotels.in', '+91 98112 34025', '06AAACR8842P1Z8', 30],
    ] as const;

    const customerIds: string[] = [];
    const insertCust = db.prepare(`
      INSERT INTO customers (id, business_id, name, business_name, email, phone, gstin, payment_terms_days, is_simulated, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    `);

    for (let i = 0; i < customerSeeds.length; i++) {
      const [name, bizName, email, phone, gstin, terms] = customerSeeds[i];
      const cid = `demo-cust-${String(i + 1).padStart(3, '0')}`;
      customerIds.push(cid);
      insertCust.run(cid, demoBusinessId, name, bizName, email, phone, gstin, terms, addDaysISO(todayISO, -180));
    }

    const catalogItems = [
      ['Basmati Rice 25kg Premium Sack', '1006', 1850, 5],
      ['Fortune Mustard Oil 15L Tin', '1514', 2280, 5],
      ['Toor Dal Grade-A 50kg Bag', '0713', 6400, 0],
      ['Tata Salt 1kg Pack (Carton of 50)', '2501', 1150, 0],
      ['Refined Sugar M-30 50kg Bag', '1701', 2150, 5],
      ['Packaged Biscuits & Snacks Assorted Case', '1905', 1480, 18],
      ['Detergent Powder Commercial 25kg', '3402', 2650, 18],
      ['Aashirvaad Whole Wheat Atta 50kg', '1101', 1980, 5],
    ] as const;

    const insertInv = db.prepare(`
      INSERT INTO invoices (id, business_id, customer_id, invoice_number, issue_date, due_date, status, subtotal, discount_amount, gst_amount, total_amount, paid_amount, notes, payment_link_token, is_simulated, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    `);
    const insertInvItem = db.prepare(`
      INSERT INTO invoice_items (id, invoice_id, description, hsn_sac, quantity, unit_price, gst_rate, line_total)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertPay = db.prepare(`
      INSERT INTO payments (id, business_id, invoice_id, amount, payment_date, method, reference_id, notes, is_simulated, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    `);

    // Generate 60 realistic invoices across 6 months (-175 days to today)
    // Design intentional risk profiles:
    // - Customers 0, 2, 5, 10, 15, 22 have late/overdue patterns
    // - Several invoices are partially paid, several overdue (3d, 7d, 15d, 28d overdue), and several upcoming due in 10-22 days
    const paymentMethods = ['UPI', 'NEFT/RTGS', 'Bank Transfer', 'Cheque', 'Razorpay Test'] as const;

    for (let i = 0; i < 60; i++) {
      const custIndex = i % customerIds.length;
      const customerId = customerIds[custIndex];
      const invId = `demo-inv-${String(i + 1).padStart(3, '0')}`;
      const invNumber = `INV-${1001 + i}`;

      // Spread across 175 days: earlier 42 invoices mostly historical, 43..59 recent/open
      let issueOffsetDays: number;
      if (i < 42) {
        issueOffsetDays = -175 + Math.round((i / 42) * 130); // -175 to -45
      } else if (i < 53) {
        issueOffsetDays = -42 + (i - 42) * 3; // -42 to -12 (some overdue!)
      } else {
        issueOffsetDays = -10 + (i - 53); // -10 to -3 (upcoming due dates)
      }

      const issueDate = addDaysISO(todayISO, issueOffsetDays);
      const termsDays = customerSeeds[custIndex][5];
      const dueDate = addDaysISO(issueDate, termsDays);

      const itemA = catalogItems[i % catalogItems.length];
      const itemB = catalogItems[(i + 3) % catalogItems.length];
      const qtyA = 6 + ((i * 3) % 14);
      const qtyB = 4 + ((i * 5) % 10);
      const discount = i % 5 === 0 ? 500 : 0;

      const itemsInput = [
        { description: itemA[0], hsnSac: itemA[1], quantity: qtyA, unitPrice: itemA[2], gstRate: itemA[3] },
        { description: itemB[0], hsnSac: itemB[1], quantity: qtyB, unitPrice: itemB[2], gstRate: itemB[3] },
      ];
      const totals = calculateInvoiceTotals(itemsInput, discount);

      const isHighDelayCust = [0, 2, 5, 10, 15, 22].includes(custIndex);
      let paidAmount = 0;
      let status: 'Draft' | 'Sent' | 'Partially Paid' | 'Paid' | 'Overdue' | 'Cancelled' = 'Sent';
      let pendingPay: {
        amount: number;
        date: string;
        method: string;
        ref: string;
        note: string;
      } | null = null;

      if (i < 42) {
        if (i === 38 || i === 41) {
          paidAmount = Math.round(totals.totalAmount * 0.4);
          status = 'Partially Paid';
        } else {
          paidAmount = totals.totalAmount;
          status = 'Paid';
          const delayDays = isHighDelayCust ? 18 + (i % 10) : (i % 4 === 0 ? 7 : 0);
          const payDate = addDaysISO(dueDate, delayDays);
          pendingPay = {
            amount: paidAmount,
            date: payDate <= todayISO ? payDate : todayISO,
            method: paymentMethods[i % paymentMethods.length],
            ref: `UTR${20260000 + i}`,
            note: 'Settled via simulated ledger',
          };
        }
      } else if (i < 53) {
        if (i === 43 || i === 47 || i === 50) {
          paidAmount = totals.totalAmount;
          status = 'Paid';
          pendingPay = {
            amount: paidAmount,
            date: addDaysISO(dueDate, isHighDelayCust ? 4 : -1),
            method: paymentMethods[i % paymentMethods.length],
            ref: `UTR${20260000 + i}`,
            note: 'Invoice settled',
          };
        } else if (i === 44 || i === 48) {
          paidAmount = Math.round(totals.totalAmount * 0.45);
          status = 'Partially Paid';
          pendingPay = {
            amount: paidAmount,
            date: addDaysISO(dueDate, -2),
            method: 'UPI',
            ref: `UPI${991000 + i}`,
            note: 'Partial advance received',
          };
        } else {
          paidAmount = 0;
          status = 'Sent';
        }
      } else if (i === 59) {
        status = 'Draft';
      } else if (i === 54 || i === 56) {
        paidAmount = Math.round(totals.totalAmount * 0.35);
        status = 'Partially Paid';
        pendingPay = {
          amount: paidAmount,
          date: addDaysISO(todayISO, -1),
          method: 'NEFT/RTGS',
          ref: `UTR${20269000 + i}`,
          note: 'Initial tranche received',
        };
      }

      // Force a few key overdue invoices so recovery queue always has 3d, 7d, 15d, 25d+ overdue items
      let adjustedDueDate = dueDate;
      if (i === 42) adjustedDueDate = addDaysISO(todayISO, -28);
      if (i === 45) adjustedDueDate = addDaysISO(todayISO, -16);
      if (i === 46) adjustedDueDate = addDaysISO(todayISO, -9);
      if (i === 49) adjustedDueDate = addDaysISO(todayISO, -4);
      if (i === 51) adjustedDueDate = addDaysISO(todayISO, -7);
      if (i === 52) adjustedDueDate = addDaysISO(todayISO, -19);
      if (i >= 53 && i <= 58) {
        // Upcoming due dates AFTER supplier payout spike (day +12 to +24)
        adjustedDueDate = addDaysISO(todayISO, 12 + (i - 53) * 2);
      }

      const resolvedStatus = resolveInvoiceStatus(
        { status, totalAmount: totals.totalAmount, paidAmount, dueDate: adjustedDueDate },
        todayISO
      );

      insertInv.run(
        invId,
        demoBusinessId,
        customerId,
        invNumber,
        issueDate,
        adjustedDueDate,
        resolvedStatus,
        totals.subtotal,
        totals.discountApplied,
        totals.gstAmount,
        totals.totalAmount,
        paidAmount,
        resolvedStatus === 'Overdue' ? 'Follow up on wholesale credit terms' : 'Standard wholesale GST supply',
        `paytok_${invNumber.toLowerCase()}`,
        issueDate
      );

      totals.computedItems.forEach((ci, idx) => {
        const raw = itemsInput[idx];
        insertInvItem.run(
          crypto.randomUUID(),
          invId,
          raw.description,
          raw.hsnSac,
          raw.quantity,
          raw.unitPrice,
          raw.gstRate,
          ci.lineTotal
        );
      });

      if (pendingPay) {
        insertPay.run(
          crypto.randomUUID(),
          demoBusinessId,
          invId,
          pendingPay.amount,
          pendingPay.date,
          pendingPay.method,
          pendingPay.ref,
          pendingPay.note,
          nowISO
        );
      }

      if ((i === 38 || i === 41) && paidAmount > 0) {
        insertPay.run(
          crypto.randomUUID(),
          demoBusinessId,
          invId,
          paidAmount,
          addDaysISO(adjustedDueDate, 3),
          'UPI',
          `UPI${77000 + i}`,
          'Part payment received',
          nowISO
        );
      }
    }

    // 6 months of historical expenses + upcoming pending supplier bills designed to demonstrate realistic working capital pressure
    const insertExp = db.prepare(`
      INSERT INTO expenses (id, business_id, title, vendor_name, category, amount, expense_date, due_date, status, receipt_name, notes, is_simulated, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    `);

    const monthlyExpenseTemplates: Array<[string, string, ExpenseCategory, number]> = [
      ['Okhla Warehouse Rent', 'Delhi Industrial Estates', 'Rent', 68000],
      ['Staff & Delivery Payroll', 'Internal Payroll', 'Salaries', 142000],
      ['Bulk Grain & Oil Stock Purchase', 'Kaveri Agro Mills', 'Inventory', 245000],
      ['Freight & Tempo Logistics', 'North India Transport', 'Logistics', 34500],
      ['Electricity & Cold Storage', 'BSES Rajdhani Power', 'Utilities', 18500],
      ['GST & Accounting Compliance', 'Mehta & Associates CA', 'Taxes', 24000],
      ['Local Retailer Trade Schemes', 'Trade Promotion', 'Marketing', 16000],
      ['ERP & Billing Software', 'Zoho / Tally Cloud', 'Software', 6500],
    ];

    for (let m = 5; m >= 0; m--) {
      const monthOffset = -m * 30;
      monthlyExpenseTemplates.forEach(([title, vendor, cat, baseAmt], idx) => {
        const expDate = addDaysISO(todayISO, monthOffset - (20 - idx * 2));
        // Keep current month slightly varied
        const variance = m === 0 && cat === 'Inventory' ? 1.15 : 1 + ((m + idx) % 3) * 0.04;
        const amount = Math.round(baseAmt * variance);
        const isPendingCurrent = m === 0 && idx === 2;
        if (expDate <= todayISO && !isPendingCurrent) {
          insertExp.run(
            crypto.randomUUID(),
            demoBusinessId,
            title,
            vendor,
            cat,
            amount,
            expDate,
            expDate,
            'Paid',
            `receipt_${cat.toLowerCase()}_${m}.pdf`,
            'Simulated historical operating expense',
            nowISO
          );
        }
      });
    }

    // Add large upcoming supplier & payroll bills in next 6-10 days to trigger realistic cash shortage forecast warning!
    insertExp.run(
      crypto.randomUUID(),
      demoBusinessId,
      'Festival Stock Replenishment (Mustard Oil & Rice)',
      'Kaveri Agro Mills Pvt Ltd',
      'Inventory',
      620000,
      todayISO,
      addDaysISO(todayISO, 6),
      'Pending',
      'po_kaveri_nov.pdf',
      'Critical supplier payment deadline before customer invoices mature',
      nowISO
    );

    insertExp.run(
      crypto.randomUUID(),
      demoBusinessId,
      'Monthly Warehouse & Fleet Salaries',
      'Sharma Traders Payroll',
      'Salaries',
      185000,
      todayISO,
      addDaysISO(todayISO, 9),
      'Scheduled',
      null,
      'Fixed payroll commitment',
      nowISO
    );

    // Recurring expenses
    const insertRec = db.prepare(`
      INSERT INTO recurring_expenses (id, business_id, title, vendor_name, category, amount, frequency, next_due_date, active, is_simulated, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?)
    `);
    insertRec.run(crypto.randomUUID(), demoBusinessId, 'Okhla Godown Monthly Lease', 'Delhi Industrial Estates', 'Rent', 68000, 'Monthly', addDaysISO(todayISO, 14), nowISO);
    insertRec.run(crypto.randomUUID(), demoBusinessId, 'Warehouse & Driver Payroll', 'Internal Payroll', 'Salaries', 142000, 'Monthly', addDaysISO(todayISO, 28), nowISO);
    insertRec.run(crypto.randomUUID(), demoBusinessId, 'Fleet Diesel & Tempo Retainer', 'North India Transport', 'Logistics', 22000, 'Weekly', addDaysISO(todayISO, 5), nowISO);
    insertRec.run(crypto.randomUUID(), demoBusinessId, 'Cold Storage & Power Bill', 'BSES Rajdhani Power', 'Utilities', 18500, 'Monthly', addDaysISO(todayISO, 18), nowISO);

    // Sample reminder logs
    db.prepare(`
      INSERT INTO reminder_logs (id, business_id, invoice_id, customer_id, category, language, channel, delivery_status, message_text, customer_response, sent_at)
      VALUES (?, ?, ?, ?, ?, 'en', 'email', 'preview_only', ?, ?, ?)
    `).run(
      crypto.randomUUID(),
      demoBusinessId,
      'demo-inv-043',
      customerIds[42 % customerIds.length],
      '15 days overdue',
      'Hello, this is a polite reminder regarding your overdue invoice with Sharma Wholesale Traders. Please share an expected UTR/payment date.',
      'Customer promised NEFT transfer by Friday.',
      addDaysISO(todayISO, -2) + 'T10:30:00Z'
    );
  });

  tx();
}

export function logAudit(params: {
  businessId?: string | null;
  userId?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  metadata?: Record<string, unknown>;
}): void {
  db.prepare(`
    INSERT INTO audit_logs (id, business_id, user_id, action, resource_type, resource_id, metadata_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    crypto.randomUUID(),
    params.businessId ?? null,
    params.userId ?? null,
    params.action,
    params.resourceType,
    params.resourceId ?? null,
    JSON.stringify(params.metadata ?? {}),
    new Date().toISOString()
  );
}
