'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Bot,
  LayoutDashboard,
  Menu,
  MessageSquare,
  Moon,
  QrCode,
  RefreshCw,
  Settings,
  ShoppingBag,
  Sun,
  X,
} from 'lucide-react';
import { io, Socket } from 'socket.io-client';
import type {
  AiAuditLog,
  AiGlobalMode,
  AppSettings,
  BaileysStateSnapshot,
  ChannelLogEntry,
  ChatMessage,
  ChatSession,
  OverviewMetrics,
  StoreOrder,
  StoreProduct,
} from '@/lib/types';
import { apiFetch, setStoredAuthToken } from '@/lib/api-client';
import AuthGate from './AuthGate';
import AutomationView from './AutomationView';
import ChannelsView from './ChannelsView';
import EcommerceView from './EcommerceView';
import InboxView from './InboxView';
import OverviewView from './OverviewView';
import SettingsView from './SettingsView';

type NavTab = 'overview' | 'inbox' | 'channels' | 'automation' | 'ecommerce' | 'settings';

const NAV_ITEMS: Array<{ id: NavTab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'inbox', label: 'Live Inbox', icon: MessageSquare },
  { id: 'channels', label: 'QR & Channels', icon: QrCode },
  { id: 'automation', label: 'AI Automation', icon: Bot },
  { id: 'ecommerce', label: 'E-Commerce Sync', icon: ShoppingBag },
  { id: 'settings', label: 'Security & Settings', icon: Settings },
];

class TabErrorBoundary extends React.Component<
  { tabKey: string; children: React.ReactNode },
  { hasError: boolean; message: string }
