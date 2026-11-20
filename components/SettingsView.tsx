'use client';

import React, { useState } from 'react';
import { KeyRound, Loader2, LogOut, Play, Save, Server, ShieldCheck, Store } from 'lucide-react';
import { apiFetch } from '@/lib/api-client';
import type { AppSettings } from '@/lib/types';

interface SettingsViewProps {
  settings: AppSettings;
  user: { id: string; email: string; name: string };
  onSettingsUpdated: (settings: AppSettings) => void;
  onLogout: () => void;
  onToast: (message: string, type?: 'success' | 'error') => void;
}

export default function SettingsView({
  settings,
  user,
  onSettingsUpdated,
  onLogout,
  onToast,
}: SettingsViewProps) {
  const [storeName, setStoreName] = useState(settings.store.name);
  const [hindiName, setHindiName] = useState(settings.store.hindiName);
  const [websiteUrl, setWebsiteUrl] = useState(settings.store.websiteUrl);
  const [apiBaseUrl, setApiBaseUrl] = useState(settings.store.apiBaseUrl);
  const [supportPhone, setSupportPhone] = useState(settings.store.supportPhone);
  const [autoNotify, setAutoNotify] = useState(settings.store.autoNotifyOrderStages);
  const [syncInterval, setSyncInterval] = useState(settings.store.syncIntervalMinutes);
  const [savingStore, setSavingStore] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);

  const [testingGemini, setTestingGemini] = useState(false);
  const [geminiTestResult, setGeminiTestResult] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);

  async function handleTestGemini() {
    setTestingGemini(true);
    setGeminiTestResult(null);
    try {
      const res = await apiFetch('/api/ai/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: '919472258022',
          customerName: 'Settings Test',
          message: 'Pranam ji, kya Bihar me COD delivery milti hai?',
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        const errText = data.error || `HTTP ${res.status}`;
        setGeminiTestResult({ ok: false, text: errText });
        onToast(`Gemini AI test failed: ${errText}`, 'error');
        return;
      }
      setGeminiTestResult({ ok: true, text: data.reply });
      onToast('Gemini AI is working properly with live tools!', 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to reach /api/ai/test';
      setGeminiTestResult({ ok: false, text: msg });
      onToast(msg, 'error');
    } finally {
      setTestingGemini(false);
    }
  }

  async function handleSaveStore(e: React.FormEvent) {
    e.preventDefault();
    setSavingStore(true);
    try {
      const res = await apiFetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          store: {
            name: storeName,
            hindiName,
            websiteUrl,
            apiBaseUrl,
            supportPhone,
            autoNotifyOrderStages: autoNotify,
            syncIntervalMinutes: Number(syncInterval) || 5,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save store settings');
      onSettingsUpdated(data.settings);
      onToast('Store sync & notification preferences updated', 'success');
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Save failed', 'error');
    } finally {
      setSavingStore(false);
    }
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setSavingPassword(true);
    try {
      const res = await apiFetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Password update failed');
      setCurrentPassword('');
      setNewPassword('');
      onToast('Administrator password updated', 'success');
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Password update failed', 'error');
    } finally {
      setSavingPassword(false);
    }
  }

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Store & Sync Settings */}
      <section className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-6">
        <div className="flex items-center gap-2.5 pb-4 border-b border-slate-200 dark:border-slate-800">
          <Store className="w-4 h-4 text-emerald-600" />
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              Bihar Gramin Bazaar Store Integration
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Live endpoints for products.php, orders.php, and delivery stage WhatsApp alerts
            </p>
          </div>
        </div>

        <form onSubmit={handleSaveStore} className="mt-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Store Name
              </label>
              <input
                type="text"
                value={storeName}
                onChange={(e) => setStoreName(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Hindi Store Name
              </label>
              <input
                type="text"
                value={hindiName}
                onChange={(e) => setHindiName(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Website URL
              </label>
              <input
                type="url"
                value={websiteUrl}
                onChange={(e) => setWebsiteUrl(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                PHP API Base URL
              </label>
              <input
                type="url"
                value={apiBaseUrl}
                onChange={(e) => setApiBaseUrl(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Customer Care Helpline
              </label>
              <input
                type="text"
                value={supportPhone}
                onChange={(e) => setSupportPhone(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Scheduled Sync Interval (Minutes)
              </label>
              <input
                type="number"
                min={1}
                max={60}
                value={syncInterval}
                onChange={(e) => setSyncInterval(Number(e.target.value))}
                className="w-full px-3 py-2 text-sm font-mono tabular-nums rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
              />
            </div>
          </div>

          <label className="flex items-center gap-2.5 text-sm text-slate-700 dark:text-slate-300 pt-1 cursor-pointer">
            <input
              type="checkbox"
              checked={autoNotify}
              onChange={(e) => setAutoNotify(e.target.checked)}
              className="w-4 h-4 accent-emerald-600 rounded"
            />
            Automatically send WhatsApp updates when orders move to Dispatched, Out for Delivery, or
            Delivered
          </label>

          <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex justify-end">
            <button
              type="submit"
              disabled={savingStore}
              className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium flex items-center gap-1.5 transition-colors"
            >
              <Save className="w-3.5 h-3.5" />
              {savingStore ? 'Saving...' : 'Save Store Settings'}
            </button>
          </div>
        </form>
      </section>

      {/* Server Environment & Encrypted Vault Status */}
      <section className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-6">
        <div className="flex items-center gap-2.5 pb-4 border-b border-slate-200 dark:border-slate-800">
          <Server className="w-4 h-4 text-emerald-600" />
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              Server Secrets & Runtime Security
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              All AI and messaging keys remain strictly server-side and are never bundled to the
              browser
            </p>
          </div>
        </div>

        <div className="mt-4 divide-y divide-slate-100 dark:divide-slate-800 text-sm">
          <div className="py-3 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="font-medium text-slate-900 dark:text-white">Gemini AI Server Runtime</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Managed via server environment secret (GEMINI_API_KEY) · Model:{' '}
                  <span className="font-mono">{settings.ai.model || 'gemini-2.5-flash'}</span>
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span
                  className={`text-xs font-mono font-medium ${
                    settings.geminiConfigured
                      ? 'text-emerald-700 dark:text-emerald-400'
                      : 'text-amber-700 dark:text-amber-400'
                  }`}
                >
                  {settings.geminiConfigured ? 'Configured on Server' : 'Awaiting Server Secret'}
                </span>
                <button
                  type="button"
                  disabled={testingGemini}
                  onClick={handleTestGemini}
                  className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-xs font-medium flex items-center gap-1.5 whitespace-nowrap"
                >
                  {testingGemini ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Play className="w-3.5 h-3.5" />
                  )}
                  {testingGemini ? 'Testing...' : 'Test Gemini AI'}
                </button>
              </div>
            </div>
            {geminiTestResult && (
              <div
                className={`p-3 rounded-lg border text-xs whitespace-pre-wrap break-words ${
                  geminiTestResult.ok
                    ? 'bg-emerald-50/70 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900 text-emerald-900 dark:text-emerald-200'
                    : 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-900 text-red-800 dark:text-red-200 font-mono'
                }`}
              >
                {geminiTestResult.text}
              </div>
            )}
          </div>

          <div className="py-3 flex items-center justify-between gap-4">
            <div>
              <p className="font-medium text-slate-900 dark:text-white">
                Meta Cloud API Encrypted Vault
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                AES-256-GCM encrypted file store for App Secret and System User Token
              </p>
            </div>
            <span className="text-xs font-mono text-slate-600 dark:text-slate-400">
              Secret: {settings.meta.hasAppSecret ? settings.meta.maskedAppSecret : 'Not set'} ·
              Token: {settings.meta.hasAccessToken ? settings.meta.maskedAccessToken : 'Not set'}
            </span>
          </div>

          <div className="py-3 flex items-center justify-between gap-4">
            <div>
              <p className="font-medium text-slate-900 dark:text-white">Signed-in Administrator</p>
              <p className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                {user.name} · {user.email}
              </p>
            </div>
            <button
              type="button"
              onClick={onLogout}
              className="px-3.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium flex items-center gap-1.5"
            >
              <LogOut className="w-3.5 h-3.5" />
              Sign Out
            </button>
          </div>
        </div>
      </section>

      {/* Change Admin Password */}
      <section className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-6">
        <div className="flex items-center gap-2.5 pb-4 border-b border-slate-200 dark:border-slate-800">
          <KeyRound className="w-4 h-4 text-slate-500" />
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              Update Administrator Password
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Passwords are stored using salted bcrypt hashes
            </p>
          </div>
        </div>

        <form onSubmit={handleChangePassword} className="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Current Password
            </label>
            <input
              type="password"
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              New Password
            </label>
            <input
              type="password"
              required
              minLength={6}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
            />
          </div>
          <button
            type="submit"
            disabled={savingPassword}
            className="px-4 py-2 rounded-lg bg-slate-900 dark:bg-slate-700 hover:bg-slate-800 dark:hover:bg-slate-600 text-white text-xs font-medium flex items-center justify-center gap-1.5 h-[38px]"
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            {savingPassword ? 'Updating...' : 'Update Password'}
          </button>
        </form>
      </section>
    </div>
  );
}
