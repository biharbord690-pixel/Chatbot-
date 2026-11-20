'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Bot,
  Camera,
  CheckCheck,
  Image as ImageIcon,
  Info,
  MessageSquare,
  Mic,
  Package,
  PauseCircle,
  PlayCircle,
  Plus,
  RefreshCw,
  Search,
  Send,
  ShoppingBag,
  Smartphone,
  User,
  X,
} from 'lucide-react';
import { getStoredAuthToken } from '@/lib/api-client';
import type {
  AiGlobalMode,
  ChatMessage,
  ChatSession,
  StoreOrder,
  StoreProduct,
} from '@/lib/types';

interface InboxViewProps {
  sessions: ChatSession[];
  selectedPhone: string | null;
  messages: ChatMessage[];
  loadingMessages: boolean;
  products: StoreProduct[];
  orders: StoreOrder[];
  aiGlobalMode: AiGlobalMode;
  onChangeGlobalAiMode: (mode: AiGlobalMode) => void;
  onSelectPhone: (phone: string) => void;
  onClearSelection?: () => void;
  onRefreshChats?: () => void;
  onStartNewChat: (phone: string, name: string) => Promise<void>;
  onSendMessage: (phone: string, body: string) => Promise<void>;
  onSendProductCard: (phone: string, productId: string, note?: string) => Promise<void>;
  onToggleChatAi: (phone: string, enabled: boolean) => Promise<void>;
  onNotifyOrder: (orderId: string) => Promise<void>;
}

const AVATAR_PALETTES = [
  'bg-emerald-600 text-white',
  'bg-teal-600 text-white',
  'bg-sky-600 text-white',
  'bg-indigo-600 text-white',
  'bg-violet-600 text-white',
  'bg-rose-600 text-white',
  'bg-amber-600 text-white',
  'bg-cyan-700 text-white',
];

function resolveAuthenticatedUrl(url: string | undefined): string {
  if (!url) return '';
  if (!url.startsWith('/api/')) return url;
  const token = getStoredAuthToken();
  if (!token) return url;
  return `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;
}

function getAvatarEndpoint(phone: string): string {
  return resolveAuthenticatedUrl(`/api/chats/${encodeURIComponent(phone)}/avatar`);
}

function formatDisplayPhone(phone: string): string {
  const digits = phone.replace(/[^0-9]/g, '');
  if (digits.length === 12 && digits.startsWith('91')) {
    return `+91 ${digits.slice(2, 7)} ${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;
  }
  return `+${digits}`;
}

function getDisplayName(session: ChatSession): string {
  const raw = (session.name || '').trim();
  if (!raw || raw === session.phone || raw === `+${session.phone}`) {
    return formatDisplayPhone(session.phone);
  }
  return raw;
}

function getInitials(name: string): string {
  const stripped = name.replace(/[^\p{L}\p{N}\s]/gu, ' ').trim();
  if (!stripped || /^\d[\d\s+]*$/.test(stripped)) return '';
  const words = stripped.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return `${words[0][0]}${words[1][0]}`.toUpperCase();
  }
  return words[0].slice(0, 2).toUpperCase();
}

function pickAvatarPalette(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return AVATAR_PALETTES[hash % AVATAR_PALETTES.length];
}

function isAiPaused(session: ChatSession, nowMs: number): boolean {
  if (!session.aiEnabled || session.aiPausedIndefinitely) return true;
  if (session.aiPausedUntil && new Date(session.aiPausedUntil).getTime() > nowMs) {
    return true;
  }
  return false;
}

function getPauseReasonText(session: ChatSession, nowMs: number): string {
  if (session.aiPausedIndefinitely || !session.aiEnabled) {
    if (session.handoverSource === 'command') {
      return 'Paused via phone #manual / #stop';
    }
    return 'Paused manually';
  }
  if (session.aiPausedUntil) {
    const diffMs = new Date(session.aiPausedUntil).getTime() - nowMs;
    if (diffMs > 0) {
      const mins = Math.max(1, Math.ceil(diffMs / 60000));
      const src = session.handoverSource === 'phone' ? 'Phone reply' : 'Dashboard reply';
      return `${src} · resumes in ${mins}m`;
    }
  }
  return '';
}

function formatClock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function formatListTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return formatClock(iso);
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (
    d.getFullYear() === yesterday.getFullYear() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getDate() === yesterday.getDate()
  ) {
    return 'Yesterday';
  }
  return d.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  });
}

function formatDateDivider(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) return 'Today';
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (
    d.getFullYear() === yesterday.getFullYear() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getDate() === yesterday.getDate()
  ) {
    return 'Yesterday';
  }
  return d.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function renderWhatsAppFormattedText(text: string): React.ReactNode {
  // Render native WhatsApp *bold* cleanly inside bubbles
  const parts = text.split(/(\*[^*\n]+\*)/g);
  return parts.map((part, idx) => {
    if (part.length > 2 && part.startsWith('*') && part.endsWith('*')) {
      return (
        <strong key={idx} className="font-semibold">
          {part.slice(1, -1)}
        </strong>
      );
    }
    return <React.Fragment key={idx}>{part}</React.Fragment>;
  });
}

