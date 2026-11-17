import React, { useEffect, useState } from 'react';
import { AlertCircle, Send, Shield, Sparkles } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { STRINGS } from '../lib/i18n';
import { useToast } from './Toast';
import type { SupportedLanguage } from '../lib/types';

interface CopilotEntry {
  id: string;
  question: string;
  answer: string;
  sourceFigures: string[] | { sourceFigures?: string[]; assumptions?: string[] };
  assumptions?: string[];
  createdAt: string;
}

const SUGGESTED_QUESTIONS_BY_LANG: Record<SupportedLanguage, string[]> = {
  en: [
    'How much money will I have after 30 days?',
    'Which customers owe me the most?',
    'Which invoices should I follow up on today?',
    'Can I afford a ₹50,000 inventory purchase?',
    'Why is my cash flow decreasing?',
    'What expenses increased this month?',
  ],
  hi: [
    '30 दिनों के बाद मेरे पास कितना कैश होगा?',
    'किस ग्राहक पर सबसे ज़्यादा बकाया है?',
    'आज मुझे किन इनवॉइस का फॉलो-अप करना चाहिए?',
    'क्या मैं ₹50,000 का स्टॉक खरीद सकता हूँ?',
  ],
  kn: [
    '30 ದಿನಗಳ ನಂತರ ನನ್ನ ಬಳಿ ಎಷ್ಟು ನಗದು ಇರುತ್ತದೆ?',
    'ಯಾವ ಗ್ರಾಹಕರಿಂದ ಅತಿ ಹೆಚ್ಚು ಬಾಕಿ ಬರಬೇಕಿದೆ?',
    'ಇಂದು ನಾನು ಯಾವ ಇನ್‌ವಾಯ್ಸ್‌ಗಳನ್ನು ಫಾಲೋ-ಅಪ್ ಮಾಡಬೇಕು?',
    'ನಾನು ₹50,000 ದಾಸ್ತಾನು ಖರೀದಿಸಲು ಸಾಧ್ಯವೇ?',
  ],
};

export function CopilotView({ language }: { language: SupportedLanguage }) {
  const { notify } = useToast();
  const t = STRINGS[language].copilot;
  const [history, setHistory] = useState<CopilotEntry[]>([]);
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  async function loadHistory() {
    try {
      const res = await apiFetch<{ history: CopilotEntry[] }>('/api/copilot/history');
      setHistory(res.history);
    } catch {
      // ignore initial load error
    }
  }

  useEffect(() => {
    loadHistory();
  }, []);

  async function askQuestion(q: string) {
    const clean = q.trim();
    if (!clean) return;
    setAsking(true);
    setAiError(null);
    try {
      const res = await apiFetch<{
        id: string;
        answer: string;
        sourceFigures: string[];
        assumptions: string[];
      }>('/api/copilot/ask', {
        method: 'POST',
        body: JSON.stringify({ question: clean, language }),
      });

      setQuestion('');
      setHistory((prev) => [
        {
          id: res.id,
          question: clean,
          answer: res.answer,
          sourceFigures: res.sourceFigures,
          assumptions: res.assumptions,
          createdAt: new Date().toISOString(),
        },
        ...prev,
      ]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Copilot query failed';
      setAiError(msg);
      notify(msg, 'error');
    } finally {
      setAsking(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-xl font-bold text-slate-900">
            {t.title}
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            {t.subtitle}
          </p>
        </div>
        <div className="inline-flex items-center gap-1.5 text-xs text-slate-600 bg-white border border-slate-200 rounded-lg px-3 py-1.5">
          <Shield className="w-3.5 h-3.5 text-emerald-600" />
          <span>{t.readOnly}</span>
        </div>
      </div>

      {/* Composer */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            askQuestion(question);
          }}
          className="flex flex-col sm:flex-row gap-2.5"
        >
          <input
            aria-label="Ask AI Financial Copilot"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder={t.placeholder}
            className="flex-1 rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
          />
          <button
            type="submit"
            disabled={asking || !question.trim()}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold px-5 py-2.5 disabled:opacity-50 whitespace-nowrap"
          >
            <Send className="w-4 h-4" />
            <span>{asking ? t.analyzing : t.askButton}</span>
          </button>
        </form>

        {aiError && (
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-800 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
            <span>{aiError}</span>
          </div>
        )}

        <div>
          <div className="text-xs font-semibold text-slate-500 mb-2">{t.suggestedLabel}</div>
          <div className="flex flex-wrap gap-2">
            {SUGGESTED_QUESTIONS_BY_LANG[language].map((sq) => (
              <button
                key={sq}
                type="button"
                disabled={asking}
                onClick={() => askQuestion(sq)}
                className="text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg px-3 py-1.5 transition-colors text-left"
              >
                {sq}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Conversation History */}
      <div className="space-y-4">
        {history.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-sm text-slate-500">
            Select a prompt above or ask any question about your cash balance, receivables, or expenses.
          </div>
        ) : (
          history.map((item) => {
            const srcList = Array.isArray(item.sourceFigures)
              ? item.sourceFigures
              : item.sourceFigures?.sourceFigures ?? [];
            const assumpList =
              item.assumptions ??
              (!Array.isArray(item.sourceFigures) ? item.sourceFigures?.assumptions ?? [] : []);

            return (
              <div key={item.id} className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="font-display font-bold text-sm text-slate-900">
                    Q: {item.question}
                  </div>
                  <span className="text-xs font-mono text-slate-400 shrink-0">
                    {item.createdAt.slice(0, 10)}
                  </span>
                </div>
                <div className="text-sm text-slate-800 leading-relaxed whitespace-pre-line">
                  {item.answer}
                </div>

                {(srcList.length > 0 || assumpList.length > 0) && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-3 border-t border-slate-100 text-xs">
                    {srcList.length > 0 && (
                      <div className="bg-slate-50 rounded-lg p-3 border border-slate-200">
                        <div className="font-semibold text-slate-700 mb-1 flex items-center gap-1.5">
                          <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
                          <span>Verified Source Figures</span>
                        </div>
                        <ul className="space-y-1 font-mono text-slate-600">
                          {srcList.map((s, idx) => (
                            <li key={idx}>• {s}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {assumpList.length > 0 && (
                      <div className="bg-slate-50 rounded-lg p-3 border border-slate-200">
                        <div className="font-semibold text-slate-700 mb-1">Assumptions</div>
                        <ul className="space-y-1 text-slate-600">
                          {assumpList.map((a, idx) => (
                            <li key={idx}>• {a}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
