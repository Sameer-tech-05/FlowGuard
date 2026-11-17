# FlowGuard AI — Working Capital, Payment Recovery & Cash Flow Forecasting SaaS

FlowGuard AI helps Indian wholesalers, MSMEs, agencies, and founders collect invoice payments faster, detect upcoming cash shortages, and manage working capital intelligently.

## Architecture Overview

- **Frontend**: React 19, TypeScript, Tailwind CSS v4, Recharts, Lucide Icons, jsPDF
- **Backend**: Express (`server.ts`) with JWT HttpOnly cookie sessions, bcryptjs password hashing, rate limiting, and business-scoped authorization middleware
- **Database**: SQLite (`better-sqlite3`, auto-initialized in `data/flowguard.db`) for zero-config local execution, plus full PostgreSQL + Supabase Row Level Security migration SQL in `supabase/migrations/001_initial_schema.sql`
- **AI Engine**: Server-side `@google/genai` (`gemini-4-hydrogen`) powering bilingual English/Hindi payment recovery drafts, forecast explanations, and the database-grounded AI Financial Copilot
- **Payments & Messaging**: Razorpay Test Mode payment links & subscription billing (`Starter ₹499`, `Growth ₹999`, `Business Pro ₹1,999`), plus optional Resend Email & Meta WhatsApp Business Cloud API integration with explicit preview/copy fallbacks when credentials are absent

## Local Setup & Running

1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy environment template and configure secrets as needed:
   ```bash
   cp .env.example .env
   ```
   - `GEMINI_API_KEY`: Required for live AI reminder generation, forecast commentary, and AI Copilot.
   - `RESEND_API_KEY` / `WHATSAPP_ACCESS_TOKEN`: Optional; without them, reminders run in transparent **Approved Preview / Copy** mode and never claim a message was sent externally.
   - `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET`: Optional; without them, checkout runs in **Razorpay Test Mode**.
3. Run unit & integration tests:
   ```bash
   npx --yes tsx --test src/lib/finance.test.ts server/api.test.ts
   ```
4. Start the full-stack server on port 3000:
   ```bash
   npm run dev
   ```
5. Open `http://localhost:3000` and click **Launch Investor Demo** for **Sharma Wholesale Traders** (25 customers, 60 invoices, overdue receivables, partial payments, and 6 months of simulated transactions), or sign up to create an isolated workspace.
   - Platform Admin login: `admin@flowguard.in` / `Admin@1234` (or click **Sign in as Platform Admin** on the sign-in screen).
