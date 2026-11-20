'use client';

import React, { useState } from 'react';
import { Bot, Play, Plus, RotateCcw, Save, Smartphone, Trash2 } from 'lucide-react';
import { apiFetch } from '@/lib/api-client';
import type { AiGlobalMode, AppSettings, KeywordQuickReply, ToolCallLog } from '@/lib/types';

interface AutomationViewProps {
  settings: AppSettings;
  defaultSystemPrompt: string;
  onSettingsUpdated: (settings: AppSettings) => void;
  onToast: (message: string, type?: 'success' | 'error') => void;
}

export default function AutomationView({
  settings,
  defaultSystemPrompt,
  onSettingsUpdated,
  onToast,
}: AutomationViewProps) {
  const [aiMode, setAiMode] = useState<AiGlobalMode>(
    settings.ai.mode || (settings.ai.enabled ? 'AUTO_ON' : 'MANUAL_ONLY')
  );
  const [model, setModel] = useState(settings.ai.model || 'gemini-4-hydrogen');
  const [temperature, setTemperature] = useState(settings.ai.temperature);
  const [systemPrompt, setSystemPrompt] = useState(settings.ai.systemPrompt);
  const [cooldown, setCooldown] = useState(settings.ai.handoverCooldownMinutes);
  const [hoursStart, setHoursStart] = useState(settings.ai.businessHoursStart);
  const [hoursEnd, setHoursEnd] = useState(settings.ai.businessHoursEnd);
  const afterHoursMessage = settings.ai.afterHoursMessage;
  const [keywordReplies, setKeywordReplies] = useState<KeywordQuickReply[]>(
    settings.keywordReplies
  );
  const [saving, setSaving] = useState(false);

  // New keyword form
  const [newLabel, setNewLabel] = useState('');
  const [newKeywords, setNewKeywords] = useState('');
  const [newReply, setNewReply] = useState('');

  // Live Gemini Tool-Calling Test Bench
  const [testPrompt, setTestPrompt] = useState('Pranam ji, jute bag ka rate aur COD delivery btao?');
  const [testPhone, setTestPhone] = useState('919472258022');
  const [testing, setTesting] = useState(false);
  const [testOutput, setTestOutput] = useState<{
    reply: string;
    nextState: string;
    toolCalls: ToolCallLog[];
  } | null>(null);

  async function handleSaveAll(e?: React.FormEvent) {
    if (e) e.preventDefault();
    setSaving(true);
    try {
      const res = await apiFetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ai: {
            mode: aiMode,
            enabled: aiMode !== 'MANUAL_ONLY',
            model,
            temperature: Number(temperature),
            systemPrompt,
            handoverCooldownMinutes: Number(cooldown) || 30,
            businessHoursOnly: aiMode === 'OUTSIDE_BUSINESS_HOURS',
            businessHoursStart: hoursStart,
            businessHoursEnd: hoursEnd,
            afterHoursMessage,
          },
          keywordReplies,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save automation rules');
      onSettingsUpdated(data.settings);
      onToast('Gemini AI automation & quick-reply rules saved', 'success');
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Save failed', 'error');
    } finally {
      setSaving(false);
    }
  }

  function addKeywordRule() {
    if (!newLabel.trim() || !newKeywords.trim() || !newReply.trim()) return;
    const rule: KeywordQuickReply = {
      id: `kw-${Date.now()}`,
      label: newLabel.trim(),
      keywords: newKeywords
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean),
      reply: newReply.trim(),
      enabled: true,
    };
    setKeywordReplies((prev) => [...prev, rule]);
    setNewLabel('');
    setNewKeywords('');
    setNewReply('');
  }

  async function runLiveGeminiTest(e: React.FormEvent) {
    e.preventDefault();
    if (!testPrompt.trim()) return;
    setTesting(true);
    setTestOutput(null);
    try {
      const res = await apiFetch('/api/ai/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: testPhone,
          message: testPrompt,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Gemini test failed');
      }
      setTestOutput({
        reply: data.reply,
        nextState: data.nextState,
        toolCalls: data.toolCalls || [],
      });
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Gemini test failed', 'error');
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        {/* Left: Core AI Engine & Prompt Configuration */}
        <form
          onSubmit={handleSaveAll}
          className="xl:col-span-7 bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-5"
        >
          <div className="pb-4 border-b border-slate-200 dark:border-slate-800 space-y-3">
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                Gemini AI Auto-Reply & Hybrid Handover
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Choose how Gemini AI coexists with your physical phone WhatsApp on the same number
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {(
                [
                  {
                    id: 'AUTO_ON',
                    title: 'AI Auto-Reply ON',
                    desc: 'AI replies 24×7; pauses automatically when you reply from phone',
                  },
                  {
                    id: 'OUTSIDE_BUSINESS_HOURS',
                    title: 'AI Only Outside Business Hours',
                    desc: 'You handle chats during IST business hours; AI takes over after hours',
                  },
                  {
                    id: 'MANUAL_ONLY',
                    title: 'Manual Only (AI OFF)',
                    desc: 'All chats stay manual with zero automatic AI replies',
                  },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setAiMode(opt.id)}
                  className={`p-3 rounded-lg border text-left transition-colors ${
                    aiMode === opt.id
                      ? 'border-emerald-600 bg-emerald-50/70 dark:bg-emerald-950/35'
                      : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-900'
                  }`}
                >
                  <p className="text-xs font-semibold text-slate-900 dark:text-white">
                    {opt.title}
                  </p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 leading-snug">
                    {opt.desc}
                  </p>
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Gemini Model
              </label>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
              >
                <option value="gemini-4-hydrogen">gemini-4-hydrogen (Recommended · Fast)</option>
                <option value="gemini-3.1-flash-lite">gemini-3.1-flash-lite (Ultra-Fast Lite)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Temperature ({temperature.toFixed(1)})
              </label>
              <input
                type="range"
                min={0}
                max={1}
                step={0.1}
                value={temperature}
                onChange={(e) => setTemperature(Number(e.target.value))}
                className="w-full accent-emerald-600 mt-2"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Phone / Admin Reply Pause (min)
              </label>
              <input
                type="number"
                min={1}
                max={1440}
                value={cooldown}
                onChange={(e) => setCooldown(Number(e.target.value))}
                className="w-full px-3 py-2 text-xs font-mono tabular-nums rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
              />
            </div>
          </div>

          {aiMode === 'OUTSIDE_BUSINESS_HOURS' && (
            <div className="p-4 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
              <p className="text-xs font-semibold text-slate-900 dark:text-white">
                IST Human Business Hours (AI stays silent during this window and auto-replies
                outside it)
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-500 mb-1">
                    Business Hours Start (IST)
                  </label>
                  <input
                    type="time"
                    value={hoursStart}
                    onChange={(e) => setHoursStart(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">
                    Business Hours End (IST)
                  </label>
                  <input
                    type="time"
                    value={hoursEnd}
                    onChange={(e) => setHoursEnd(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  />
                </div>
              </div>
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
                Bihar Gramin Bazaar System Prompt (Hindi / Hinglish / Bihari Persona)
              </label>
              <button
                type="button"
                onClick={() => setSystemPrompt(defaultSystemPrompt)}
                className="text-[11px] text-slate-500 hover:text-slate-900 dark:hover:text-white flex items-center gap-1"
              >
                <RotateCcw className="w-3 h-3" /> Reset Default
              </button>
            </div>
            <textarea
              rows={10}
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              className="w-full px-3.5 py-2.5 text-xs leading-relaxed rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 focus:outline-none focus:border-emerald-600"
            />
          </div>

          {/* Phone Remote Control Commands Reference */}
          <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-2.5">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-900 dark:text-white">
              <Smartphone className="w-4 h-4 text-emerald-600" />
              Phone WhatsApp Remote Control Commands
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
              <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800">
                <p className="font-mono font-semibold text-amber-700 dark:text-amber-400">
                  #manual / #stop
                </p>
                <p className="text-slate-600 dark:text-slate-400 mt-1">
                  Send in any customer chat from your phone to pause AI indefinitely for that
                  customer.
                </p>
              </div>
              <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800">
                <p className="font-mono font-semibold text-emerald-700 dark:text-emerald-400">
                  #ai / #start
                </p>
                <p className="text-slate-600 dark:text-slate-400 mt-1">
                  Send in any customer chat from your phone to immediately turn Gemini AI back ON.
                </p>
              </div>
            </div>
          </div>

          <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium flex items-center gap-1.5 transition-colors"
            >
              <Save className="w-3.5 h-3.5" />
              {saving ? 'Saving...' : 'Save Automation Settings'}
            </button>
          </div>
        </form>

        {/* Right: Live Gemini Tool-Calling Test Bench */}
        <section className="xl:col-span-5 bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-6 flex flex-col">
          <div className="pb-4 border-b border-slate-200 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <Bot className="w-4 h-4 text-emerald-600" />
              <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                Live Gemini Tool-Calling Tester
              </h2>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Calls real server-side Gemini AI with live search_products, place_order, and
              check_order_status tools against bihargraminbazaar.com.
            </p>
          </div>

          <form onSubmit={runLiveGeminiTest} className="mt-4 space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Test Customer Phone (for order lookup context)
              </label>
              <input
                type="text"
                value={testPhone}
                onChange={(e) => setTestPhone(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Customer Message (Hindi / Hinglish / English)
              </label>
              <textarea
                rows={3}
                value={testPrompt}
                onChange={(e) => setTestPrompt(e.target.value)}
                placeholder="e.g. Jute shopping bag kitne ka hai? Patna me COD milega?"
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
              />
            </div>

            <div className="flex flex-wrap gap-1.5">
              {[
                'Jute bag ka rate aur stock bataiye?',
                'Patna me COD aur delivery charge kitna lagta hai?',
                'Mera order status check kar dijiye',
              ].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setTestPrompt(preset)}
                  className="px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 text-[11px] text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  {preset}
                </button>
              ))}
            </div>

            <button
              type="submit"
              disabled={testing}
              className="w-full py-2.5 px-4 rounded-lg bg-slate-900 dark:bg-emerald-600 hover:bg-slate-800 dark:hover:bg-emerald-700 disabled:opacity-60 text-white text-xs font-medium flex items-center justify-center gap-1.5 transition-colors"
            >
              <Play className="w-3.5 h-3.5" />
              {testing ? 'Running Gemini AI + Live Tools...' : 'Run Live AI Test'}
            </button>
          </form>

          {testOutput && (
            <div className="mt-5 pt-4 border-t border-slate-200 dark:border-slate-800 space-y-3 flex-1">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-slate-700 dark:text-slate-300">
                  Gemini Response
                </span>
                <span className="font-mono text-emerald-700 dark:text-emerald-400">
                  Next State: {testOutput.nextState}
                </span>
              </div>
              <div className="p-3.5 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs whitespace-pre-wrap leading-relaxed text-slate-800 dark:text-slate-200">
                {testOutput.reply}
              </div>
              {testOutput.toolCalls.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-[11px] font-medium text-slate-500">Live Tools Invoked</p>
                  {testOutput.toolCalls.map((tc, idx) => (
                    <div
                      key={`${tc.name}-${idx}`}
                      className="p-2.5 rounded border border-slate-200 dark:border-slate-800 text-[11px] font-mono text-slate-600 dark:text-slate-400"
                    >
                      <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                        {tc.name}
                      </span>{' '}
                      → {tc.resultSummary}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>
      </div>

      {/* Keyword Quick-Replies Builder */}
      <section className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              Keyword Quick-Replies
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Instant zero-latency replies for COD, Delivery, Offers, and Customer Care (+91
              9472258022)
            </p>
          </div>
          <button
            type="button"
            disabled={saving}
            onClick={() => handleSaveAll()}
            className="px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium flex items-center gap-1.5 whitespace-nowrap"
          >
            <Save className="w-3.5 h-3.5" /> Save Rules
          </button>
        </div>

        <div className="divide-y divide-slate-200 dark:divide-slate-800">
          {keywordReplies.map((rule) => (
            <div key={rule.id} className="py-4 flex flex-col md:flex-row md:items-start gap-4">
              <div className="flex-1 space-y-1.5">
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 text-sm font-medium text-slate-900 dark:text-white cursor-pointer">
                    <input
                      type="checkbox"
                      checked={rule.enabled}
                      onChange={(e) =>
                        setKeywordReplies((prev) =>
                          prev.map((r) =>
                            r.id === rule.id ? { ...r, enabled: e.target.checked } : r
                          )
                        )
                      }
                      className="w-4 h-4 accent-emerald-600 rounded"
                    />
                    {rule.label}
                  </label>
                  <span className="text-xs font-mono text-slate-500">
                    Triggers: {rule.keywords.join(', ')}
                  </span>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400 whitespace-pre-wrap">
                  {rule.reply}
                </p>
              </div>
              <button
                type="button"
                onClick={() =>
                  setKeywordReplies((prev) => prev.filter((r) => r.id !== rule.id))
                }
                className="p-2 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 self-start"
                aria-label="Delete rule"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>

        {/* Add New Keyword Rule */}
        <div className="pt-4 border-t border-slate-200 dark:border-slate-800 grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
          <div className="md:col-span-3">
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Rule Name
            </label>
            <input
              type="text"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="e.g. Return Policy"
              className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
            />
          </div>
          <div className="md:col-span-3">
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Keywords (comma-separated)
            </label>
            <input
              type="text"
              value={newKeywords}
              onChange={(e) => setNewKeywords(e.target.value)}
              placeholder="return, replace, वापसी"
              className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
            />
          </div>
          <div className="md:col-span-4">
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Automated Reply Text
            </label>
            <input
              type="text"
              value={newReply}
              onChange={(e) => setNewReply(e.target.value)}
              placeholder="7 दिन की आसान रिप्लेसमेंट गारंटी उपलब्ध है..."
              className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
            />
          </div>
          <div className="md:col-span-2">
            <button
              type="button"
              onClick={addKeywordRule}
              className="w-full py-2 px-3 rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium flex items-center justify-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" /> Add Rule
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
