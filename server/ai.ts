import { GoogleGenAI, ThinkingLevel, Type, type GenerateContentParameters } from '@google/genai';
import type {
  CashFlowForecastResult,
  CustomerRiskSummary,
  Invoice,
  ReminderCategory,
  SupportedLanguage,
} from '../src/lib/types';
import { formatINR } from '../src/lib/finance';

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error(
      'GEMINI_API_KEY is not configured in Settings > Secrets. Please add a valid Gemini API key to run live AI generation.'
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function parseGeminiErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err || 'AI service error');
  try {
    const parsed = JSON.parse(raw) as { error?: { message?: string; status?: string; code?: number } };
    if (parsed?.error?.message) {
      return parsed.error.message;
    }
  } catch {
    // not JSON
  }
  return raw;
}

function isTransientError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err || '');
  const status = (err as { status?: number })?.status;
  if (status === 429 || status === 500 || status === 503 || status === 504) return true;
  return /503|429|UNAVAILABLE|RESOURCE_EXHAUSTED|high demand|overloaded|timed out|timeout|aborted|ECONNRESET/i.test(
    msg
  );
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function callModelWithTimeout(
  ai: GoogleGenAI,
  params: {
    model: string;
    thinkingLevel: ThinkingLevel;
    contents: string;
    responseSchema: NonNullable<GenerateContentParameters['config']>['responseSchema'];
    timeoutMs: number;
  }
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('Gemini request timed out')), params.timeoutMs);
  try {
    return await Promise.race([
      ai.models.generateContent({
        model: params.model,
        contents: params.contents,
        config: {
          abortSignal: controller.signal,
          responseMimeType: 'application/json',
          responseSchema: params.responseSchema,
          thinkingConfig: { thinkingLevel: params.thinkingLevel },
        },
      }),
      new Promise<never>((_, reject) => {
        controller.signal.addEventListener(
          'abort',
          () => reject(new Error('Gemini request timed out')),
          { once: true }
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function generateStructuredJSON<T>(params: {
  contents: string;
  responseSchema: NonNullable<GenerateContentParameters['config']>['responseSchema'];
}): Promise<T> {
  const ai = getGeminiClient();

  // Prioritize low-latency gemini-3.1-flash-lite so interactive UI actions complete in ~1.5-3.5s,
  // with retry and gemini-4-hydrogen fallback on transient upstream errors.
  const attempts: Array<{ model: string; thinkingLevel: ThinkingLevel; timeoutMs: number; delayMs: number }> = [
    { model: 'gemini-3.1-flash-lite', thinkingLevel: ThinkingLevel.MINIMAL, timeoutMs: 12000, delayMs: 0 },
    { model: 'gemini-3.1-flash-lite', thinkingLevel: ThinkingLevel.MINIMAL, timeoutMs: 15000, delayMs: 500 },
    { model: 'gemini-4-hydrogen', thinkingLevel: ThinkingLevel.LOW, timeoutMs: 15000, delayMs: 0 },
  ];

  let lastErr: unknown = null;

  for (const attempt of attempts) {
    if (attempt.delayMs > 0) {
      await sleep(attempt.delayMs);
    }
    try {
      const response = await callModelWithTimeout(ai, {
        model: attempt.model,
        thinkingLevel: attempt.thinkingLevel,
        contents: params.contents,
        responseSchema: params.responseSchema,
        timeoutMs: attempt.timeoutMs,
      });
      const text = (response.text ?? '{}').trim();
      return JSON.parse(text) as T;
    } catch (err) {
      lastErr = err;
      if (!isTransientError(err)) {
        break;
      }
    }
  }

  throw new Error(parseGeminiErrorMessage(lastErr));
}

function getLanguageInstruction(language: SupportedLanguage): string {
  if (language === 'hi') {
    return 'Hindi (polite Devanagari script mixed naturally with standard Indian business numbers/invoice codes/₹ figures)';
  }
  if (language === 'kn') {
    return 'Kannada (polite, natural Kannada script — ಕನ್ನಡ ಲಿಪಿ — mixed naturally with standard Indian business numbers/invoice codes/₹ figures)';
  }
  return 'English (professional Indian B2B tone)';
}

export async function generatePaymentReminderAI(params: {
  businessName: string;
  invoice: Invoice;
  overdueDays: number;
  outstandingAmount: number;
  customerRisk: CustomerRiskSummary | undefined;
  category: ReminderCategory;
  language: SupportedLanguage;
}): Promise<{ subject: string; message: string; strategyNote: string }> {
  const { businessName, invoice, overdueDays, outstandingAmount, customerRisk, category, language } = params;
  const langLabel = getLanguageInstruction(language);

  const prompt = `
You are an expert B2B collections advisor for an Indian MSME named "${businessName}".
Draft a respectful, firm, and constructive payment follow-up message. Never use threats, harassment, or legal intimidation.

Details:
- Customer Contact: ${invoice.customerName ?? 'Valued Customer'} (${invoice.customerBusinessName ?? ''})
- Invoice Number: ${invoice.invoiceNumber}
- Due Date: ${invoice.dueDate}
- Overdue Days: ${overdueDays} days
- Outstanding Balance: ${formatINR(outstandingAmount)}
- Total Invoice Value: ${formatINR(invoice.totalAmount)}
- Customer Risk Context: ${customerRisk ? `${customerRisk.riskLevel} Risk — ${customerRisk.explanation}` : 'Standard history'}
- Reminder Stage: ${category}
- Output Language for "subject", "message", and "strategyNote": ${langLabel}

Return JSON with:
1. "subject": concise email subject line in ${language === 'kn' ? 'Kannada' : language === 'hi' ? 'Hindi' : 'English'}
2. "message": ready-to-send WhatsApp/Email body in ${language === 'kn' ? 'Kannada' : language === 'hi' ? 'Hindi' : 'English'} (2-4 sentences, including invoice number, exact INR amount, due date, and polite request for payment date/UTR)
3. "strategyNote": 1-sentence advice in ${language === 'kn' ? 'Kannada' : language === 'hi' ? 'Hindi' : 'English'} explaining why this tone fits the customer's payment history
`;

  const parsed = await generateStructuredJSON<{
    subject?: string;
    message?: string;
    strategyNote?: string;
  }>({
    contents: prompt,
    responseSchema: {
      type: Type.OBJECT,
      properties: {
        subject: { type: Type.STRING },
        message: { type: Type.STRING },
        strategyNote: { type: Type.STRING },
      },
      required: ['subject', 'message', 'strategyNote'],
    },
  });

  if (!parsed.message) {
    throw new Error('Gemini returned an empty reminder response.');
  }

  return {
    subject: parsed.subject || `Payment Reminder: ${invoice.invoiceNumber}`,
    message: parsed.message,
    strategyNote: parsed.strategyNote || `Matched ${category} tone to customer history.`,
  };
}

export async function explainCashFlowForecastAI(params: {
  businessName: string;
  forecast: CashFlowForecastResult;
  topOverdueInvoices: Array<{ invoiceNumber: string; customerName: string; balance: number; overdueDays: number }>;
  language?: SupportedLanguage;
}): Promise<{ summary: string; actionPlan: string[] }> {
  const { businessName, forecast, topOverdueInvoices, language = 'en' } = params;
  const langLabel = getLanguageInstruction(language);

  const prompt = `
You are a CFO advisor for "${businessName}". Explain this deterministic cash flow forecast clearly.
STRICT RULE: Only cite the exact numbers provided below. Do NOT invent or alter any rupee figures.
Output Language for "summary" and every item in "actionPlan": ${langLabel}

Deterministic ${forecast.horizonDays}-Day Forecast:
- Opening Cash Balance: ${formatINR(forecast.openingBalance)}
- Expected Cash Inflows: ${formatINR(forecast.totalExpectedInflows)}
- Expected Cash Outflows: ${formatINR(forecast.totalExpectedOutflows)}
- Projected Closing Balance: ${formatINR(forecast.projectedClosingBalance)}
- Confidence Level: ${forecast.confidence}
- Shortage Alerts: ${forecast.shortageAlerts.length > 0 ? forecast.shortageAlerts.map((s) => `${s.date}: shortage ${formatINR(s.shortageAmount)} (${s.reason})`).join('; ') : 'None detected'}
- Top Overdue Invoices: ${topOverdueInvoices.map((o) => `${o.invoiceNumber} (${o.customerName}, ${formatINR(o.balance)}, ${o.overdueDays}d overdue)`).join('; ') || 'None'}

Return JSON with:
- "summary": 2-3 clear sentences explaining why cash moves this way and highlighting any shortage date, written in ${language === 'kn' ? 'Kannada script' : language === 'hi' ? 'Hindi Devanagari script' : 'English'}.
- "actionPlan": 3 concrete, actionable working-capital steps referencing the exact invoices or expenses above, written in ${language === 'kn' ? 'Kannada script' : language === 'hi' ? 'Hindi Devanagari script' : 'English'}.
`;

  const parsed = await generateStructuredJSON<{
    summary?: string;
    actionPlan?: string[];
  }>({
    contents: prompt,
    responseSchema: {
      type: Type.OBJECT,
      properties: {
        summary: { type: Type.STRING },
        actionPlan: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
        },
      },
      required: ['summary', 'actionPlan'],
    },
  });

  if (!parsed.summary) {
    throw new Error('Gemini returned an empty forecast explanation.');
  }

  return {
    summary: parsed.summary,
    actionPlan: parsed.actionPlan ?? [],
  };
}

export async function askFinancialCopilotAI(params: {
  businessName: string;
  question: string;
  contextSnapshot: Record<string, unknown>;
  language?: SupportedLanguage;
}): Promise<{ answer: string; sourceFigures: string[]; assumptions: string[] }> {
  const { businessName, question, contextSnapshot, language = 'en' } = params;
  const langLabel = getLanguageInstruction(language);

  const prompt = `
You are FlowGuard AI Financial Copilot for "${businessName}".
Answer the business owner's question ONLY using the verified database snapshot below.
NEVER invent figures, NEVER claim to execute payments or alter records, and ALWAYS list the exact source figures and assumptions used.
Output Language for "answer", "sourceFigures", and "assumptions": ${langLabel}

Authenticated Business Financial Snapshot (JSON):
${JSON.stringify(contextSnapshot, null, 2)}

User Question:
"${question}"

Return JSON with:
- "answer": clear, concise, practical financial answer written in ${language === 'kn' ? 'Kannada script' : language === 'hi' ? 'Hindi Devanagari script' : 'English'} (with ₹ formatting).
- "sourceFigures": array of 2-5 exact figures pulled from the snapshot above, labeled in ${language === 'kn' ? 'Kannada' : language === 'hi' ? 'Hindi' : 'English'}.
- "assumptions": array of 1-3 transparent calculation assumptions in ${language === 'kn' ? 'Kannada' : language === 'hi' ? 'Hindi' : 'English'}.
`;

  const parsed = await generateStructuredJSON<{
    answer?: string;
    sourceFigures?: string[];
    assumptions?: string[];
  }>({
    contents: prompt,
    responseSchema: {
      type: Type.OBJECT,
      properties: {
        answer: { type: Type.STRING },
        sourceFigures: { type: Type.ARRAY, items: { type: Type.STRING } },
        assumptions: { type: Type.ARRAY, items: { type: Type.STRING } },
      },
      required: ['answer', 'sourceFigures', 'assumptions'],
    },
  });

  if (!parsed.answer) {
    throw new Error('Gemini returned an empty copilot answer.');
  }

  return {
    answer: parsed.answer,
    sourceFigures: parsed.sourceFigures ?? [],
    assumptions: parsed.assumptions ?? [],
  };
}

