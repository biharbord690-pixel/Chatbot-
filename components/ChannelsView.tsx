'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  KeyRound,
  Loader2,
  LogOut,
  MessageSquare,
  Phone,
  QrCode,
  RefreshCw,
  Save,
  Shield,
  Smartphone,
  Terminal,
} from 'lucide-react';
import { apiFetch } from '@/lib/api-client';
import type { AppSettings, BaileysStateSnapshot, ChannelLogEntry } from '@/lib/types';

interface ChannelsViewProps {
  baileys: BaileysStateSnapshot;
  logs: ChannelLogEntry[];
  settings: AppSettings | null;
  onBaileysUpdate: (snapshot: BaileysStateSnapshot) => void;
  onLogsUpdate: (logs: ChannelLogEntry[]) => void;
  onRefreshStatus: () => void;
  onSettingsUpdated: (settings: AppSettings) => void;
  onToast: (message: string, type?: 'success' | 'error') => void;
}

function getReadableStatus(status: BaileysStateSnapshot['status']): {
  label: string;
  toneClass: string;
  dotClass: string;
} {
  switch (status) {
    case 'CONNECTED':
      return {
        label: 'Connected',
        toneClass: 'text-emerald-700 dark:text-emerald-400',
        dotClass: 'bg-emerald-500',
      };
    case 'QR_READY':
      return {
        label: 'QR Ready - Scan Now',
        toneClass: 'text-amber-700 dark:text-amber-400',
        dotClass: 'bg-amber-500',
      };
    case 'CONNECTING':
      return {
        label: 'Generating QR...',
        toneClass: 'text-amber-700 dark:text-amber-400',
        dotClass: 'bg-amber-500',
      };
    default:
      return {
        label: 'Disconnected',
        toneClass: 'text-slate-600 dark:text-slate-400',
        dotClass: 'bg-slate-400',
      };
  }
}

function formatPairingCode(code: string): string {
  const clean = code.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  if (clean.length === 8) {
    return `${clean.slice(0, 4)}-${clean.slice(4)}`;
  }
  return code;
}

