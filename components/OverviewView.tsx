'use client';

import React, { useEffect, useState } from 'react';
import {
  ArrowRight,
  Bot,
  MessageSquare,
  Package,
  QrCode,
  RefreshCw,
  ShoppingBag,
  Users,
} from 'lucide-react';
import type {
  AiAuditLog,
  AiGlobalMode,
  BaileysStateSnapshot,
  ChatSession,
  OverviewMetrics,
  StoreOrder,
} from '@/lib/types';

interface OverviewViewProps {
  metrics: OverviewMetrics | null;
  recentSessions: ChatSession[];
  recentOrders: StoreOrder[];
  recentAiLogs: AiAuditLog[];
  baileys: BaileysStateSnapshot;
  aiGlobalMode: AiGlobalMode;
  handoverCooldownMinutes: number;
  syncing: boolean;
  onSyncStore: () => void;
  onChangeGlobalAiMode: (mode: AiGlobalMode) => void;
  onNavigate: (tab: string, phone?: string) => void;
}

function formatTime(iso?: string | null) {
  if (!iso) return 'Never';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function OverviewView({
  metrics,
  recentSessions,
  recentOrders,
  recentAiLogs,
  baileys,
  aiGlobalMode,
  handoverCooldownMinutes,
  syncing,
  onSyncStore,
  onChangeGlobalAiMode,
  onNavigate,
}: OverviewViewProps) {
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);

  const statusLabel =
    baileys.status === 'CONNECTED'
      ? `Connected (+${baileys.connectedPhone || ''})`
      : baileys.status === 'QR_READY'
      ? 'QR Ready for Scan'
      : baileys.status === 'CONNECTING'
      ? 'Connecting...'
      : 'Not Connected';

  return (
    <div className="space-y-6">
      {/* KPI Metric Strip — Flat single elevation, tabular numerals */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
            <span>Total Conversations</span>
            <Users className="w-4 h-4 text-slate-400" />
          </div>
          <p className="mt-2.5 text-2xl font-semibold font-mono tabular-nums text-slate-900 dark:text-white">
            {metrics?.totalChats ?? 0}
          </p>
          <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
            {metrics?.activeAiChats ?? 0} AI active · {metrics?.pausedHandoverChats ?? 0} handover ·{' '}
            {metrics?.unreadChats ?? 0} unread
          </p>
        </div>

        <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
            <span>AI vs Human Replies</span>
            <Bot className="w-4 h-4 text-slate-400" />
          </div>
          <p className="mt-2.5 text-2xl font-semibold font-mono tabular-nums text-slate-900 dark:text-white">
            {metrics?.aiReplies ?? 0}{' '}
            <span className="text-sm font-normal text-slate-400">/ {metrics?.humanReplies ?? 0}</span>
          </p>
          <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
            {metrics?.inboundMessages ?? 0} inbound · Global AI{' '}
            {metrics?.aiGlobalEnabled ? 'ON' : 'OFF'}
          </p>
        </div>

        <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
            <span>Store & WhatsApp Orders</span>
            <ShoppingBag className="w-4 h-4 text-slate-400" />
          </div>
          <p className="mt-2.5 text-2xl font-semibold font-mono tabular-nums text-slate-900 dark:text-white">
            {metrics?.totalSyncedOrders ?? 0}
          </p>
          <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
            {metrics?.whatsappOrdersCount ?? 0} via WhatsApp AI · {metrics?.totalSyncedProducts ?? 0}{' '}
            products
          </p>
        </div>

        <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
            <span>WhatsApp Channel</span>
            <QrCode className="w-4 h-4 text-slate-400" />
          </div>
          <p
            className={`mt-2.5 text-base font-semibold truncate ${
              baileys.status === 'CONNECTED'
                ? 'text-emerald-700 dark:text-emerald-400'
                : 'text-amber-700 dark:text-amber-400'
            }`}
          >
            {statusLabel}
          </p>
          <div className="mt-2 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Meta Cloud: {metrics?.metaEnabled ? 'Active' : 'Standby'}</span>
            <button
              type="button"
              onClick={() => onNavigate('channels')}
              className="text-emerald-700 dark:text-emerald-400 hover:underline font-medium whitespace-nowrap"
            >
              Manage
            </button>
          </div>
        </div>
      </div>

      {/* Global Hybrid Human + AI Mode Switcher */}
      <section className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
            Human + AI Hybrid Handover Mode
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Replying from your phone auto-pauses AI for{' '}
            <span className="font-mono tabular-nums">{handoverCooldownMinutes}m</span> · Phone
            commands: <span className="font-mono">#manual</span>,{' '}
            <span className="font-mono">#stop</span>, <span className="font-mono">#ai</span>,{' '}
            <span className="font-mono">#start</span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-900 shrink-0">
          {(
            [
              { id: 'AUTO_ON', label: 'AI Auto-Reply ON' },
              { id: 'OUTSIDE_BUSINESS_HOURS', label: 'AI Only Outside Business Hours' },
              { id: 'MANUAL_ONLY', label: 'Manual Only (AI OFF)' },
            ] as const
          ).map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => onChangeGlobalAiMode(opt.id)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
                aiGlobalMode === opt.id
                  ? opt.id === 'MANUAL_ONLY'
                    ? 'bg-slate-900 dark:bg-slate-700 text-white shadow-xs'
                    : 'bg-emerald-600 text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </section>

      {/* Main 2-Column Operational Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent WhatsApp Conversations */}
        <section className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden flex flex-col">
          <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                Recent Customer Conversations
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Live inbound WhatsApp threads & Gemini state
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('inbox')}
              className="text-xs font-medium text-emerald-700 dark:text-emerald-400 hover:underline flex items-center gap-1 whitespace-nowrap"
            >
              Open Inbox <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {recentSessions.length === 0 ? (
            <div className="p-8 text-center flex-1 flex flex-col items-center justify-center">
              <MessageSquare className="w-7 h-7 text-slate-300 dark:text-slate-700 mb-2.5" />
              <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                No WhatsApp conversations yet
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-xs">
                Connect your WhatsApp number via QR scan or start a customer chat directly from the
                Live Inbox.
              </p>
              <button
                type="button"
                onClick={() => onNavigate('channels')}
                className="mt-4 px-3.5 py-2 text-xs font-medium rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white transition-colors"
              >
                Connect WhatsApp QR
              </button>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800/80">
              {recentSessions.map((s) => {
                const isPaused =
                  !s.aiEnabled ||
                  Boolean(s.aiPausedIndefinitely) ||
                  (s.aiPausedUntil && new Date(s.aiPausedUntil).getTime() > nowMs);
                return (
                  <button
                    key={s.phone}
                    type="button"
                    onClick={() => onNavigate('inbox', s.phone)}
                    className="w-full px-5 py-3.5 text-left hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors flex items-start justify-between gap-4"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-sm font-medium text-slate-900 dark:text-slate-100">
                        <span className="truncate">{s.name}</span>
                        <span className="text-xs font-mono text-slate-400">+{s.phone}</span>
                      </div>
                      <p className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">
                        {s.lastMessage || 'No messages yet'}
                      </p>
                      <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                        <span>{s.state}</span>
                        <span>·</span>
                        <span
                          className={
                            isPaused
                              ? 'text-amber-700 dark:text-amber-400 font-medium'
                              : 'text-emerald-700 dark:text-emerald-400 font-medium'
                          }
                        >
                          {isPaused ? 'Human Handling (AI Paused)' : 'AI Active'}
                        </span>
                        <span>·</span>
                        <span className="uppercase">{s.channel}</span>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-[11px] font-mono tabular-nums text-slate-400">
                        {formatTime(s.lastMessageAt)}
                      </p>
                      {s.unreadCount > 0 && (
                        <p className="mt-1 text-xs font-mono font-semibold text-emerald-700 dark:text-emerald-400">
                          {s.unreadCount} unread
                        </p>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {/* Live Bihar Gramin Bazaar Orders Feed */}
        <section className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden flex flex-col">
          <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                Live Store Orders & Dispatch
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 font-mono tabular-nums">
                Synced {formatTime(metrics?.lastSyncAt)}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onSyncStore}
                disabled={syncing}
                className="text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white flex items-center gap-1 whitespace-nowrap"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
                Sync
              </button>
              <button
                type="button"
                onClick={() => onNavigate('ecommerce')}
                className="text-xs font-medium text-emerald-700 dark:text-emerald-400 hover:underline flex items-center gap-1 whitespace-nowrap"
              >
                View All <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {recentOrders.length === 0 ? (
            <div className="p-8 text-center flex-1 flex flex-col items-center justify-center">
              <Package className="w-7 h-7 text-slate-300 dark:text-slate-700 mb-2.5" />
              <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                No synced orders loaded yet
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Click Sync to fetch live orders from bihargraminbazaar.com/api/orders.php.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800/80">
              {recentOrders.map((ord) => (
                <div
                  key={ord.id}
                  className="px-5 py-3.5 flex items-center justify-between gap-4 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-mono font-semibold text-slate-900 dark:text-white">
                        {ord.id}
                      </span>
                      <span className="text-slate-400">·</span>
                      <span className="text-slate-700 dark:text-slate-300 truncate">
                        {ord.customerName}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                      {ord.district}
                      {ord.pincode ? ` - ${ord.pincode}` : ''} · {ord.deliveryStage}
                      {ord.assignedAgentName ? ` · Agent: ${ord.assignedAgentName}` : ''}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-mono font-semibold tabular-nums text-slate-900 dark:text-white">
                      ₹{ord.totalAmount.toLocaleString('en-IN')}
                    </p>
                    <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                      {ord.collectedMethod || ord.paymentMethod}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Recent Gemini AI Tool Execution Audit Table */}
      <section className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
              Recent Gemini AI Tool Invocations
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Live audit trail of product searches, order placements, and order tracking calls
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('automation')}
            className="text-xs font-medium text-emerald-700 dark:text-emerald-400 hover:underline whitespace-nowrap"
          >
            Test AI Engine
          </button>
        </div>

        {recentAiLogs.length === 0 ? (
          <div className="px-5 py-8 text-center text-xs text-slate-500 dark:text-slate-400">
            No Gemini AI replies logged yet. Test the live Bihari/Hindi AI agent inside AI Automation
            or send a WhatsApp message once paired.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 bg-slate-50/70 dark:bg-slate-900/40">
                  <th className="py-2.5 px-5 font-medium">Time</th>
                  <th className="py-2.5 px-4 font-medium">Customer</th>
                  <th className="py-2.5 px-4 font-medium">Query</th>
                  <th className="py-2.5 px-4 font-medium">Tools Called</th>
                  <th className="py-2.5 px-4 font-medium text-right">Latency</th>
                  <th className="py-2.5 px-5 font-medium text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                {recentAiLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/30">
                    <td className="py-2.5 px-5 font-mono tabular-nums text-slate-500 whitespace-nowrap">
                      {formatTime(log.createdAt)}
                    </td>
                    <td className="py-2.5 px-4 font-mono text-slate-700 dark:text-slate-300 whitespace-nowrap">
                      +{log.phone}
                    </td>
                    <td className="py-2.5 px-4 text-slate-800 dark:text-slate-200 max-w-xs truncate">
                      {log.query}
                    </td>
                    <td className="py-2.5 px-4 font-mono text-slate-600 dark:text-slate-400">
                      {log.toolsUsed.length > 0 ? log.toolsUsed.join(', ') : 'direct'}
                    </td>
                    <td className="py-2.5 px-4 font-mono tabular-nums text-right text-slate-500">
                      {log.latencyMs}ms
                    </td>
                    <td
                      className={`py-2.5 px-5 font-medium text-right ${
                        log.status === 'SUCCESS'
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : 'text-red-600 dark:text-red-400'
                      }`}
                    >
                      {log.status}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
