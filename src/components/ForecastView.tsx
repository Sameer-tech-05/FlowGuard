import React, { useEffect, useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { AlertCircle, AlertTriangle, Sparkles } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { formatINR } from '../lib/finance';
import { STRINGS } from '../lib/i18n';
import { useToast } from './Toast';
import type { CashFlowForecastResult, SupportedLanguage } from '../lib/types';

export function ForecastView({ language }: { language: SupportedLanguage }) {
  const { notify } = useToast();
  const t = STRINGS[language].forecast;
  const [horizon, setHorizon] = useState<7 | 30 | 90>(30);
  const [forecast, setForecast] = useState<CashFlowForecastResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [aiExplaining, setAiExplaining] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiExplanation, setAiExplanation] = useState<{
    summary: string;
    actionPlan: string[];
  } | null>(null);

  async function loadForecast(h: 7 | 30 | 90) {
    setLoading(true);
    setAiExplanation(null);
    setAiError(null);
    try {
      const res = await apiFetch<{ forecast: CashFlowForecastResult }>(`/api/forecasts?horizon=${h}`);
      setForecast(res.forecast);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to load forecast', 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadForecast(horizon);
  }, [horizon]);

  async function handleExplainAI() {
    setAiExplaining(true);
    setAiError(null);
    try {
      const res = await apiFetch<{ summary: string; actionPlan: string[] }>('/api/forecasts/explain', {
        method: 'POST',
        body: JSON.stringify({ horizonDays: horizon, language }),
      });
      setAiExplanation(res);
      notify('AI CFO forecast analysis ready.', 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'AI explanation failed';
      setAiError(msg);
      notify(msg, 'error');
    } finally {
      setAiExplaining(false);
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

        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            {([7, 30, 90] as const).map((h) => (
              <button
                key={h}
                type="button"
                onClick={() => setHorizon(h)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                  horizon === h ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {h} Days
              </button>
            ))}
          </div>
          <button
            type="button"
            disabled={aiExplaining || loading}
            onClick={handleExplainAI}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold px-4 py-2 transition-colors whitespace-nowrap disabled:opacity-60"
          >
            <Sparkles className="w-4 h-4" />
            <span>{aiExplaining ? t.analyzing : t.explainAi}</span>
          </button>
        </div>
      </div>

      {loading || !forecast ? (
        <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-500">
          Computing deterministic {horizon}-day projection...
        </div>
      ) : (
        <>
          {/* Summary Strip */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="text-xs font-semibold text-slate-500">Opening Cash Balance</div>
              <div className="mt-2 font-mono tabular-nums text-xl font-bold text-slate-900">
                {formatINR(forecast.openingBalance)}
              </div>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="text-xs font-semibold text-slate-500">Expected Cash Inflows</div>
              <div className="mt-2 font-mono tabular-nums text-xl font-bold text-emerald-700">
                +{formatINR(forecast.totalExpectedInflows)}
              </div>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="text-xs font-semibold text-slate-500">Expected Cash Outflows</div>
              <div className="mt-2 font-mono tabular-nums text-xl font-bold text-red-700">
                −{formatINR(forecast.totalExpectedOutflows)}
              </div>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="text-xs font-semibold text-slate-500">
                Projected Closing ({horizon}d · {forecast.confidence})
              </div>
              <div
                className={`mt-2 font-mono tabular-nums text-xl font-bold ${
                  forecast.projectedClosingBalance >= 0 ? 'text-emerald-700' : 'text-red-700'
                }`}
              >
                {formatINR(forecast.projectedClosingBalance)}
              </div>
            </div>
          </div>

          {/* Shortage Warnings */}
          {forecast.shortageAlerts.length > 0 && (
            <div className="space-y-2">
              {forecast.shortageAlerts.map((alert) => (
                <div
                  key={alert.date}
                  className="rounded-xl border border-red-200 bg-red-50 px-5 py-3.5 flex items-start gap-3"
                >
                  <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                  <div className="text-sm text-red-900">
                    <span className="font-bold">Cash Pressure Alert ({alert.date}): </span>
                    <span>{alert.reason}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* AI CFO Error */}
          {aiError && (
            <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-5 py-3.5 flex items-start gap-3 text-xs text-red-800">
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <span>{aiError}</span>
            </div>
          )}

          {/* AI CFO Explanation */}
          {aiExplanation && (
            <div className="bg-white border border-emerald-200 rounded-xl p-5 space-y-3">
              <div className="flex items-center gap-2 text-xs font-bold text-emerald-800">
                <Sparkles className="w-4 h-4" />
                <span>AI CFO Forecast Commentary (Grounded in Deterministic Figures)</span>
              </div>
              <p className="text-sm text-slate-800 leading-relaxed">{aiExplanation.summary}</p>
              {aiExplanation.actionPlan.length > 0 && (
                <div className="pt-2 border-t border-slate-100">
                  <div className="text-xs font-semibold text-slate-700 mb-1.5">Recommended Actions:</div>
                  <ul className="list-disc pl-5 space-y-1 text-sm text-slate-700">
                    {aiExplanation.actionPlan.map((step, i) => (
                      <li key={i}>{step}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Main Chart */}
          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <h3 className="font-display font-bold text-base text-slate-900 mb-4">
              Daily Projected Cash Curve ({horizon} Days)
            </h3>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={forecast.dailyPoints}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} minTickGap={16} />
                  <YAxis
                    tickFormatter={(v: number) =>
                      Math.abs(v) >= 100000 ? `₹${(v / 100000).toFixed(1)}L` : `₹${(v / 1000).toFixed(0)}k`
                    }
                    tick={{ fontSize: 12, fill: '#64748b' }}
                    width={64}
                  />
                  <Tooltip formatter={(val) => formatINR(Number(val ?? 0))} />
                  <ReferenceLine y={0} stroke="#dc2626" strokeDasharray="4 4" />
                  <Area
                    type="monotone"
                    dataKey="projectedBalance"
                    name="Projected Cash"
                    stroke="#0f172a"
                    fill="#cbd5e1"
                    fillOpacity={0.5}
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Transparent Assumptions + Scheduled Event Ledger */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-5">
              <h3 className="font-display font-bold text-sm text-slate-900 mb-3">
                Forecast Confidence & Assumptions
              </h3>
              <ul className="space-y-2 text-xs text-slate-600 leading-relaxed list-disc pl-4">
                {forecast.assumptions.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            </div>

            <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-5">
              <h3 className="font-display font-bold text-sm text-slate-900 mb-3">
                Scheduled Cash Events ({horizon}d Window)
              </h3>
              <div className="max-h-64 overflow-y-auto divide-y divide-slate-100 text-xs">
                {forecast.dailyPoints.filter((d) => d.events.length > 0).length === 0 ? (
                  <p className="py-6 text-center text-slate-500">
                    No scheduled inflows or outflows within this horizon.
                  </p>
                ) : (
                  forecast.dailyPoints
                    .filter((d) => d.events.length > 0)
                    .map((d) => (
                      <div key={d.date} className="py-2.5 flex items-start justify-between gap-4">
                        <div>
                          <div className="font-mono font-semibold text-slate-900">{d.date}</div>
                          <div className="text-slate-600 mt-0.5">{d.events.join(' · ')}</div>
                        </div>
                        <div className="text-right font-mono tabular-nums shrink-0">
                          {d.expectedInflow > 0 && (
                            <div className="text-emerald-700 font-semibold">
                              +{formatINR(d.expectedInflow)}
                            </div>
                          )}
                          {d.expectedOutflow > 0 && (
                            <div className="text-red-700 font-semibold">
                              −{formatINR(d.expectedOutflow)}
                            </div>
                          )}
                          <div className="text-slate-500">Bal: {formatINR(d.projectedBalance)}</div>
                        </div>
                      </div>
                    ))
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