interface ContactAvatarProps {
  phone: string;
  name: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  statusDot?: 'ai' | 'paused' | null;
  onClick?: (e: React.MouseEvent) => void;
}

function ContactAvatar({
  phone,
  name,
  size = 'md',
  statusDot = null,
  onClick,
}: ContactAvatarProps) {
  const [failedPhone, setFailedPhone] = useState<string | null>(null);
  const imgFailed = failedPhone === phone;
  const avatarSrc = useMemo(() => getAvatarEndpoint(phone), [phone]);
  const initials = useMemo(() => getInitials(name), [name]);
  const palette = useMemo(() => pickAvatarPalette(phone), [phone]);

  const sizeClass =
    size === 'xl'
      ? 'w-24 h-24 text-2xl'
      : size === 'lg'
      ? 'w-14 h-14 text-lg'
      : size === 'sm'
      ? 'w-10 h-10 text-xs'
      : 'w-12 h-12 text-sm';

  const dotClass =
    size === 'sm'
      ? 'w-2.5 h-2.5 border-[1.5px]'
      : 'w-3 h-3 border-2';

  const inner = (
    <div
      className={`relative ${sizeClass} rounded-full shrink-0 select-none overflow-visible`}
    >
      <div
        className={`w-full h-full rounded-full overflow-hidden flex items-center justify-center font-semibold ${
          imgFailed ? palette : 'bg-slate-200 dark:bg-slate-700'
        }`}
      >
        {!imgFailed && avatarSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={avatarSrc}
            alt={name}
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setFailedPhone(phone)}
            className="w-full h-full object-cover"
          />
        ) : initials ? (
          <span>{initials}</span>
        ) : (
          <User className={size === 'xl' ? 'w-10 h-10' : size === 'sm' ? 'w-4 h-4' : 'w-5 h-5'} />
        )}
      </div>

      {statusDot && (
        <span
          title={statusDot === 'ai' ? 'AI Active' : 'AI Paused'}
          className={`absolute bottom-0 right-0 ${dotClass} rounded-full border-white dark:border-[#111B21] ${
            statusDot === 'ai' ? 'bg-[#25D366]' : 'bg-amber-500'
          }`}
        />
      )}
    </div>
  );

  if (onClick) {
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onClick(e as unknown as React.MouseEvent);
          }
        }}
        className="shrink-0 rounded-full focus:outline-none focus:ring-2 focus:ring-[#25D366]"
      >
        {inner}
      </div>
    );
  }

  return inner;
}