function MetaCloudConfigCard({
  settings,
  onSettingsUpdated,
  onToast,
}: {
  settings: AppSettings | null;
  onSettingsUpdated: (settings: AppSettings) => void;
  onToast: (message: string, type?: 'success' | 'error') => void;
}) {
  const meta = settings?.meta;
  const [metaEnabled, setMetaEnabled] = useState(meta?.enabled ?? false);
  const [appId, setAppId] = useState(meta?.appId ?? '1521339533384901');
  const [configId, setConfigId] = useState(meta?.configId ?? '1132291603061911');
  const [verifyToken, setVerifyToken] = useState(
    meta?.verifyToken ?? 'bgb_whatsapp_verify_token_2026'
  );
  const [phoneNumberId, setPhoneNumberId] = useState(meta?.phoneNumberId ?? '');
  const [wabaId, setWabaId] = useState(meta?.wabaId ?? '');
  const [apiVersion, setApiVersion] = useState(meta?.apiVersion ?? 'v21.0');
  const [appSecret, setAppSecret] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [savingMeta, setSavingMeta] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const webhookUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/api/webhooks/meta`
      : '/api/webhooks/meta';

  async function handleSaveMeta(e: React.FormEvent) {
    e.preventDefault();
    setSavingMeta(true);
    try {
      const res = await apiFetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          meta: {
            enabled: metaEnabled,
            appId,
            configId,
            verifyToken,
            phoneNumberId,
            wabaId,
            apiVersion,
            ...(appSecret.trim() ? { appSecret: appSecret.trim() } : {}),
            ...(accessToken.trim() ? { accessToken: accessToken.trim() } : {}),
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save Meta settings');
      onSettingsUpdated(data.settings);
      setAppSecret('');
      setAccessToken('');
      onToast('Meta Cloud API configuration saved securely on server', 'success');
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Save failed', 'error');
    } finally {
      setSavingMeta(false);
    }
  }

  function copyWebhookUrl() {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(webhookUrl).then(() => {
        setCopiedUrl(true);
        setTimeout(() => setCopiedUrl(false), 1800);
      });
    }
  }

  return (
    <section className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full px-6 py-4 flex items-center justify-between gap-4 text-left hover:bg-slate-50/70 dark:hover:bg-slate-900/40 transition-colors"
      >
        <div>
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Optional Mode B · Not required for QR Code or 8-Digit Linking Code
          </p>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white mt-0.5">
            Official Meta WhatsApp Cloud API ({apiVersion}) Fallback
          </h3>
        </div>
        <div className="flex items-center gap-3 shrink-0 text-xs text-slate-500 dark:text-slate-400">
          <span className="font-mono">
            {metaEnabled ? 'Enabled' : 'Optional (Off)'}
          </span>
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </div>
      </button>

      {expanded && (
        <div className="px-6 pb-6 pt-4 border-t border-slate-200 dark:border-slate-800">
          <div className="flex items-center justify-between gap-4 mb-4">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Leave this off if you are connecting via QR Code or 8-Digit Code above. Secrets are
              AES-256-GCM encrypted on the server.
            </p>
            <label className="flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-300 cursor-pointer shrink-0">
              <input
                type="checkbox"
                checked={metaEnabled}
                onChange={(e) => setMetaEnabled(e.target.checked)}
                className="w-4 h-4 accent-emerald-600 rounded"
              />
              Enable Fallback
            </label>
          </div>

          <form onSubmit={handleSaveMeta} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
            Webhook Callback URL (paste in Meta App Dashboard)
          </label>
          <div className="flex items-center gap-2">
            <input
              type="text"
              readOnly
              value={webhookUrl}
              className="flex-1 px-3 py-2 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-600 dark:text-slate-300 min-w-0"
            />
            <button
              type="button"
              onClick={copyWebhookUrl}
              className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              {copiedUrl ? (
                <Check className="w-3.5 h-3.5 text-emerald-600" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
              {copiedUrl ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Meta App ID
            </label>
            <input
              type="text"
              value={appId}
              onChange={(e) => setAppId(e.target.value)}
              className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Embedded Signup Config ID
            </label>
            <input
              type="text"
              value={configId}
              onChange={(e) => setConfigId(e.target.value)}
              className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Webhook Verify Token
            </label>
            <input
              type="text"
              value={verifyToken}
              onChange={(e) => setVerifyToken(e.target.value)}
              className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Graph API Version
            </label>
            <input
              type="text"
              value={apiVersion}
              onChange={(e) => setApiVersion(e.target.value)}
              className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Phone Number ID
            </label>
            <input
              type="text"
              value={phoneNumberId}
              onChange={(e) => setPhoneNumberId(e.target.value)}
              placeholder="From Meta WhatsApp API Setup"
              className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              WABA ID
            </label>
            <input
              type="text"
              value={wabaId}
              onChange={(e) => setWabaId(e.target.value)}
              placeholder="WhatsApp Business Account ID"
              className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 pt-1">
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Meta App Secret{' '}
              {meta?.hasAppSecret && (
                <span className="font-mono text-emerald-700 dark:text-emerald-400">
                  ({meta.maskedAppSecret})
                </span>
              )}
            </label>
            <input
              type="password"
              value={appSecret}
              onChange={(e) => setAppSecret(e.target.value)}
              placeholder={meta?.hasAppSecret ? 'Enter new secret to replace' : 'Paste Meta App Secret'}
              className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Permanent Access Token{' '}
              {meta?.hasAccessToken && (
                <span className="font-mono text-emerald-700 dark:text-emerald-400">
                  ({meta.maskedAccessToken})
                </span>
              )}
            </label>
            <input
              type="password"
              value={accessToken}
              onChange={(e) => setAccessToken(e.target.value)}
              placeholder={
                meta?.hasAccessToken ? 'Enter new token to replace' : 'Paste System User Token'
              }
              className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
            />
          </div>
        </div>

        <div className="pt-3 flex items-center justify-between gap-4 border-t border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
            <Shield className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
            <span>HMAC-SHA256 webhook verification enabled</span>
          </div>
              <button
                type="submit"
                disabled={savingMeta}
                className="px-4 py-2 rounded-lg bg-slate-900 dark:bg-emerald-600 hover:bg-slate-800 dark:hover:bg-emerald-700 disabled:opacity-60 text-white text-xs font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap"
              >
                <Save className="w-3.5 h-3.5" />
                {savingMeta ? 'Saving...' : 'Save Meta Config'}
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}

export default function ChannelsView({
  baileys,
  logs,
  settings,
  onBaileysUpdate,
  onLogsUpdate,
  onRefreshStatus,
  onSettingsUpdated,
  onToast,
}: ChannelsViewProps) {
  const [connectMethod, setConnectMethod] = useState<'qr' | 'code'>('qr');
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const [lastPolledAt, setLastPolledAt] = useState<string | null>(null);

  // 8-Digit Pairing Code State
  const [pairingPhone, setPairingPhone] = useState('');
  const [pairingCodeLocal, setPairingCodeLocal] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);

  const pollStatus = useCallback(async () => {
    try {
      const res = await apiFetch('/api/whatsapp/status', { cache: 'no-store' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setPollError(body.error || `Status check returned HTTP ${res.status}`);
        return;
      }
      const data = await res.json();
      setPollError(null);
      setLastPolledAt(new Date().toISOString());

      if (data.baileys) {
        onBaileysUpdate(data.baileys);
        if (data.baileys.status === 'CONNECTED') {
          setPairingCodeLocal(null);
        }
      } else if (data.status) {
        onBaileysUpdate({
          status: data.status,
          qrDataUrl: data.qrDataUrl ?? null,
          pairingCode: data.pairingCode ?? null,
          connectedPhone: data.connectedPhone ?? null,
          connectedName: data.connectedName ?? null,
          lastConnectedAt: baileys.lastConnectedAt,
          reconnectAttempts: baileys.reconnectAttempts,
          lastError: data.lastError ?? null,
          updatedAt: data.updatedAt,
        });
      }
      if (Array.isArray(data.logs)) {
        onLogsUpdate(data.logs);
      }
    } catch {
      setPollError('Unable to reach /api/whatsapp/status. Check server connectivity.');
    }
  }, [baileys.lastConnectedAt, baileys.reconnectAttempts, onBaileysUpdate, onLogsUpdate]);

  // Poll /api/whatsapp/status immediately on mount and every 2 seconds
  useEffect(() => {
    const initialTimer = setTimeout(() => {
      void pollStatus();
    }, 0);
    const interval = setInterval(() => {
      void pollStatus();
    }, 2000);
    return () => {
      clearTimeout(initialTimer);
      clearInterval(interval);
    };
  }, [pollStatus]);

  async function handleGenerateQr(forceFresh: boolean) {
    setActionError(null);
    setBusyAction(forceFresh ? 'refresh' : 'connect');
    try {
      const endpoint = forceFresh ? '/api/whatsapp/repair' : '/api/whatsapp/connect';
      const res = await apiFetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ forceFresh }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) {
        throw new Error(data.error || `Failed to generate QR (HTTP ${res.status})`);
      }
      if (data.baileys) {
        onBaileysUpdate(data.baileys);
      }
      setPairingCodeLocal(null);
      await pollStatus();
      onToast(
        data.qrDataUrl
          ? 'Live WhatsApp QR code ready — scan from your phone'
          : 'Connecting to WhatsApp servers — QR code will appear in a moment',
        'success'
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to start WhatsApp connection';
      setActionError(msg);
      onToast(msg, 'error');
    } finally {
      setBusyAction(null);
    }
  }

  async function handleRequestPairingCode(e: React.FormEvent) {
    e.preventDefault();
    const cleaned = pairingPhone.replace(/[^0-9]/g, '');
    if (cleaned.length < 10) {
      setActionError(
        'Enter your full WhatsApp phone number with country code (e.g. 919472258022).'
      );
      return;
    }

    setActionError(null);
    setPairingCodeLocal(null);
    setBusyAction('pairing');
    try {
      const res = await apiFetch('/api/whatsapp/pairing-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber: cleaned }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Could not generate 8-digit pairing code.');
      }
      if (data.pairingCode) {
        setPairingCodeLocal(data.pairingCode);
      }
      if (data.baileys) {
        onBaileysUpdate(data.baileys);
      }
      await pollStatus();
      onToast('8-digit WhatsApp linking code generated!', 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Pairing code generation failed';
      setActionError(msg);
      onToast(msg, 'error');
    } finally {
      setBusyAction(null);
    }
  }

  async function handleDisconnect() {
    setActionError(null);
    setBusyAction('disconnect');
    try {
      const res = await apiFetch('/api/whatsapp/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ logout: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Failed to disconnect WhatsApp');
      }
      setPairingCodeLocal(null);
      if (data.baileys) {
        onBaileysUpdate(data.baileys);
      }
      onRefreshStatus();
      await pollStatus();
      onToast('WhatsApp session disconnected and credentials cleared', 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Disconnect failed';
      setActionError(msg);
      onToast(msg, 'error');
    } finally {
      setBusyAction(null);
    }
  }

  const activePairingCode = pairingCodeLocal || baileys.pairingCode || null;
  const formattedCode = activePairingCode ? formatPairingCode(activePairingCode) : null;
  const statusMeta = getReadableStatus(baileys.status);
  const visibleError = actionError || pollError || baileys.lastError || null;

  // Count incoming WhatsApp message/event entries for the live indicator
  const inboundLogs = logs.filter(
    (entry) =>
      entry.channel === 'baileys' ||
      entry.message.toLowerCase().includes('inbound') ||
      entry.message.toLowerCase().includes('message') ||
      entry.message.toLowerCase().includes('ai reply')
  );
  const latestEvent = inboundLogs[0] || logs[0] || null;

  function handleCopyPairingCode() {
    if (!formattedCode || typeof navigator === 'undefined' || !navigator.clipboard) return;
    navigator.clipboard.writeText(formattedCode.replace('-', '')).then(() => {
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 1800);
    });
  }

  return (
    <div className="space-y-6 max-w-5xl">
      {/* PRIMARY CONNECTION MODE: Real Baileys WhatsApp Linked Device Engine */}
      <section className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-6 flex flex-col">
          {/* Card Header */}
          <div className="flex flex-wrap items-start justify-between gap-4 pb-5 border-b border-slate-200 dark:border-slate-800">
            <div>
              <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
                Primary Mode · Direct WhatsApp Linked Devices (No Meta API Needed)
              </p>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white mt-0.5">
                Connect Your WhatsApp Account
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Scan the QR code or use an 8-digit linking code. Session is persisted on disk (
                <span className="font-mono">./data/baileys_auth</span>) for 24×7 auto-reconnect and
                live Gemini AI replies.
              </p>
            </div>

            <div className="flex items-center gap-2 shrink-0 text-xs font-medium">
              {baileys.status === 'CONNECTING' || busyAction === 'connect' || busyAction === 'refresh' ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-600 dark:text-amber-400" />
              ) : (
                <span className={`w-2 h-2 rounded-full ${statusMeta.dotClass}`} />
              )}
              <span className={statusMeta.toneClass}>{statusMeta.label}</span>
            </div>
          </div>

          {/* Visible Error Banner */}
          {visibleError && (
            <div className="mt-4 p-3.5 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/70 flex items-start justify-between gap-3 text-xs text-red-800 dark:text-red-200">
              <div className="flex items-start gap-2.5 min-w-0">
                <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
                <div className="space-y-0.5 min-w-0">
                  <p className="font-semibold">WhatsApp Connection Notice</p>
                  <p className="break-words">{visibleError}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setActionError(null);
                  setPollError(null);
                }}
                className="text-red-700 dark:text-red-300 hover:underline shrink-0 font-medium"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Connected State: Green Connected Card */}
          {baileys.status === 'CONNECTED' ? (
            <div className="mt-6 flex-1 flex flex-col justify-between space-y-5">
              <div className="rounded-xl border border-emerald-200 dark:border-emerald-800/80 bg-emerald-50/70 dark:bg-emerald-950/30 p-6 space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="flex items-center gap-3.5">
                    <div className="w-12 h-12 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0">
                      <CheckCircle2 className="w-6 h-6" />
                    </div>
                    <div>
                      <p className="text-xs font-medium text-emerald-800 dark:text-emerald-300">
                        WhatsApp Linked & Active
                      </p>
                      <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
                        {baileys.connectedName || 'Bihar Gramin Bazaar WhatsApp'}
                      </h3>
                      <p className="text-sm font-mono tabular-nums font-medium text-emerald-700 dark:text-emerald-400">
                        +{baileys.connectedPhone || 'Connected'}
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    disabled={busyAction !== null}
                    onClick={handleDisconnect}
                    className="px-4 py-2.5 rounded-lg bg-white dark:bg-slate-900 border border-red-200 dark:border-red-900/70 text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 disabled:opacity-60 text-xs font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap"
                  >
                    {busyAction === 'disconnect' ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <LogOut className="w-3.5 h-3.5" />
                    )}
                    Disconnect / Change Number
                  </button>
                </div>

                {/* Live Incoming Message Log Indicator */}
                <div className="pt-4 border-t border-emerald-200/80 dark:border-emerald-900/60 grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
                  <div>
                    <p className="text-slate-500 dark:text-slate-400">Incoming Stream</p>
                    <p className="mt-0.5 font-medium text-emerald-800 dark:text-emerald-300 flex items-center gap-1.5">
                      <MessageSquare className="w-3.5 h-3.5" />
                      Listening for live chats
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-500 dark:text-slate-400">Recorded Events</p>
                    <p className="mt-0.5 font-mono tabular-nums font-semibold text-slate-900 dark:text-white">
                      {logs.length} channel logs
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-500 dark:text-slate-400">Online Since</p>
                    <p className="mt-0.5 font-mono tabular-nums text-slate-800 dark:text-slate-200">
                      {baileys.lastConnectedAt
                        ? new Date(baileys.lastConnectedAt).toLocaleTimeString('en-IN')
                        : 'Active now'}
                    </p>
                  </div>
                </div>

                {latestEvent && (
                  <div className="pt-3 border-t border-emerald-200/80 dark:border-emerald-900/60 text-xs flex items-start justify-between gap-3">
                    <span className="text-slate-600 dark:text-slate-300 break-words whitespace-pre-wrap min-w-0 flex-1">
                      Latest log:{' '}
                      <span
                        className={`font-mono ${
                          latestEvent.level === 'error'
                            ? 'text-red-700 dark:text-red-400'
                            : 'text-slate-900 dark:text-white'
                        }`}
                      >
                        {latestEvent.message}
                      </span>
                    </span>
                    <span className="font-mono tabular-nums text-slate-500 shrink-0">
                      {new Date(latestEvent.timestamp).toLocaleTimeString('en-IN')}
                    </span>
                  </div>
                )}
              </div>

              <p className="text-xs text-slate-500 dark:text-slate-400">
                Customer messages automatically trigger Gemini AI with Bihar Gramin Bazaar live
                products & orders. Replying from your phone pauses AI for that chat automatically
                (or send <span className="font-mono">#manual</span> /{' '}
                <span className="font-mono">#ai</span>).
              </p>
            </div>
          ) : (
            /* Not Connected State: Tab A (Scan QR Code) & Tab B (8-Digit Linking Code) */
            <div className="mt-5 flex-1 flex flex-col">
              {/* Two-Method Switcher */}
              <div className="grid grid-cols-2 gap-1.5 p-1 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => {
                    setConnectMethod('qr');
                    setActionError(null);
                  }}
                  className={`py-2 px-3 rounded-md text-xs font-medium flex items-center justify-center gap-2 transition-colors ${
                    connectMethod === 'qr'
                      ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  <QrCode className="w-3.5 h-3.5" />
                  <span>Scan QR Code</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setConnectMethod('code');
                    setActionError(null);
                  }}
                  className={`py-2 px-3 rounded-md text-xs font-medium flex items-center justify-center gap-2 transition-colors ${
                    connectMethod === 'code'
                      ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  <KeyRound className="w-3.5 h-3.5" />
                  <span>8-Digit Linking Code</span>
                </button>
              </div>

              {/* TAB A: SCAN QR CODE */}
              {connectMethod === 'qr' ? (
                <div className="mt-5 flex-1 grid grid-cols-1 md:grid-cols-12 gap-6 items-center">
                  {/* QR Canvas Box */}
                  <div className="md:col-span-6 flex flex-col items-center justify-center">
                    {baileys.qrDataUrl ? (
                      <div className="p-3.5 bg-white rounded-xl border border-slate-200 shadow-xs">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={baileys.qrDataUrl}
                          alt="WhatsApp Live QR Code"
                          className="w-56 h-56 sm:w-64 sm:h-64 block"
                          referrerPolicy="no-referrer"
                        />
                      </div>
                    ) : baileys.status === 'CONNECTING' ||
                      busyAction === 'connect' ||
                      busyAction === 'refresh' ? (
                      <div className="w-60 h-60 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/60 flex flex-col items-center justify-center p-6 text-center space-y-3">
                        <Loader2 className="w-8 h-8 animate-spin text-emerald-600" />
                        <div>
                          <p className="text-xs font-semibold text-slate-900 dark:text-white">
                            Generating live WhatsApp QR...
                          </p>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                            Connecting to WhatsApp Web servers via Baileys
                          </p>
                        </div>
                      </div>
                    ) : (
                      <div className="w-60 h-60 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/60 flex flex-col items-center justify-center p-6 text-center space-y-3">
                        <QrCode className="w-10 h-10 text-slate-400" />
                        <div>
                          <p className="text-xs font-semibold text-slate-900 dark:text-white">
                            Ready to generate QR
                          </p>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                            Click the button below to generate a scannable WhatsApp QR code.
                          </p>
                        </div>
                      </div>
                    )}

                    <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                      <button
                        type="button"
                        disabled={busyAction !== null}
                        onClick={() => handleGenerateQr(Boolean(baileys.qrDataUrl))}
                        className="px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-xs font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap"
                      >
                        <RefreshCw
                          className={`w-3.5 h-3.5 ${
                            busyAction === 'connect' || busyAction === 'refresh'
                              ? 'animate-spin'
                              : ''
                          }`}
                        />
                        {busyAction === 'connect' || busyAction === 'refresh'
                          ? 'Generating QR...'
                          : baileys.qrDataUrl
                          ? 'Refresh QR'
                          : 'Generate / Refresh QR'}
                      </button>

                      {baileys.status !== 'DISCONNECTED' && (
                        <button
                          type="button"
                          disabled={busyAction !== null}
                          onClick={handleDisconnect}
                          className="px-3 py-2.5 rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-medium whitespace-nowrap"
                        >
                          Reset Session
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Step-by-step QR Instructions */}
                  <div className="md:col-span-6 space-y-4">
                    <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
                      <Smartphone className="w-4 h-4 text-emerald-600" />
                      <span>How to Scan & Connect</span>
                    </div>
                    <ol className="space-y-2.5 text-xs text-slate-600 dark:text-slate-300 list-decimal list-inside leading-relaxed">
                      <li>
                        Open <span className="font-semibold text-slate-900 dark:text-white">WhatsApp</span> on your phone
                      </li>
                      <li>
                        Tap <span className="font-semibold text-slate-900 dark:text-white">Three dots (⋮)</span> on Android or <span className="font-semibold text-slate-900 dark:text-white">Settings</span> on iPhone
                      </li>
                      <li>
                        Tap <span className="font-semibold text-slate-900 dark:text-white">Linked Devices</span> → <span className="font-semibold text-slate-900 dark:text-white">Link a Device</span>
                      </li>
                      <li>
                        Point your phone camera at this QR code to link instantly
                      </li>
                    </ol>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 pt-2 border-t border-slate-200 dark:border-slate-800">
                      Using the same phone right now? Switch to the{' '}
                      <button
                        type="button"
                        onClick={() => setConnectMethod('code')}
                        className="text-emerald-700 dark:text-emerald-400 font-medium hover:underline"
                      >
                        8-Digit Linking Code
                      </button>{' '}
                      tab — no camera scan needed.
                    </p>
                  </div>
                </div>
              ) : (
                /* TAB B: CONNECT VIA 8-DIGIT CODE (SINGLE-PHONE FRIENDLY) */
                <div className="mt-5 flex-1 space-y-5">
                  <form onSubmit={handleRequestPairingCode} className="space-y-3.5">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                        Your WhatsApp Phone Number (with country code, e.g. 919472258022)
                      </label>
                      <div className="flex flex-col sm:flex-row gap-2.5">
                        <div className="relative flex-1">
                          <Phone className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                          <input
                            type="tel"
                            required
                            value={pairingPhone}
                            onChange={(e) => setPairingPhone(e.target.value)}
                            placeholder="919472258022"
                            className="w-full pl-9 pr-3 py-2.5 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:border-emerald-600"
                          />
                        </div>
                        <button
                          type="submit"
                          disabled={busyAction !== null}
                          className="px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-xs font-medium flex items-center justify-center gap-1.5 whitespace-nowrap transition-colors"
                        >
                          {busyAction === 'pairing' ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <KeyRound className="w-3.5 h-3.5" />
                          )}
                          {busyAction === 'pairing'
                            ? 'Generating Code...'
                            : 'Get 8-Digit Linking Code'}
                        </button>
                      </div>
                    </div>
                  </form>

                  {/* Copyable 8-Digit Code Display */}
                  {formattedCode && (
                    <div className="p-5 rounded-xl border border-emerald-200 dark:border-emerald-800/80 bg-emerald-50/70 dark:bg-emerald-950/30 flex flex-wrap items-center justify-between gap-4">
                      <div>
                        <p className="text-xs font-medium text-emerald-800 dark:text-emerald-300">
                          Enter this 8-digit code in WhatsApp now
                        </p>
                        <p className="mt-1 text-3xl font-mono font-bold tracking-[0.2em] text-slate-900 dark:text-white tabular-nums">
                          {formattedCode}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={handleCopyPairingCode}
                        className="px-3.5 py-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-medium flex items-center gap-1.5 whitespace-nowrap"
                      >
                        {copiedCode ? (
                          <Check className="w-3.5 h-3.5 text-emerald-600" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                        {copiedCode ? 'Copied' : 'Copy Code'}
                      </button>
                    </div>
                  )}

                  {/* Pairing Code Instructions */}
                  <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 space-y-2.5">
                    <p className="text-xs font-semibold text-slate-900 dark:text-white">
                      Single-Phone Linking Steps (No QR Scan Needed)
                    </p>
                    <ol className="space-y-1.5 text-xs text-slate-600 dark:text-slate-300 list-decimal list-inside leading-relaxed">
                      <li>
                        Enter your WhatsApp number above with country code (e.g.{' '}
                        <span className="font-mono">919472258022</span>) and click{' '}
                        <span className="font-semibold">Get 8-Digit Linking Code</span>
                      </li>
                      <li>
                        Open WhatsApp on your phone → <span className="font-semibold">Linked Devices</span> →{' '}
                        <span className="font-semibold">Link a Device</span>
                      </li>
                      <li>
                        Tap <span className="font-semibold">&quot;Link with phone number instead&quot;</span> at the bottom of the scanner screen
                      </li>
                      <li>Type the 8-digit code shown above — your account connects within seconds</li>
                    </ol>
                  </div>
                </div>
              )}

              {/* Subtle Polling Footer */}
              <div className="mt-5 pt-4 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                <span>Auto-syncing live WhatsApp status every 2 seconds</span>
                <span className="font-mono tabular-nums">
                  {lastPolledAt
                    ? `Updated ${new Date(lastPolledAt).toLocaleTimeString('en-IN')}`
                    : 'Checking...'}
                </span>
              </div>
            </div>
          )}
        </section>

      {/* Live Connection & Incoming Message Event Log */}
      <section className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Terminal className="w-4 h-4 text-slate-400" />
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
              Channel Connection & Incoming Message Logs
            </h3>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs font-mono tabular-nums text-slate-500">
              {logs.length} events
            </span>
            <button
              type="button"
              onClick={() => void pollStatus()}
              className="text-xs text-emerald-700 dark:text-emerald-400 hover:underline font-medium"
            >
              Refresh
            </button>
          </div>
        </div>

        {logs.length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-500 dark:text-slate-400">
            No channel events recorded yet. Click Generate / Refresh QR or request an 8-digit
            linking code to connect WhatsApp.
          </div>
        ) : (
          <div className="max-h-72 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/70 font-mono text-xs">
            {logs.map((entry) => (
              <div key={entry.id} className="px-5 py-2.5 flex items-start gap-4">
                <span className="text-slate-400 tabular-nums shrink-0">
                  {new Date(entry.timestamp).toLocaleTimeString('en-IN')}
                </span>
                <span className="uppercase text-slate-500 shrink-0 w-16">{entry.channel}</span>
                <span
                  className={`flex-1 break-words ${
                    entry.level === 'error'
                      ? 'text-red-600 dark:text-red-400'
                      : entry.level === 'warn'
                      ? 'text-amber-700 dark:text-amber-400'
                      : entry.level === 'success'
                      ? 'text-emerald-700 dark:text-emerald-400'
                      : 'text-slate-700 dark:text-slate-300'
                  }`}
                >
                  {entry.message}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Optional Mode B: Official Meta Cloud API v21.0 Fallback (Collapsed by default) */}
      <MetaCloudConfigCard
        key={settings ? 'meta-loaded' : 'meta-default'}
        settings={settings}
        onSettingsUpdated={onSettingsUpdated}
        onToast={onToast}
      />
    </div>
  );
}