> {
  constructor(props: { tabKey: string; children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, message: error?.message || 'Unexpected view error' };
  }

  componentDidUpdate(prevProps: { tabKey: string }) {
    if (prevProps.tabKey !== this.props.tabKey && this.state.hasError) {
      this.setState({ hasError: false, message: '' });
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="bg-white dark:bg-[#111827] border border-red-200 dark:border-red-900/70 rounded-xl p-6 space-y-3">
          <h2 className="text-sm font-semibold text-red-700 dark:text-red-400">
            This view encountered a rendering error
          </h2>
          <p className="text-xs text-slate-600 dark:text-slate-400 font-mono">
            {this.state.message}
          </p>
          <button
            type="button"
            onClick={() => this.setState({ hasError: false, message: '' })}
            className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium"
          >
            Reload View
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function DashboardShell() {
  const [darkMode, setDarkMode] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [user, setUser] = useState<{ id: string; email: string; name: string } | null>(null);

  const [activeTab, setActiveTab] = useState<NavTab>('overview');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Core Live State
  const [metrics, setMetrics] = useState<OverviewMetrics | null>(null);
  const [recentAiLogs, setRecentAiLogs] = useState<AiAuditLog[]>([]);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [selectedPhone, setSelectedPhone] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);

  const [baileys, setBaileys] = useState<BaileysStateSnapshot>({
    status: 'DISCONNECTED',
    qrDataUrl: null,
    connectedPhone: null,
    connectedName: null,
    lastConnectedAt: null,
    reconnectAttempts: 0,
  });
  const [channelLogs, setChannelLogs] = useState<ChannelLogEntry[]>([]);
  const [products, setProducts] = useState<StoreProduct[]>([]);
  const [orders, setOrders] = useState<StoreOrder[]>([]);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [defaultSystemPrompt, setDefaultSystemPrompt] = useState('');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const selectedPhoneRef = useRef<string | null>(null);
  useEffect(() => {
    selectedPhoneRef.current = selectedPhone;
  }, [selectedPhone]);

  const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => {
      setToast((prev) => (prev?.message === message ? null : prev));
    }, 4000);
  }, []);

  // Theme initialization & toggle
  useEffect(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem('bgb_theme') : null;
    const preferDark = saved === 'dark';
    document.documentElement.classList.toggle('dark', preferDark);
    if (preferDark) {
      queueMicrotask(() => setDarkMode(true));
    }
  }, []);

  function toggleTheme() {
    setDarkMode((prev) => {
      const next = !prev;
      document.documentElement.classList.toggle('dark', next);
      localStorage.setItem('bgb_theme', next ? 'dark' : 'light');
      return next;
    });
  }

  // Check Auth Status
  useEffect(() => {
    apiFetch('/api/auth/status')
      .then((r) => r.json())
      .then((data) => {
        setNeedsSetup(Boolean(data.needsSetup));
        if (data.authenticated && data.user) {
          if (data.token) {
            setStoredAuthToken(data.token);
          }
          setUser(data.user);
        } else {
          setStoredAuthToken(null);
          setUser(null);
        }
      })
      .catch(() => {})
      .finally(() => setAuthLoading(false));
  }, []);

  const fetchOverviewAndLists = useCallback(async () => {
    try {
      const [ovRes, chatsRes, waRes, prodRes, ordRes, setRes] = await Promise.all([
        apiFetch('/api/overview'),
        apiFetch('/api/chats'),
        apiFetch('/api/whatsapp/status'),
        apiFetch('/api/ecommerce/products'),
        apiFetch('/api/ecommerce/orders'),
        apiFetch('/api/settings'),
      ]);

      if (ovRes.status === 401 && setRes.status === 401) {
        setStoredAuthToken(null);
        setUser(null);
        return;
      }

      if (ovRes.ok) {
        const ov = await ovRes.json();
        setMetrics(ov.metrics);
        setRecentAiLogs(ov.recentAiLogs || []);
      }
      if (chatsRes.ok) {
        const ch = await chatsRes.json();
        setSessions(ch.sessions || []);
      }
      if (waRes.ok) {
        const wa = await waRes.json();
        if (wa.baileys) setBaileys(wa.baileys);
        setChannelLogs(wa.logs || []);
      }
      if (prodRes.ok) {
        const pr = await prodRes.json();
        setProducts(pr.products || []);
        if (pr.lastSyncAt) setLastSyncAt(pr.lastSyncAt);
      }
      if (ordRes.ok) {
        const or = await ordRes.json();
        setOrders(or.orders || []);
        if (or.lastSyncAt) setLastSyncAt(or.lastSyncAt);
      }
      if (setRes.ok) {
        const st = await setRes.json();
        setSettings(st.settings);
        setDefaultSystemPrompt(st.defaultSystemPrompt || '');
      }
    } catch {
      // keep resilient
    }
  }, []);

  // Load workspace data + attach Socket.IO once authenticated
  useEffect(() => {
    if (!user) return;
    queueMicrotask(() => {
      void fetchOverviewAndLists();
    });

    const socket: Socket = io({
      path: '/socket.io',
      transports: ['websocket', 'polling'],
    });

    socket.on('wa:status', (snap: BaileysStateSnapshot) => {
      setBaileys(snap);
    });

    socket.on('wa:log', (entry: ChannelLogEntry) => {
      setChannelLogs((prev) => [entry, ...prev].slice(0, 80));
    });

    socket.on('chat:session', (updatedSession: ChatSession) => {
      setSessions((prev) => {
        const filtered = prev.filter((s) => s.phone !== updatedSession.phone);
        return [updatedSession, ...filtered].sort(
          (a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime()
        );
      });
    });

    socket.on(
      'chat:message',
      (payload: { message: ChatMessage; session?: ChatSession }) => {
        const { message, session } = payload;
        if (session) {
          setSessions((prev) => {
            const filtered = prev.filter((s) => s.phone !== session.phone);
            return [session, ...filtered].sort(
              (a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime()
            );
          });
        }
        if (selectedPhoneRef.current === message.phone) {
          setMessages((prev) => {
            if (prev.some((m) => m.id === message.id || m.wamId === message.wamId)) {
              return prev;
            }
            return [...prev, message];
          });
        }
      }
    );

    socket.on('ecommerce:synced', () => {
      fetchOverviewAndLists();
    });

    socket.on(
      'chat:history_synced',
      async (summary?: { chatsImported?: number; messagesImported?: number }) => {
        try {
          const chatsRes = await apiFetch('/api/chats');
          if (chatsRes.ok) {
            const ch = await chatsRes.json();
            setSessions(ch.sessions || []);
          }
          if (selectedPhoneRef.current) {
            const msgRes = await apiFetch(
              `/api/chats/${encodeURIComponent(selectedPhoneRef.current)}/messages`
            );
            if (msgRes.ok) {
              const md = await msgRes.json();
              setMessages(md.messages || []);
            }
          }
          if (summary && (summary.chatsImported || 0) > 0) {
            showToast(
              `Synced ${summary.chatsImported} WhatsApp chats & ${summary.messagesImported || 0} messages into Live Inbox`,
              'success'
            );
          }
        } catch {
          // keep resilient
        }
      }
    );

    return () => {
      socket.disconnect();
    };
  }, [user, fetchOverviewAndLists, showToast]);

  const loadThread = useCallback(async (phone: string) => {
    setSelectedPhone(phone);
    setLoadingMessages(true);
    try {
      const res = await apiFetch(`/api/chats/${encodeURIComponent(phone)}/messages`);
      if (res.ok) {
        const data = await res.json();
        setMessages(data.messages || []);
        if (data.session) {
          setSessions((prev) =>
            prev.map((s) => (s.phone === data.session.phone ? data.session : s))
          );
        }
      }
    } finally {
      setLoadingMessages(false);
    }
  }, []);

  async function handleSyncStore() {
    setSyncing(true);
    try {
      const res = await apiFetch('/api/ecommerce/sync', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Sync failed');
      await fetchOverviewAndLists();
      showToast(
        `Synced ${data.productsCount} products & ${data.ordersCount} orders from bihargraminbazaar.com`,
        'success'
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Store sync failed', 'error');
    } finally {
      setSyncing(false);
    }
  }

  async function handleStartNewChat(phone: string, name: string) {
    const res = await apiFetch('/api/chats/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, name }),
    });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'Unable to start chat', 'error');
      return;
    }
    setSessions((prev) => [data.session, ...prev.filter((s) => s.phone !== data.session.phone)]);
    await loadThread(data.session.phone);
  }

  async function handleSendMessage(phone: string, body: string) {
    const res = await apiFetch(`/api/chats/${encodeURIComponent(phone)}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body }),
    });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'Send failed', 'error');
      return;
    }
    if (data.deliveredVia === 'local_only') {
      showToast(
        `Saved in Inbox (${data.deliveryError || 'connect WhatsApp QR to dispatch live'})`,
        'error'
      );
    }
  }

  async function handleSendProductCard(phone: string, productId: string, note?: string) {
    const res = await apiFetch(`/api/chats/${encodeURIComponent(phone)}/send-product`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId, note }),
    });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'Failed to send product card', 'error');
      return;
    }
    showToast(
      data.deliveredVia === 'local_only'
        ? 'Product card added to chat (connect WhatsApp QR to deliver externally)'
        : `Product card delivered via ${data.deliveredVia}`,
      data.deliveredVia === 'local_only' ? 'error' : 'success'
    );
  }

  async function handleToggleChatAi(phone: string, enabled: boolean) {
    const res = await apiFetch(`/api/chats/${encodeURIComponent(phone)}/toggle-ai`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    });
    if (res.ok) {
      const data = await res.json();
      setSessions((prev) =>
        prev.map((s) => (s.phone === data.session.phone ? data.session : s))
      );
      showToast(enabled ? 'Gemini AI resumed for this chat' : 'Human Handling active — AI paused');
    }
  }

  async function handleChangeGlobalAiMode(mode: AiGlobalMode) {
    try {
      const res = await apiFetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ai: { mode } }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update AI mode');
      setSettings(data.settings);
      setMetrics((prev) =>
        prev
          ? {
              ...prev,
              aiGlobalMode: mode,
              aiGlobalEnabled: mode !== 'MANUAL_ONLY',
            }
          : prev
      );
      const label =
        mode === 'AUTO_ON'
          ? 'AI Auto-Reply ON'
          : mode === 'OUTSIDE_BUSINESS_HOURS'
          ? 'AI Only Outside Business Hours'
          : 'Manual Only (AI OFF)';
      showToast(`Global mode switched to ${label}`, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Mode switch failed', 'error');
    }
  }

  async function handleNotifyOrder(orderId: string) {
    const res = await apiFetch('/api/ecommerce/notify-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId }),
    });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'Notification failed', 'error');
      return;
    }
    showToast(
      data.deliveredVia === 'local_only'
        ? `Order ${orderId} update logged in Inbox (connect WhatsApp to send live)`
        : `Order ${orderId} WhatsApp update sent via ${data.deliveredVia}`,
      data.deliveredVia === 'local_only' ? 'error' : 'success'
    );
  }

  async function handleLogout() {
    await apiFetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    setStoredAuthToken(null);
    setSettings(null);
    setUser(null);
  }

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-[#0B1120] text-sm text-slate-500">
        Loading workspace...
      </div>
    );
  }

  if (!user) {
    return (
      <AuthGate
        needsSetup={needsSetup}
        darkMode={darkMode}
        onToggleTheme={toggleTheme}
        onAuthenticated={(u) => {
          setUser(u);
          setNeedsSetup(false);
        }}
      />
    );
  }

  const activeNavMeta = NAV_ITEMS.find((i) => i.id === activeTab) || NAV_ITEMS[0];
  const totalUnread = sessions.reduce((sum, s) => sum + (s.unreadCount || 0), 0);

  return (
    <div className="min-h-screen flex bg-slate-50 dark:bg-[#0B1120] text-slate-900 dark:text-slate-100">
      {/* Desktop Sidebar (248px) */}
      <aside className="hidden lg:flex w-[248px] shrink-0 flex-col border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]">
        <div className="h-16 px-5 border-b border-slate-200 dark:border-slate-800 flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-emerald-600 text-white flex items-center justify-center shrink-0">
            <MessageSquare className="w-4 h-4" />
          </div>
          <span className="text-sm font-semibold tracking-tight text-slate-900 dark:text-white whitespace-nowrap truncate">
            BGB WhatsApp CRM
          </span>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`w-full px-3 py-2.5 rounded-lg text-sm font-medium flex items-center justify-between transition-colors ${
                  active
                    ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/70 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <span className="flex items-center gap-2.5 whitespace-nowrap">
                  <Icon className="w-4 h-4 shrink-0" />
                  {item.label}
                </span>
                {item.id === 'inbox' && totalUnread > 0 && (
                  <span className="text-xs font-mono font-semibold text-emerald-700 dark:text-emerald-400 tabular-nums">
                    {totalUnread}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-200 dark:border-slate-800 space-y-2 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-slate-500 dark:text-slate-400">WhatsApp QR</span>
            <span
              className={`font-mono font-medium ${
                baileys.status === 'CONNECTED'
                  ? 'text-emerald-700 dark:text-emerald-400'
                  : 'text-amber-700 dark:text-amber-400'
              }`}
            >
              {baileys.status === 'CONNECTED' ? 'Online' : baileys.status}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-500 dark:text-slate-400">AI Mode</span>
            <span className="font-mono text-slate-700 dark:text-slate-300 truncate max-w-[130px]">
              {(settings?.ai.mode || 'AUTO_ON') === 'AUTO_ON'
                ? 'Auto-Reply ON'
                : settings?.ai.mode === 'OUTSIDE_BUSINESS_HOURS'
                ? 'After Hours'
                : 'Manual Only'}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-500 dark:text-slate-400">Store Link</span>
            <span className="font-mono text-slate-700 dark:text-slate-300 truncate max-w-[130px]">
              bihargraminbazaar.com
            </span>
          </div>
        </div>
      </aside>

      {/* Mobile Drawer */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div className="w-64 bg-white dark:bg-[#111827] border-r border-slate-200 dark:border-slate-800 flex flex-col">
            <div className="h-16 px-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <span className="text-sm font-semibold">BGB WhatsApp CRM</span>
              <button
                type="button"
                onClick={() => setMobileNavOpen(false)}
                className="p-1.5 rounded-lg text-slate-500"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <nav className="p-3 space-y-1 flex-1">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setActiveTab(item.id);
                      setMobileNavOpen(false);
                    }}
                    className={`w-full px-3 py-2.5 rounded-lg text-sm font-medium flex items-center gap-2.5 ${
                      activeTab === item.id
                        ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    {item.label}
                  </button>
                );
              })}
            </nav>
          </div>
          <button
            type="button"
            aria-label="Close navigation"
            className="flex-1 bg-black/40"
            onClick={() => setMobileNavOpen(false)}
          />
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Context Header */}
        <header className="h-16 px-4 sm:px-6 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              className="lg:hidden p-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300"
              aria-label="Open navigation"
            >
              <Menu className="w-4 h-4" />
            </button>
            <div className="flex items-center gap-2 text-sm truncate">
              <span className="text-slate-400 hidden sm:inline">Bihar Gramin Bazaar</span>
              <span className="text-slate-300 dark:text-slate-700 hidden sm:inline">/</span>
              <h1 className="font-semibold text-slate-900 dark:text-white truncate">
                {activeNavMeta.label}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={toggleTheme}
              className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              aria-label="Toggle color theme"
            >
              {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>

            <button
              type="button"
              disabled={syncing}
              onClick={handleSyncStore}
              className="px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-xs font-medium flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
              <span>{syncing ? 'Syncing...' : 'Sync Store'}</span>
            </button>
          </div>
        </header>

        {/* Active View Viewport */}
        <main className="flex-1 p-4 sm:p-6 overflow-y-auto">
          <TabErrorBoundary tabKey={activeTab}>
          {activeTab === 'overview' && (
            <OverviewView
              metrics={metrics}
              recentSessions={sessions.slice(0, 6)}
              recentOrders={orders.slice(0, 6)}
              recentAiLogs={recentAiLogs}
              baileys={baileys}
              aiGlobalMode={settings?.ai.mode || metrics?.aiGlobalMode || 'AUTO_ON'}
              handoverCooldownMinutes={settings?.ai.handoverCooldownMinutes ?? 30}
              syncing={syncing}
              onSyncStore={handleSyncStore}
              onChangeGlobalAiMode={handleChangeGlobalAiMode}
              onNavigate={(tab, phone) => {
                setActiveTab(tab as NavTab);
                if (phone) loadThread(phone);
              }}
            />
          )}

          {activeTab === 'inbox' && (
            <InboxView
              sessions={sessions}
              selectedPhone={selectedPhone}
              messages={messages}
              loadingMessages={loadingMessages}
              products={products}
              orders={orders}
              aiGlobalMode={settings?.ai.mode || 'AUTO_ON'}
              onChangeGlobalAiMode={handleChangeGlobalAiMode}
              onSelectPhone={loadThread}
              onClearSelection={() => setSelectedPhone(null)}
              onRefreshChats={() => void fetchOverviewAndLists()}
              onStartNewChat={handleStartNewChat}
              onSendMessage={handleSendMessage}
              onSendProductCard={handleSendProductCard}
              onToggleChatAi={handleToggleChatAi}
              onNotifyOrder={handleNotifyOrder}
            />
          )}

          {activeTab === 'channels' && (
            <ChannelsView
              baileys={baileys}
              logs={channelLogs}
              settings={settings}
              onBaileysUpdate={setBaileys}
              onLogsUpdate={setChannelLogs}
              onRefreshStatus={fetchOverviewAndLists}
              onSettingsUpdated={setSettings}
              onToast={showToast}
            />
          )}

          {activeTab === 'automation' && (
            settings ? (
              <AutomationView
                settings={settings}
                defaultSystemPrompt={defaultSystemPrompt}
                onSettingsUpdated={setSettings}
                onToast={showToast}
              />
            ) : (
              <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-8 text-center space-y-3">
                <p className="text-sm font-medium text-slate-900 dark:text-white">
                  Loading AI Automation settings...
                </p>
                <button
                  type="button"
                  onClick={() => void fetchOverviewAndLists()}
                  className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium"
                >
                  Retry Loading Settings
                </button>
              </div>
            )
          )}

          {activeTab === 'ecommerce' && (
            <EcommerceView
              products={products}
              orders={orders}
              sessions={sessions}
              lastSyncAt={lastSyncAt}
              syncing={syncing}
              onSyncStore={handleSyncStore}
              onSendProductCard={handleSendProductCard}
              onNotifyOrder={handleNotifyOrder}
            />
          )}

          {activeTab === 'settings' && (
            settings ? (
              <SettingsView
                settings={settings}
                user={user}
                onSettingsUpdated={setSettings}
                onLogout={handleLogout}
                onToast={showToast}
              />
            ) : (
              <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-8 text-center space-y-3">
                <p className="text-sm font-medium text-slate-900 dark:text-white">
                  Loading workspace settings...
                </p>
                <button
                  type="button"
                  onClick={() => void fetchOverviewAndLists()}
                  className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium"
                >
                  Retry Loading Settings
                </button>
              </div>
            )
          )}
          </TabErrorBoundary>
        </main>
      </div>

      {/* Transient Toast Banner */}
      {toast && (
        <div
          className={`fixed bottom-5 right-5 z-50 px-4 py-3 rounded-lg border text-xs font-medium shadow-md max-w-sm ${
            toast.type === 'error'
              ? 'bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-800 text-red-800 dark:text-red-200'
              : 'bg-slate-900 dark:bg-emerald-950 border-slate-800 dark:border-emerald-800 text-white'
          }`}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}