export default function InboxView({
  sessions,
  selectedPhone,
  messages,
  loadingMessages,
  products,
  orders,
  aiGlobalMode,
  onChangeGlobalAiMode,
  onSelectPhone,
  onClearSelection,
  onRefreshChats,
  onStartNewChat,
  onSendMessage,
  onSendProductCard,
  onToggleChatAi,
  onNotifyOrder,
}: InboxViewProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterTab, setFilterTab] = useState<'all' | 'ai' | 'paused' | 'unread'>('all');
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  // Modals / Drawers
  const [showNewChat, setShowNewChat] = useState(false);
  const [newPhone, setNewPhone] = useState('');
  const [newName, setNewName] = useState('');

  const [productPickerPhone, setProductPickerPhone] = useState<string | null>(null);
  const [productSearch, setProductSearch] = useState('');
  const [productNote, setProductNote] = useState('');
  const [mobileInfoPhone, setMobileInfoPhone] = useState<string | null>(null);
  const [profilePreview, setProfilePreview] = useState<ChatSession | null>(null);
  const [lightboxImageUrl, setLightboxImageUrl] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  const showProductPicker = Boolean(selectedPhone && productPickerPhone === selectedPhone);
  const showMobileInfo = Boolean(selectedPhone && mobileInfoPhone === selectedPhone);
  const setShowProductPicker = (val: boolean | ((prev: boolean) => boolean)) => {
    const next = typeof val === 'function' ? val(showProductPicker) : val;
    setProductPickerPhone(next && selectedPhone ? selectedPhone : null);
  };
  const setShowMobileInfo = (val: boolean | ((prev: boolean) => boolean)) => {
    const next = typeof val === 'function' ? val(showMobileInfo) : val;
    setMobileInfoPhone(next && selectedPhone ? selectedPhone : null);
  };

  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, selectedPhone]);

  const filteredSessions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return sessions.filter((s) => {
      if (filterTab === 'ai' && isAiPaused(s, nowMs)) return false;
      if (filterTab === 'paused' && !isAiPaused(s, nowMs)) return false;
      if (filterTab === 'unread' && s.unreadCount === 0) return false;
      if (!q) return true;
      return (
        s.name.toLowerCase().includes(q) ||
        s.phone.includes(q) ||
        s.lastMessage.toLowerCase().includes(q)
      );
    });
  }, [sessions, searchQuery, filterTab, nowMs]);

  const activeSession = useMemo(
    () => sessions.find((s) => s.phone === selectedPhone) || null,
    [sessions, selectedPhone]
  );

  const customerOrders = useMemo(() => {
    if (!activeSession) return [];
    const last10 = activeSession.phone.slice(-10);
    return orders.filter((o) => o.phone.replace(/[^0-9]/g, '').slice(-10) === last10);
  }, [orders, activeSession]);

  const filteredProducts = useMemo(() => {
    const q = productSearch.trim().toLowerCase();
    return products
      .filter((p) => {
        if (!q) return true;
        return (
          p.name.toLowerCase().includes(q) ||
          p.hindiName.toLowerCase().includes(q) ||
          p.sku.toLowerCase().includes(q) ||
          p.category.toLowerCase().includes(q)
        );
      })
      .slice(0, 20);
  }, [products, productSearch]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!activeSession || !draft.trim() || sending) return;
    const text = draft.trim();
    setDraft('');
    setSending(true);
    try {
      await onSendMessage(activeSession.phone, text);
    } finally {
      setSending(false);
    }
  }

  async function handleCreateChat(e: React.FormEvent) {
    e.preventDefault();
    if (!newPhone.trim()) return;
    await onStartNewChat(newPhone.trim(), newName.trim());
    setNewPhone('');
    setNewName('');
    setShowNewChat(false);
  }

  const renderContextBody = (session: ChatSession) => (
    <div className="space-y-5 text-xs">
      <div className="flex flex-col items-center text-center pb-4 border-b border-slate-200 dark:border-slate-800">
        <ContactAvatar
          phone={session.phone}
          name={getDisplayName(session)}
          size="xl"
          statusDot={isAiPaused(session, nowMs) ? 'paused' : 'ai'}
        />
        <h4 className="mt-3 text-base font-semibold text-slate-900 dark:text-white">
          {getDisplayName(session)}
        </h4>
        <p className="text-xs font-mono text-slate-500 dark:text-slate-400 mt-0.5">
          {formatDisplayPhone(session.phone)}
        </p>
        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={() => onToggleChatAi(session.phone, isAiPaused(session, nowMs))}
            className={`px-3 py-1.5 rounded-full text-xs font-medium flex items-center gap-1.5 transition-colors ${
              isAiPaused(session, nowMs)
                ? 'bg-[#00A884] hover:bg-[#008F72] text-white'
                : 'bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300'
            }`}
          >
            {isAiPaused(session, nowMs) ? (
              <>
                <PlayCircle className="w-3.5 h-3.5" /> Resume AI
              </>
            ) : (
              <>
                <PauseCircle className="w-3.5 h-3.5" /> Pause AI
              </>
            )}
          </button>
        </div>
      </div>

      <div className="space-y-2">
        <p className="font-medium text-slate-500 dark:text-slate-400">Session Memory</p>
        <div className="space-y-1.5 text-slate-700 dark:text-slate-300">
          <div className="flex justify-between">
            <span className="text-slate-500">State</span>
            <span className="font-mono font-medium">{session.state}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Last Product</span>
            <span className="truncate max-w-[150px] text-right">
              {session.context.lastProductName || 'None'}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Last Order ID</span>
            <span className="font-mono">{session.context.lastOrderId || 'None'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">District</span>
            <span>{session.context.district || 'Unknown'}</span>
          </div>
        </div>
      </div>

      <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-2">
        <p className="font-medium text-slate-500 dark:text-slate-400">Global AI Mode</p>
        <select
          value={aiGlobalMode}
          onChange={(e) => onChangeGlobalAiMode(e.target.value as AiGlobalMode)}
          className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
        >
          <option value="AUTO_ON">AI Auto-Reply ON</option>
          <option value="OUTSIDE_BUSINESS_HOURS">AI Only Outside Business Hours</option>
          <option value="MANUAL_ONLY">Manual Only (AI OFF)</option>
        </select>
        <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed pt-1">
          From your phone WhatsApp, send <span className="font-mono">#manual</span> or{' '}
          <span className="font-mono">#stop</span> to pause AI indefinitely, or{' '}
          <span className="font-mono">#ai</span> / <span className="font-mono">#start</span> to
          resume immediately.
        </p>
      </div>

      <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-2.5">
        <div className="flex items-center justify-between">
          <p className="font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
            <Package className="w-3.5 h-3.5" /> Matched Live Orders
          </p>
          <span className="font-mono text-slate-400">{customerOrders.length}</span>
        </div>

        {customerOrders.length === 0 ? (
          <p className="text-slate-500 dark:text-slate-400">
            No orders found for {formatDisplayPhone(session.phone)}.
          </p>
        ) : (
          <div className="space-y-2.5">
            {customerOrders.map((ord) => (
              <div
                key={ord.id}
                className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 space-y-1.5"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono font-semibold text-slate-900 dark:text-white">
                    {ord.id}
                  </span>
                  <span className="font-mono font-semibold tabular-nums">₹{ord.totalAmount}</span>
                </div>
                <p className="text-slate-600 dark:text-slate-400">
                  {ord.deliveryStage} · {ord.collectedMethod || ord.paymentMethod}
                </p>
                {ord.assignedAgentName && (
                  <p className="text-slate-500">
                    Agent: {ord.assignedAgentName}{' '}
                    {ord.assignedAgentPhone ? `(${ord.assignedAgentPhone})` : ''}
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => onNotifyOrder(ord.id)}
                  className="w-full mt-1 py-1.5 rounded border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-[11px] font-medium text-slate-800 dark:text-slate-200"
                >
                  Send Status Update
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="h-[calc(100vh-116px)] min-h-[560px] bg-white dark:bg-[#111B21] border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden grid grid-cols-1 lg:grid-cols-12 shadow-xs">
      {/* Left Pane: WhatsApp-Style Chat List with Contact Profile Pictures */}
      <aside
        className={`${
          activeSession ? 'hidden lg:flex' : 'flex'
        } lg:col-span-4 xl:col-span-3 border-r border-slate-200 dark:border-slate-800 flex-col min-h-0 bg-white dark:bg-[#111B21]`}
      >
        {/* WhatsApp-Style List Header */}
        <div className="px-4 py-3 bg-[#075E54] dark:bg-[#202C33] text-white flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <h2 className="text-base font-semibold tracking-tight truncate">WhatsApp</h2>
            <span className="px-1.5 py-0.5 rounded-full bg-white/15 text-[11px] font-mono tabular-nums">
              {sessions.length}
            </span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {onRefreshChats && (
              <button
                type="button"
                onClick={onRefreshChats}
                title="Refresh WhatsApp chats"
                className="p-1.5 rounded-full hover:bg-white/15 text-white/90 transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowNewChat((v) => !v)}
              className="px-2.5 py-1 rounded-full bg-white/15 hover:bg-white/25 text-xs font-medium flex items-center gap-1 whitespace-nowrap transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              New
            </button>
          </div>
        </div>

        {/* Search & Filter Controls */}
        <div className="px-3 py-2.5 border-b border-slate-100 dark:border-slate-800/80 space-y-2 bg-white dark:bg-[#111B21]">
          {showNewChat && (
            <form
              onSubmit={handleCreateChat}
              className="p-3 rounded-xl bg-slate-50 dark:bg-[#202C33] border border-slate-200 dark:border-slate-700 space-y-2"
            >
              <input
                type="text"
                required
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value)}
                placeholder="WhatsApp No. (e.g. 919472258022)"
                className="w-full px-3 py-1.5 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-[#111B21]"
              />
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Customer Name (optional)"
                className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-[#111B21]"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowNewChat(false)}
                  className="px-2.5 py-1 text-xs text-slate-500 hover:text-slate-800 dark:text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-3 py-1 rounded-full bg-[#00A884] text-white text-xs font-medium"
                >
                  Open Chat
                </button>
              </div>
            </form>
          )}

          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search name, phone, message..."
              className="w-full pl-9 pr-3 py-2 text-xs rounded-full bg-[#F0F2F5] dark:bg-[#202C33] text-slate-900 dark:text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-[#00A884]"
            />
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
            {(['all', 'ai', 'paused', 'unread'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setFilterTab(tab)}
                className={`px-3 py-1 rounded-full text-xs font-medium capitalize transition-colors whitespace-nowrap ${
                  filterTab === tab
                    ? 'bg-[#D9FDD3] dark:bg-[#0A332C] text-[#008069] dark:text-[#25D366]'
                    : 'bg-[#F0F2F5] dark:bg-[#202C33] text-slate-600 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-700/60'
                }`}
              >
                {tab === 'ai' ? 'AI Active' : tab}
              </button>
            ))}
          </div>
        </div>

        {/* WhatsApp Chat Rows */}
        <div className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/60">
          {filteredSessions.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400">
              No matching chats. Connect WhatsApp in QR & Channels or start a new chat.
            </div>
          ) : (
            filteredSessions.map((session) => {
              const paused = isAiPaused(session, nowMs);
              const selected = session.phone === selectedPhone;
              const displayName = getDisplayName(session);
              const isPhotoPreview = session.lastMessage.startsWith('[Photo');
              const isVoicePreview = session.lastMessage.startsWith('[Voice');

              return (
                <div
                  key={session.phone}
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelectPhone(session.phone)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSelectPhone(session.phone);
                    }
                  }}
                  className={`w-full px-3.5 py-3 flex items-center gap-3 cursor-pointer transition-colors ${
                    selected
                      ? 'bg-[#F0F2F5] dark:bg-[#2A3942]'
                      : 'hover:bg-slate-50 dark:hover:bg-[#202C33]/70'
                  }`}
                >
                  {/* Real WhatsApp Profile Picture (DP) */}
                  <ContactAvatar
                    phone={session.phone}
                    name={displayName}
                    size="md"
                    statusDot={paused ? 'paused' : 'ai'}
                    onClick={(e) => {
                      e.stopPropagation();
                      setProfilePreview(session);
                    }}
                  />

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[15px] font-semibold text-slate-900 dark:text-[#E9EDEF] truncate">
                        {displayName}
                      </span>
                      <span
                        className={`text-[11px] tabular-nums shrink-0 ${
                          session.unreadCount > 0
                            ? 'text-[#00A884] dark:text-[#25D366] font-semibold'
                            : 'text-slate-400 dark:text-slate-400'
                        }`}
                      >
                        {formatListTime(session.lastMessageAt)}
                      </span>
                    </div>

                    <div className="mt-0.5 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1 min-w-0 text-[13px] text-slate-500 dark:text-[#8696A0]">
                        {session.lastMessageDirection === 'OUTBOUND' && session.lastMessage && (
                          <CheckCheck className="w-4 h-4 text-[#53BDEB] shrink-0" />
                        )}
                        {isPhotoPreview && <Camera className="w-3.5 h-3.5 shrink-0" />}
                        {isVoicePreview && <Mic className="w-3.5 h-3.5 shrink-0 text-[#00A884]" />}
                        <span className="truncate">
                          {session.lastMessage || formatDisplayPhone(session.phone)}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        {paused && (
                          <span className="text-[10px] font-medium text-amber-600 dark:text-amber-400">
                            Paused
                          </span>
                        )}
                        {session.unreadCount > 0 && (
                          <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-[#25D366] text-white text-[11px] font-bold flex items-center justify-center tabular-nums">
                            {session.unreadCount > 99 ? '99+' : session.unreadCount}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </aside>

      {/* Center Pane: Full WhatsApp-Style Chat Page (Full-screen overlay on Mobile, Split Pane on Desktop) */}
      <section
        className={`${
          activeSession
            ? 'fixed inset-0 z-50 flex lg:static lg:z-auto'
            : 'hidden lg:flex'
        } lg:col-span-8 xl:col-span-6 flex-col min-h-0 bg-[#EFEAE2] dark:bg-[#0B141A]`}
      >
        {!activeSession ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-[#F0F2F5] dark:bg-[#222E35]">
            <div className="w-16 h-16 rounded-full bg-[#00A884]/15 text-[#00A884] flex items-center justify-center mb-4">
              <MessageSquare className="w-8 h-8" />
            </div>
            <p className="text-base font-semibold text-slate-800 dark:text-[#E9EDEF]">
              Bihar Gramin Bazaar WhatsApp Web
            </p>
            <p className="text-xs text-slate-500 dark:text-[#8696A0] mt-1.5 max-w-sm">
              Kisi bhi contact par click karein — bilkul WhatsApp ki tarah unki DP, chats, photos,
              voice notes aur AI replies yahin dikhenge.
            </p>
          </div>
        ) : (
          <>
            {/* Authentic WhatsApp Top Header Bar */}
            <header className="px-2.5 sm:px-4 py-2.5 bg-[#075E54] dark:bg-[#202C33] text-white flex items-center justify-between gap-2 shadow-xs shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                {onClearSelection && (
                  <button
                    type="button"
                    onClick={onClearSelection}
                    aria-label="Back to WhatsApp chats"
                    className="lg:hidden p-1.5 rounded-full hover:bg-white/15 text-white shrink-0"
                  >
                    <ArrowLeft className="w-5 h-5" />
                  </button>
                )}

                <ContactAvatar
                  phone={activeSession.phone}
                  name={getDisplayName(activeSession)}
                  size="sm"
                  onClick={() => setProfilePreview(activeSession)}
                />

                <button
                  type="button"
                  onClick={() => setShowMobileInfo(true)}
                  className="min-w-0 text-left hover:opacity-90"
                >
                  <h3 className="text-[15px] font-semibold leading-tight truncate text-white">
                    {getDisplayName(activeSession)}
                  </h3>
                  <p className="text-[11px] text-white/80 truncate mt-0.5">
                    {isAiPaused(activeSession, nowMs)
                      ? `AI Paused · ${getPauseReasonText(activeSession, nowMs) || 'Human handling'}`
                      : `${formatDisplayPhone(activeSession.phone)} · AI Active`}
                  </p>
                </button>
              </div>

              <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() =>
                    onToggleChatAi(activeSession.phone, isAiPaused(activeSession, nowMs))
                  }
                  title={isAiPaused(activeSession, nowMs) ? 'Resume AI' : 'Pause AI'}
                  className={`px-2.5 py-1.5 rounded-full text-[11px] font-semibold flex items-center gap-1 whitespace-nowrap transition-colors ${
                    isAiPaused(activeSession, nowMs)
                      ? 'bg-[#25D366] hover:bg-[#1FB859] text-slate-950'
                      : 'bg-white/15 hover:bg-white/25 text-white'
                  }`}
                >
                  {isAiPaused(activeSession, nowMs) ? (
                    <>
                      <PlayCircle className="w-3.5 h-3.5" />
                      <span>Resume AI</span>
                    </>
                  ) : (
                    <>
                      <PauseCircle className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">Pause AI</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => setShowProductPicker((v) => !v)}
                  title="Send Live Product Card"
                  className="p-2 rounded-full hover:bg-white/15 text-white transition-colors"
                >
                  <ShoppingBag className="w-4 h-4" />
                </button>

                <button
                  type="button"
                  onClick={() => setShowMobileInfo((v) => !v)}
                  title="Contact & Order Info"
                  className="xl:hidden p-2 rounded-full hover:bg-white/15 text-white transition-colors"
                >
                  <Info className="w-4 h-4" />
                </button>
              </div>
            </header>

            {/* Compact Pause Strip when Human Handover Active */}
            {isAiPaused(activeSession, nowMs) && (
              <div className="px-3.5 py-1.5 bg-amber-100/95 dark:bg-amber-950/80 border-b border-amber-200 dark:border-amber-900 flex items-center justify-between gap-2 text-[11px] text-amber-950 dark:text-amber-200 shrink-0">
                <span className="flex items-center gap-1.5 truncate">
                  <Smartphone className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">
                    AI Paused ({getPauseReasonText(activeSession, nowMs) || 'Manual mode'})
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => onToggleChatAi(activeSession.phone, true)}
                  className="font-semibold text-emerald-800 dark:text-emerald-300 hover:underline shrink-0"
                >
                  Resume AI
                </button>
              </div>
            )}

            {/* Inline Quick-Send Product Drawer */}
            {showProductPicker && (
              <div className="p-3.5 bg-white dark:bg-[#111B21] border-b border-slate-200 dark:border-slate-800 space-y-2.5 shrink-0">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-slate-900 dark:text-white">
                    Send Live Product from bihargraminbazaar.com
                  </p>
                  <button
                    type="button"
                    onClick={() => setShowProductPicker(false)}
                    className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input
                    type="text"
                    value={productSearch}
                    onChange={(e) => setProductSearch(e.target.value)}
                    placeholder="Search product name or SKU..."
                    className="px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#202C33]"
                  />
                  <input
                    type="text"
                    value={productNote}
                    onChange={(e) => setProductNote(e.target.value)}
                    placeholder="Optional note above card..."
                    className="px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#202C33]"
                  />
                </div>
                <div className="max-h-40 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-lg">
                  {filteredProducts.length === 0 ? (
                    <div className="p-3 text-xs text-slate-500 text-center">
                      No matching products. Sync store catalog first.
                    </div>
                  ) : (
                    filteredProducts.map((p) => (
                      <div
                        key={p.id}
                        className="px-3 py-2 flex items-center justify-between gap-3 hover:bg-slate-50 dark:hover:bg-[#202C33]"
                      >
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-slate-900 dark:text-slate-100 truncate">
                            {p.name}
                          </p>
                          <p className="text-[11px] font-mono text-slate-500">
                            ₹{p.price} · {p.inStock ? `In stock (${p.stockCount})` : 'Out of stock'}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={async () => {
                            await onSendProductCard(activeSession.phone, p.id, productNote);
                            setShowProductPicker(false);
                            setProductNote('');
                          }}
                          className="px-2.5 py-1 rounded-full bg-[#00A884] hover:bg-[#008F72] text-white text-[11px] font-medium whitespace-nowrap"
                        >
                          Send
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* Authentic WhatsApp Chat Feed */}
            <div className="flex-1 overflow-y-auto px-3 sm:px-5 py-4 space-y-2">
              {loadingMessages ? (
                <div className="flex justify-center py-6">
                  <span className="px-3 py-1 rounded-full bg-white/90 dark:bg-[#202C33] text-xs text-slate-600 dark:text-slate-300 shadow-xs">
                    Loading messages...
                  </span>
                </div>
              ) : messages.length === 0 ? (
                <div className="flex justify-center py-8">
                  <span className="px-4 py-2 rounded-xl bg-[#FFF5C4] dark:bg-[#182229] text-xs text-slate-700 dark:text-[#FFD279] text-center max-w-xs shadow-xs">
                    Start chatting with {getDisplayName(activeSession)} below. Messages deliver
                    directly on WhatsApp.
                  </span>
                </div>
              ) : (
                messages.map((msg, idx) => {
                  const outbound = msg.direction === 'OUTBOUND';
                  const dateLabel = formatDateDivider(msg.createdAt);
                  const prevDateLabel =
                    idx > 0 ? formatDateDivider(messages[idx - 1].createdAt) : '';
                  const showDateChip = dateLabel && dateLabel !== prevDateLabel;

                  return (
                    <React.Fragment key={msg.id}>
                      {showDateChip && (
                        <div className="flex justify-center my-2">
                          <span className="px-3 py-1 rounded-lg bg-white/90 dark:bg-[#182229] text-[11px] font-medium text-slate-600 dark:text-[#8696A0] shadow-xs">
                            {dateLabel}
                          </span>
                        </div>
                      )}

                      <div className={`flex ${outbound ? 'justify-end' : 'justify-start'}`}>
                        <div
                          className={`relative max-w-[85%] sm:max-w-[76%] px-3 py-2 text-[14px] shadow-xs ${
                            outbound
                              ? 'bg-[#D9FDD3] dark:bg-[#005C4B] text-slate-900 dark:text-[#E9EDEF] rounded-2xl rounded-tr-none'
                              : 'bg-white dark:bg-[#202C33] text-slate-900 dark:text-[#E9EDEF] rounded-2xl rounded-tl-none'
                          }`}
                        >
                          {/* Subtle Sender Tag (AI / Phone / You) on Outbound */}
                          {outbound && (
                            <div className="flex items-center gap-1 text-[10px] font-semibold text-emerald-800/80 dark:text-emerald-200/80 mb-0.5">
                              {msg.senderType === 'AI' ? (
                                <>
                                  <Bot className="w-3 h-3" />
                                  <span>BGB AI Assistant</span>
                                </>
                              ) : msg.origin === 'phone' ? (
                                <>
                                  <Smartphone className="w-3 h-3" />
                                  <span>Phone Reply</span>
                                </>
                              ) : (
                                <>
                                  <User className="w-3 h-3" />
                                  <span>You</span>
                                </>
                              )}
                            </div>
                          )}

                          {msg.productCard?.image && (
                            <div className="mb-1.5 rounded-xl overflow-hidden border border-black/10 bg-black/5">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={msg.productCard.image}
                                alt={msg.productCard.name}
                                className="w-full max-h-44 object-cover"
                                referrerPolicy="no-referrer"
                              />
                            </div>
                          )}

                          {msg.messageType === 'image' && (
                            <div className="mb-1.5">
                              {msg.mediaUrl ? (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setLightboxImageUrl(resolveAuthenticatedUrl(msg.mediaUrl))
                                  }
                                  className="block rounded-xl overflow-hidden border border-black/10 bg-black/5"
                                >
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img
                                    src={resolveAuthenticatedUrl(msg.mediaUrl)}
                                    alt="Customer photo"
                                    className="w-full max-w-[260px] max-h-60 object-cover"
                                    referrerPolicy="no-referrer"
                                  />
                                </button>
                              ) : (
                                <div className="inline-flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-300">
                                  <ImageIcon className="w-3.5 h-3.5" />
                                  <span>Photo</span>
                                </div>
                              )}
                            </div>
                          )}

                          {msg.messageType === 'audio' && (
                            <div className="mb-1.5 space-y-1">
                              <div className="inline-flex items-center gap-1.5 text-xs font-medium text-[#008069] dark:text-[#25D366]">
                                <Mic className="w-3.5 h-3.5" />
                                <span>Voice message</span>
                              </div>
                              {msg.mediaUrl && (
                                <audio
                                  controls
                                  preload="metadata"
                                  src={resolveAuthenticatedUrl(msg.mediaUrl)}
                                  className="w-full min-w-[210px] max-w-[260px] h-9"
                                />
                              )}
                            </div>
                          )}

                          <p className="whitespace-pre-wrap leading-relaxed break-words">
                            {renderWhatsAppFormattedText(msg.body)}
                          </p>

                          {/* WhatsApp Bottom-Right Timestamp & Blue Double Ticks */}
                          <div className="mt-1 flex items-center justify-end gap-1 text-[10px] text-slate-500 dark:text-white/65 tabular-nums">
                            {outbound && msg.status === 'FAILED' && (
                              <span className="text-amber-700 dark:text-amber-300 mr-1">
                                Offline
                              </span>
                            )}
                            <span>{formatClock(msg.createdAt)}</span>
                            {outbound && (
                              <CheckCheck
                                className={`w-3.5 h-3.5 ${
                                  msg.status === 'FAILED'
                                    ? 'text-slate-400'
                                    : 'text-[#53BDEB]'
                                }`}
                              />
                            )}
                          </div>
                        </div>
                      </div>
                    </React.Fragment>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Authentic WhatsApp Bottom Message Composer */}
            <form
              onSubmit={handleSend}
              className="px-2.5 sm:px-3.5 py-2.5 bg-[#F0F2F5] dark:bg-[#202C33] flex items-center gap-2 shrink-0"
            >
              <button
                type="button"
                onClick={() => setShowProductPicker((v) => !v)}
                title="Attach product card"
                className="p-2.5 rounded-full text-slate-600 dark:text-[#8696A0] hover:bg-black/5 dark:hover:bg-white/10 shrink-0"
              >
                <ShoppingBag className="w-5 h-5" />
              </button>

              <input
                type="text"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Message"
                className="flex-1 px-4 py-2.5 text-sm rounded-full bg-white dark:bg-[#2A3942] text-slate-900 dark:text-[#E9EDEF] placeholder:text-slate-500 dark:placeholder:text-[#8696A0] border border-transparent focus:outline-none focus:border-[#00A884]"
              />

              <button
                type="submit"
                disabled={!draft.trim() || sending}
                aria-label="Send WhatsApp message"
                className="w-10 h-10 rounded-full bg-[#00A884] hover:bg-[#008F72] disabled:opacity-50 text-white flex items-center justify-center shrink-0 shadow-xs transition-colors"
              >
                <Send className="w-4 h-4" />
              </button>
            </form>
          </>
        )}
      </section>

      {/* Right Pane (Desktop XL): Contact Profile & Matched Live Orders */}
      <aside className="hidden xl:flex xl:col-span-3 border-l border-slate-200 dark:border-slate-800 flex-col min-h-0 bg-white dark:bg-[#111B21]">
        <div className="px-4 py-3.5 border-b border-slate-200 dark:border-slate-800">
          <h3 className="text-xs font-semibold text-slate-900 dark:text-white">
            Contact Profile & Orders
          </h3>
        </div>
        {!activeSession ? (
          <div className="p-5 text-xs text-slate-500 dark:text-slate-400">
            Select a chat to view contact DP, session memory, and Bihar Gramin Bazaar live orders.
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-4">{renderContextBody(activeSession)}</div>
        )}
      </aside>

      {/* Mobile/Tablet Slide-Over Contact Profile & Orders Sheet */}
      {showMobileInfo && activeSession && (
        <div
          className="fixed inset-0 z-[60] bg-black/60 flex justify-end xl:hidden"
          onClick={() => setShowMobileInfo(false)}
        >
          <div
            className="w-full max-w-sm bg-white dark:bg-[#111B21] h-full flex flex-col shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3 bg-[#075E54] dark:bg-[#202C33] text-white flex items-center justify-between">
              <span className="text-sm font-semibold">Contact Info</span>
              <button
                type="button"
                onClick={() => setShowMobileInfo(false)}
                className="p-1 rounded-full hover:bg-white/15"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">{renderContextBody(activeSession)}</div>
          </div>
        </div>
      )}

      {/* WhatsApp-Style Quick Profile Picture Preview Modal */}
      {profilePreview && (
        <div
          className="fixed inset-0 z-[65] bg-black/75 flex items-center justify-center p-4"
          onClick={() => setProfilePreview(null)}
        >
          <div
            className="w-72 bg-white dark:bg-[#202C33] rounded-2xl overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="relative bg-[#075E54] dark:bg-[#111B21] p-6 flex flex-col items-center">
              <button
                type="button"
                onClick={() => setProfilePreview(null)}
                aria-label="Close profile preview"
                className="absolute top-3 right-3 p-1.5 rounded-full bg-black/30 text-white hover:bg-black/50"
              >
                <X className="w-4 h-4" />
              </button>
              <ContactAvatar
                phone={profilePreview.phone}
                name={getDisplayName(profilePreview)}
                size="xl"
              />
              <p className="mt-3 text-base font-semibold text-white text-center">
                {getDisplayName(profilePreview)}
              </p>
              <p className="text-xs font-mono text-white/80 mt-0.5">
                {formatDisplayPhone(profilePreview.phone)}
              </p>
            </div>
            <div className="p-3 flex items-center justify-around border-t border-slate-100 dark:border-slate-700">
              <button
                type="button"
                onClick={() => {
                  onSelectPhone(profilePreview.phone);
                  setProfilePreview(null);
                }}
                className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#00A884] text-white text-xs font-semibold"
              >
                <MessageSquare className="w-3.5 h-3.5" />
                Open Chat
              </button>
              <button
                type="button"
                onClick={() => {
                  onToggleChatAi(profilePreview.phone, isAiPaused(profilePreview, nowMs));
                  setProfilePreview(null);
                }}
                className="flex items-center gap-1.5 px-3 py-2 rounded-full border border-slate-300 dark:border-slate-600 text-xs font-medium text-slate-700 dark:text-slate-200"
              >
                {isAiPaused(profilePreview, nowMs) ? 'Resume AI' : 'Pause AI'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Inline Photo Lightbox Modal */}
      {lightboxImageUrl && (
        <div
          className="fixed inset-0 z-[70] bg-black/85 flex items-center justify-center p-4"
          onClick={() => setLightboxImageUrl(null)}
        >
          <div
            className="relative max-w-3xl max-h-[85vh] bg-slate-950 rounded-xl overflow-hidden border border-slate-800"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setLightboxImageUrl(null)}
              aria-label="Close photo preview"
              className="absolute top-3 right-3 p-1.5 rounded-full bg-black/60 text-white hover:bg-black/80"
            >
              <X className="w-4 h-4" />
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={lightboxImageUrl}
              alt="Customer photo preview"
              className="max-w-full max-h-[82vh] object-contain"
              referrerPolicy="no-referrer"
            />
          </div>
        </div>
      )}
    </div>
  );
}
