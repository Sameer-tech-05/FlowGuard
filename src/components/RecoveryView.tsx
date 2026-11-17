import React, { useEffect, useState } from 'react';
import { AlertCircle, Copy, Mail, MessageSquare, Sparkles, FileText } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { formatINR } from '../lib/finance';
import { STRINGS } from '../lib/i18n';
import { useToast } from './Toast';
import type {
  CustomerRiskSummary,
  Invoice,
  ReminderCategory,
  ReminderLog,
  SupportedLanguage,
} from '../lib/types';

interface QueueItem {
  invoice: Invoice;
  overdueDays: number;
  outstandingAmount: number;
  recommendedCategory: ReminderCategory;
  customerRisk: CustomerRiskSummary | null;
}

const CATEGORIES: ReminderCategory[] = [
  'Friendly reminder',
  'Payment due today',
  '3 days overdue',
  '7 days overdue',
  '15 days overdue',
  'Final professional reminder',
];

export function RecoveryView({ language }: { language: SupportedLanguage }) {
  const { notify } = useToast();
  const t = STRINGS[language].recovery;
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [logs, setLogs] = useState<ReminderLog[]>([]);
  const [loading, setLoading] = useState(true);

  const [selected, setSelected] = useState<QueueItem | null>(null);
  const [category, setCategory] = useState<ReminderCategory>('Friendly reminder');
  const [subject, setSubject] = useState('');
  const [messageText, setMessageText] = useState('');
  const [strategyNote, setStrategyNote] = useState('');
  const [generating, setGenerating] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const [responseLogId, setResponseLogId] = useState<string | null>(null);
  const [responseNote, setResponseNote] = useState('');

  async function loadQueue() {
    setLoading(true);
    try {
      const data = await apiFetch<{ queue: QueueItem[]; logs: ReminderLog[] }>('/api/recovery/overdue');
      setQueue(data.queue);
      setLogs(data.logs);
      if (data.queue.length > 0 && !selected) {
        const first = data.queue[0];
        setSelected(first);
        setCategory(first.recommendedCategory);
      }
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to load recovery queue', 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadQueue();
  }, []);

  function selectQueueItem(item: QueueItem) {
    setSelected(item);
    setCategory(item.recommendedCategory);
    setSubject('');
    setMessageText('');
    setStrategyNote('');
    setAiError(null);
  }

  async function handleGenerate(mode: 'ai' | 'template') {
    if (!selected) return;
    setGenerating(true);
    setAiError(null);
    try {
      const res = await apiFetch<{
        subject: string;
        message: string;
        strategyNote: string;
        source: string;
      }>('/api/recovery/generate', {
        method: 'POST',
        body: JSON.stringify({
          invoiceId: selected.invoice.id,
          category,
          language,
          mode,
        }),
      });
      setSubject(res.subject);
      setMessageText(res.message);
      setStrategyNote(res.strategyNote);
      notify(
        res.source === 'gemini_ai'
          ? 'AI payment reminder drafted. Review and approve before sending.'
          : `Standard ${language === 'kn' ? 'Kannada' : language === 'hi' ? 'Hindi' : 'English'} template loaded.`,
        'success'
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Reminder generation failed';
      setAiError(msg);
      notify(msg, 'error');
    } finally {
      setGenerating(false);
    }
  }

  async function handleApproveAndSend(channel: 'email' | 'whatsapp' | 'copy') {
    if (!selected || !messageText.trim()) {
      notify('Generate or write a reminder message first.', 'error');
      return;
    }
    if (channel === 'copy' && navigator.clipboard) {
      await navigator.clipboard.writeText(messageText).catch(() => {});
    }
    setSending(true);
    try {
      const res = await apiFetch<{ statusNote: string; deliveryStatus: string }>('/api/recovery/send', {
        method: 'POST',
        body: JSON.stringify({
          invoiceId: selected.invoice.id,
          category,
          language,
          channel,
          subject,
          messageText,
        }),
      });
      notify(res.statusNote, res.deliveryStatus === 'failed' ? 'error' : 'success');
      await loadQueue();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to dispatch reminder', 'error');
    } finally {
      setSending(false);
    }
  }

  async function saveCustomerResponse(logId: string) {
    try {
      await apiFetch(`/api/recovery/logs/${logId}`, {
        method: 'PATCH',
        body: JSON.stringify({ customerResponse: responseNote }),
      });
      notify('Customer response updated.', 'success');
      setResponseLogId(null);
      setResponseNote('');
      await loadQueue();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Update failed', 'error');
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-xl font-bold text-slate-900">
          {t.title}
        </h2>
        <p className="text-xs text-slate-500 mt-0.5">
          {t.subtitle}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Overdue & Open Receivables Queue */}
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col">
          <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
            <span className="text-xs font-bold text-slate-700">
              Open & Overdue Queue ({queue.length})
            </span>
          </div>
          {loading ? (
            <div className="p-6 text-sm text-slate-500">Loading overdue invoices...</div>
          ) : queue.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">
              No overdue or unpaid invoices requiring follow-up.
            </div>
          ) : (
            <div className="divide-y divide-slate-100 max-h-[520px] overflow-y-auto">
              {queue.map((item) => {
                const isSelected = selected?.invoice.id === item.invoice.id;
                return (
                  <button
                    key={item.invoice.id}
                    type="button"
                    onClick={() => selectQueueItem(item)}
                    className={`w-full text-left px-4 py-3.5 transition-colors ${
                      isSelected ? 'bg-slate-100' : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono font-bold text-sm text-slate-900">
                        {item.invoice.invoiceNumber}
                      </span>
                      <span
                        className={`text-xs font-mono font-semibold ${
                          item.overdueDays > 0 ? 'text-red-700' : 'text-amber-700'
                        }`}
                      >
                        {item.overdueDays > 0 ? `${item.overdueDays}d overdue` : `Due ${item.invoice.dueDate}`}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center justify-between text-xs">
                      <span className="text-slate-700 font-medium truncate pr-2">
                        {item.invoice.customerBusinessName}
                      </span>
                      <span className="font-mono tabular-nums font-bold text-slate-900">
                        {formatINR(item.outstandingAmount)}
                      </span>
                    </div>
                    {item.customerRisk && (
                      <div className="mt-1 text-xs text-slate-500">
                        {item.customerRisk.riskLevel} Risk · Avg delay {item.customerRisk.averagePaymentDelayDays}d
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Right: AI Follow-up Composer */}
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6 space-y-5">
          {!selected ? (
            <div className="py-12 text-center text-sm text-slate-500">
              Select an invoice from the queue to compose a payment reminder.
            </div>
          ) : (
            <>
              <div className="border-b border-slate-200 pb-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="font-display text-lg font-bold text-slate-900">
                      {selected.invoice.customerBusinessName} ({selected.invoice.customerName})
                    </h3>
                    <div className="text-xs text-slate-600 mt-0.5 font-mono">
                      {selected.invoice.invoiceNumber} · Due {selected.invoice.dueDate} · Balance{' '}
                      {formatINR(selected.outstandingAmount)}
                    </div>
                  </div>
                  <div
                    className={`text-xs font-semibold ${
                      selected.customerRisk?.riskLevel === 'High'
                        ? 'text-red-700'
                        : selected.customerRisk?.riskLevel === 'Medium'
                        ? 'text-amber-700'
                        : 'text-emerald-700'
                    }`}
                  >
                    {selected.customerRisk?.riskLevel ?? 'Low'} Risk Profile
                  </div>
                </div>
                {selected.customerRisk && (
                  <p className="mt-2 text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                    {selected.customerRisk.explanation}
                  </p>
                )}
              </div>

              <div>
                <label htmlFor="rec-cat" className="block text-xs font-semibold text-slate-700 mb-1">
                  {t.stageLabel}
                </label>
                <select
                  id="rec-cat"
                  value={category}
                  onChange={(e) => setCategory(e.target.value as ReminderCategory)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={generating}
                  onClick={() => handleGenerate('ai')}
                  className="inline-flex items-center gap-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold px-4 py-2.5 transition-colors disabled:opacity-60"
                >
                  <Sparkles className="w-4 h-4" />
                  <span>{generating ? t.drafting : t.generateAi}</span>
                </button>
                <button
                  type="button"
                  disabled={generating}
                  onClick={() => handleGenerate('template')}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-300 hover:bg-slate-50 text-slate-800 text-xs font-semibold px-4 py-2.5 transition-colors"
                >
                  <FileText className="w-4 h-4" />
                  <span>{t.loadTemplate}</span>
                </button>
              </div>

              {aiError && (
                <div role="alert" className="text-xs text-red-800 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 text-red-600 mt-0.5" />
                  <span>{aiError}</span>
                </div>
              )}

              {strategyNote && (
                <div className="text-xs text-slate-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                  <strong>Recommended Strategy:</strong> {strategyNote}
                </div>
              )}

              <div className="space-y-3">
                <div>
                  <label htmlFor="rec-subj" className="block text-xs font-semibold text-slate-700 mb-1">
                    Email Subject
                  </label>
                  <input
                    id="rec-subj"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder={`Payment Reminder: Invoice ${selected.invoice.invoiceNumber}`}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="rec-body" className="block text-xs font-semibold text-slate-700 mb-1">
                    Approved Message Preview (Editable before sending)
                  </label>
                  <textarea
                    id="rec-body"
                    rows={4}
                    value={messageText}
                    onChange={(e) => setMessageText(e.target.value)}
                    placeholder="Click 'Generate with Gemini AI' or 'Load Standard Template' above..."
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm leading-relaxed"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button
                  type="button"
                  disabled={sending || !messageText.trim()}
                  onClick={() => handleApproveAndSend('email')}
                  className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold px-4 py-2.5 disabled:opacity-50"
                >
                  <Mail className="w-4 h-4" />
                  <span>Approve & Send Email</span>
                </button>
                <button
                  type="button"
                  disabled={sending || !messageText.trim()}
                  onClick={() => handleApproveAndSend('whatsapp')}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-300 hover:bg-slate-50 text-slate-800 text-xs font-semibold px-4 py-2.5 disabled:opacity-50"
                >
                  <MessageSquare className="w-4 h-4" />
                  <span>WhatsApp Business</span>
                </button>
                <button
                  type="button"
                  disabled={sending || !messageText.trim()}
                  onClick={() => handleApproveAndSend('copy')}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-300 hover:bg-slate-50 text-slate-800 text-xs font-semibold px-4 py-2.5 disabled:opacity-50"
                >
                  <Copy className="w-4 h-4" />
                  <span>Copy & Log</span>
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Reminder History & Customer Response Log */}
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <h3 className="font-display font-bold text-base text-slate-900 mb-3">
          Reminder History & Customer Responses
        </h3>
        {logs.length === 0 ? (
          <div className="py-6 text-center text-sm text-slate-500">No reminders logged yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs font-semibold text-slate-500">
                  <th className="py-2 pr-3">Date</th>
                  <th className="py-2 px-3">Invoice</th>
                  <th className="py-2 px-3">Stage · Channel</th>
                  <th className="py-2 px-3">Delivery</th>
                  <th className="py-2 px-3">Message</th>
                  <th className="py-2 pl-3">Customer Response</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {logs.map((log) => (
                  <tr key={log.id} className="align-top">
                    <td className="py-3 pr-3 text-xs font-mono text-slate-600 whitespace-nowrap">
                      {log.sentAt.slice(0, 10)}
                    </td>
                    <td className="py-3 px-3">
                      <div className="font-mono font-semibold text-slate-900">{log.invoiceNumber}</div>
                      <div className="text-xs text-slate-500">{log.customerName}</div>
                    </td>
                    <td className="py-3 px-3 text-xs text-slate-700">
                      {log.category} · {log.channel.toUpperCase()} ({log.language.toUpperCase()})
                    </td>
                    <td className="py-3 px-3 text-xs font-semibold text-slate-700">
                      {log.deliveryStatus === 'sent_live'
                        ? 'Sent Live'
                        : log.deliveryStatus === 'copied'
                        ? 'Copied & Logged'
                        : 'Approved Preview'}
                    </td>
                    <td className="py-3 px-3 text-xs text-slate-600 max-w-xs">{log.messageText}</td>
                    <td className="py-3 pl-3 text-xs">
                      {responseLogId === log.id ? (
                        <div className="flex items-center gap-1.5">
                          <input
                            aria-label="Customer response note"
                            value={responseNote}
                            onChange={(e) => setResponseNote(e.target.value)}
                            placeholder="Promised payment date..."
                            className="rounded border border-slate-300 px-2 py-1 text-xs"
                          />
                          <button
                            type="button"
                            onClick={() => saveCustomerResponse(log.id)}
                            className="rounded bg-slate-900 text-white px-2 py-1 text-xs font-semibold"
                          >
                            Save
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-slate-700">
                            {log.customerResponse || 'No reply logged'}
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              setResponseLogId(log.id);
                              setResponseNote(log.customerResponse || '');
                            }}
                            className="text-xs font-semibold text-slate-700 underline whitespace-nowrap"
                          >
                            Log Reply
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
