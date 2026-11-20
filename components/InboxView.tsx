'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Bot,
  Image as ImageIcon,
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

function resolveAuthenticatedMediaUrl(url: string | undefined): string {
  if (!url) return '';
  if (!url.startsWith('/api/media/')) return url;
  const token = getStoredAuthToken();
  if (!token) return url;
  return `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;
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
      return 'Paused indefinitely via phone #manual / #stop';
    }
    return 'Paused manually until resumed';
  }
  if (session.aiPausedUntil) {
    const diffMs = new Date(session.aiPausedUntil).getTime() - nowMs;
    if (diffMs > 0) {
      const mins = Math.max(1, Math.ceil(diffMs / 60000));
      const src = session.handoverSource === 'phone' ? 'Phone reply' : 'Dashboard reply';
      return `${src} · auto-resumes in ${mins}m`;
    }
  }
  return '';
}

function formatClock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
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

  const [showProductPicker, setShowProductPicker] = useState(false);
  const [productSearch, setProductSearch] = useState('');
  const [productNote, setProductNote] = useState('');
  const [lightboxImageUrl, setLightboxImageUrl] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

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

  return (
    <div className="h-[calc(100vh-124px)] min-h-[580px] bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden grid grid-cols-1 lg:grid-cols-12">
      {/* Left Pane: All Connected WhatsApp Conversations */}
      <aside
        className={`${
          activeSession ? 'hidden lg:flex' : 'flex'
        } lg:col-span-4 xl:col-span-3 border-b lg:border-b-0 lg:border-r border-slate-200 dark:border-slate-800 flex-col min-h-0`}
      >
        <div className="p-3.5 border-b border-slate-200 dark:border-slate-800 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                All WhatsApp Chats
              </h2>
              <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                ({sessions.length})
              </span>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {onRefreshChats && (
                <button
                  type="button"
                  onClick={onRefreshChats}
                  title="Refresh synced WhatsApp chats"
                  className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowNewChat((v) => !v)}
                className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium flex items-center gap-1 whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                New
              </button>
            </div>
          </div>

          {showNewChat && (
            <form
              onSubmit={handleCreateChat}
              className="p-3 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-2"
            >
              <input
                type="text"
                required
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value)}
                placeholder="WhatsApp No. (e.g. 919472258022)"
                className="w-full px-2.5 py-1.5 text-xs font-mono rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Customer Name (optional)"
                className="w-full px-2.5 py-1.5 text-xs rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowNewChat(false)}
                  className="px-2.5 py-1 text-xs text-slate-500 hover:text-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-3 py-1 rounded bg-emerald-600 text-white text-xs font-medium"
                >
                  Open
                </button>
              </div>
            </form>
          )}

          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search name, phone, message..."
              className="w-full pl-8 pr-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 focus:outline-none focus:border-emerald-600"
            />
          </div>

          <div className="grid grid-cols-4 gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-900 text-[11px] font-medium">
            {(['all', 'ai', 'paused', 'unread'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setFilterTab(tab)}
                className={`py-1 rounded-md capitalize transition-colors whitespace-nowrap ${
                  filterTab === tab
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/80">
          {filteredSessions.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400">
              No matching conversations. Start a new chat or scan QR to receive live WhatsApp
              messages.
            </div>
          ) : (
            filteredSessions.map((session) => {
              const paused = isAiPaused(session, nowMs);
              const selected = session.phone === selectedPhone;
              return (
                <button
                  key={session.phone}
                  type="button"
                  onClick={() => onSelectPhone(session.phone)}
                  className={`w-full px-3.5 py-3 text-left transition-colors ${
                    selected
                      ? 'bg-emerald-50/80 dark:bg-emerald-950/30'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                      {session.name}
                    </span>
                    <span className="text-[11px] font-mono tabular-nums text-slate-400 shrink-0">
                      {formatClock(session.lastMessageAt)}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">
                    {session.lastMessage || 'Ready to message'}
                  </p>
                  <div className="mt-1.5 flex items-center justify-between text-[11px]">
                    <span className="text-slate-500 dark:text-slate-400 font-mono truncate">
                      +{session.phone} ·{' '}
                      <span
                        className={
                          paused
                            ? 'text-amber-700 dark:text-amber-400 font-sans font-medium'
                            : 'text-emerald-700 dark:text-emerald-400 font-sans font-medium'
                        }
                      >
                        {paused ? 'Human Handling (AI Paused)' : 'AI Active'}
                      </span>
                    </span>
                    {session.unreadCount > 0 && (
                      <span className="font-mono font-semibold text-emerald-700 dark:text-emerald-400 shrink-0 ml-2">
                        {session.unreadCount} new
                      </span>
                    )}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </aside>

      {/* Center Pane: Real-time Chat Thread */}
      <section
        className={`${
          activeSession ? 'flex' : 'hidden lg:flex'
        } lg:col-span-8 xl:col-span-6 flex-col min-h-0 bg-slate-50/50 dark:bg-[#0B1120]/60`}
      >
        {!activeSession ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
            <MessageSquare className="w-9 h-9 text-slate-300 dark:text-slate-700 mb-3" />
            <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
              Select a conversation to view & reply live
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-sm">
              All connected WhatsApp chats, photos, voice messages, and AI replies appear here in
              real time.
            </p>
          </div>
        ) : (
          <>
            {/* Chat Header with Human Handling Status & 1-Click AI Toggle */}
            <div className="px-4 sm:px-5 py-3.5 bg-white dark:bg-[#111827] border-b border-slate-200 dark:border-slate-800 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  {onClearSelection && (
                    <button
                      type="button"
                      onClick={onClearSelection}
                      aria-label="Back to all chats"
                      className="lg:hidden p-1.5 -ml-1 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      <ArrowLeft className="w-4 h-4" />
                    </button>
                  )}
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                        {activeSession.name}
                      </h3>
                      <span className="text-xs font-mono text-slate-500">+{activeSession.phone}</span>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      State: {activeSession.state} · Channel: {activeSession.channel.toUpperCase()}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setShowProductPicker((v) => !v)}
                    className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium flex items-center gap-1.5 whitespace-nowrap"
                  >
                    <ShoppingBag className="w-3.5 h-3.5" />
                    Send Product
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      onToggleChatAi(activeSession.phone, isAiPaused(activeSession, nowMs))
                    }
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 whitespace-nowrap transition-colors ${
                      isAiPaused(activeSession, nowMs)
                        ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                        : 'border border-amber-300 dark:border-amber-800 text-amber-800 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/40'
                    }`}
                  >
                    {isAiPaused(activeSession, nowMs) ? (
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

              {/* Human Handling / AI Status Banner */}
              {isAiPaused(activeSession, nowMs) ? (
                <div className="px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-950/35 border border-amber-200 dark:border-amber-900/70 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2 text-amber-900 dark:text-amber-200">
                    <Smartphone className="w-3.5 h-3.5 shrink-0" />
                    <span className="font-semibold">Human Handling (AI Paused)</span>
                    {getPauseReasonText(activeSession, nowMs) && (
                      <span className="text-amber-700 dark:text-amber-300">
                        · {getPauseReasonText(activeSession, nowMs)}
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => onToggleChatAi(activeSession.phone, true)}
                    className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:underline whitespace-nowrap"
                  >
                    Resume AI Now
                  </button>
                </div>
              ) : (
                <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                  <span className="text-emerald-700 dark:text-emerald-400 font-medium">
                    AI Auto-Reply Active for this chat
                  </span>
                  <span className="font-mono text-[11px]">
                    Global:{' '}
                    {aiGlobalMode === 'AUTO_ON'
                      ? 'Auto-Reply ON'
                      : aiGlobalMode === 'OUTSIDE_BUSINESS_HOURS'
                      ? 'Outside Business Hours'
                      : 'Manual Only'}
                  </span>
                </div>
              )}
            </div>

            {/* Inline Quick-Send Product Drawer */}
            {showProductPicker && (
              <div className="p-4 bg-white dark:bg-[#111827] border-b border-slate-200 dark:border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-slate-900 dark:text-white">
                    Send Live Product Card from bihargraminbazaar.com
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
                    placeholder="Filter products by name, Hindi title, SKU..."
                    className="px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                  />
                  <input
                    type="text"
                    value={productNote}
                    onChange={(e) => setProductNote(e.target.value)}
                    placeholder="Optional note above card..."
                    className="px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                  />
                </div>
                <div className="max-h-44 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-lg">
                  {filteredProducts.length === 0 ? (
                    <div className="p-4 text-xs text-slate-500 text-center">
                      No matching products. Sync store catalog first.
                    </div>
                  ) : (
                    filteredProducts.map((p) => (
                      <div
                        key={p.id}
                        className="px-3 py-2 flex items-center justify-between gap-3 hover:bg-slate-50 dark:hover:bg-slate-800/50"
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
                          className="px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-medium whitespace-nowrap"
                        >
                          Send Card
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* Message Feed */}
            <div className="flex-1 overflow-y-auto p-5 space-y-3.5">
              {loadingMessages ? (
                <div className="text-xs text-slate-500 text-center py-8">Loading thread...</div>
              ) : messages.length === 0 ? (
                <div className="text-xs text-slate-500 text-center py-8">
                  No messages in this conversation yet. Send a message or product card below.
                </div>
              ) : (
                messages.map((msg) => {
                  const outbound = msg.direction === 'OUTBOUND';
                  return (
                    <div
                      key={msg.id}
                      className={`flex ${outbound ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-[82%] rounded-xl px-4 py-2.5 text-sm border ${
                          outbound
                            ? msg.senderType === 'AI'
                              ? 'bg-emerald-600 text-white border-emerald-600'
                              : 'bg-slate-900 dark:bg-slate-800 text-white border-slate-900 dark:border-slate-700'
                            : 'bg-white dark:bg-[#111827] text-slate-900 dark:text-slate-100 border-slate-200 dark:border-slate-800'
                        }`}
                      >
                        <div
                          className={`flex items-center gap-1.5 text-[11px] mb-1 ${
                            outbound ? 'text-white/75' : 'text-slate-500 dark:text-slate-400'
                          }`}
                        >
                          {msg.senderType === 'AI' ? (
                            <Bot className="w-3 h-3" />
                          ) : msg.origin === 'phone' ? (
                            <Smartphone className="w-3 h-3" />
                          ) : (
                            <User className="w-3 h-3" />
                          )}
                          <span>
                            {msg.senderType === 'AI'
                              ? 'Gemini AI'
                              : msg.senderType === 'HUMAN'
                              ? msg.origin === 'phone'
                                ? 'Phone Reply (Human)'
                                : 'Dashboard Reply'
                              : msg.senderType === 'SYSTEM'
                              ? msg.origin === 'phone'
                                ? 'Phone Command'
                                : 'Order Alert'
                              : activeSession.name}
                          </span>
                          <span>·</span>
                          <span className="font-mono tabular-nums">{formatClock(msg.createdAt)}</span>
                          {outbound && msg.status === 'FAILED' && (
                            <>
                              <span>·</span>
                              <span className="text-amber-200">Channel offline (logged)</span>
                            </>
                          )}
                        </div>

                        {msg.productCard?.image && (
                          <div className="mb-2 rounded-lg overflow-hidden border border-white/15 bg-black/10">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={msg.productCard.image}
                              alt={msg.productCard.name}
                              className="w-full max-h-40 object-cover"
                              referrerPolicy="no-referrer"
                            />
                          </div>
                        )}

                        {msg.messageType === 'image' && (
                          <div className="mb-2 space-y-1.5">
                            {msg.mediaUrl ? (
                              <button
                                type="button"
                                onClick={() =>
                                  setLightboxImageUrl(resolveAuthenticatedMediaUrl(msg.mediaUrl))
                                }
                                className="block rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-900"
                              >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={resolveAuthenticatedMediaUrl(msg.mediaUrl)}
                                  alt="Customer photo"
                                  className="w-full max-w-[260px] max-h-56 object-cover"
                                  referrerPolicy="no-referrer"
                                />
                              </button>
                            ) : (
                              <div className="inline-flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                                <ImageIcon className="w-3.5 h-3.5" />
                                <span>Photo attachment</span>
                              </div>
                            )}
                          </div>
                        )}

                        {msg.messageType === 'audio' && (
                          <div className="mb-2 space-y-1.5">
                            <div
                              className={`inline-flex items-center gap-1.5 text-xs font-medium ${
                                outbound
                                  ? 'text-white/90'
                                  : 'text-emerald-700 dark:text-emerald-400'
                              }`}
                            >
                              <Mic className="w-3.5 h-3.5" />
                              <span>Voice Message</span>
                            </div>
                            {msg.mediaUrl && (
                              <audio
                                controls
                                preload="metadata"
                                src={resolveAuthenticatedMediaUrl(msg.mediaUrl)}
                                className="w-full min-w-[210px] max-w-[260px] h-9"
                              />
                            )}
                          </div>
                        )}

                        <p className="whitespace-pre-wrap leading-relaxed break-words">{msg.body}</p>

                        {msg.toolCalls && msg.toolCalls.length > 0 && (
                          <div className="mt-2 pt-1.5 border-t border-white/15 text-[11px] font-mono text-white/80">
                            Tools: {msg.toolCalls.map((t) => `${t.name} (${t.resultSummary})`).join(' · ')}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Reply Composer */}
            <form
              onSubmit={handleSend}
              className="p-3.5 bg-white dark:bg-[#111827] border-t border-slate-200 dark:border-slate-800 flex items-center gap-2.5"
            >
              <input
                type="text"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Type manual WhatsApp reply (auto-pauses AI handover)..."
                className="flex-1 px-3.5 py-2.5 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 focus:outline-none focus:border-emerald-600"
              />
              <button
                type="submit"
                disabled={!draft.trim() || sending}
                className="px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-medium flex items-center gap-1.5 whitespace-nowrap transition-colors"
              >
                <Send className="w-3.5 h-3.5" />
                Send
              </button>
            </form>
          </>
        )}
      </section>

      {/* Right Pane: Customer Context & Matched Live Orders */}
      <aside className="hidden xl:flex xl:col-span-3 border-l border-slate-200 dark:border-slate-800 flex-col min-h-0 bg-white dark:bg-[#111827]">
        <div className="px-4 py-3.5 border-b border-slate-200 dark:border-slate-800">
          <h3 className="text-xs font-semibold text-slate-900 dark:text-white">
            Customer & Order Context
          </h3>
        </div>

        {!activeSession ? (
          <div className="p-5 text-xs text-slate-500 dark:text-slate-400">
            Select a chat to inspect customer session memory and live Bihar Gramin Bazaar orders.
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-4 space-y-5 text-xs">
            <div className="space-y-2">
              <p className="font-medium text-slate-500 dark:text-slate-400">Session Memory</p>
              <div className="space-y-1.5 text-slate-700 dark:text-slate-300">
                <div className="flex justify-between">
                  <span className="text-slate-500">State</span>
                  <span className="font-mono font-medium">{activeSession.state}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Last Product</span>
                  <span className="truncate max-w-[150px] text-right">
                    {activeSession.context.lastProductName || 'None'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Last Order ID</span>
                  <span className="font-mono">{activeSession.context.lastOrderId || 'None'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">District</span>
                  <span>{activeSession.context.district || 'Unknown'}</span>
                </div>
              </div>
            </div>

            <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-2">
              <p className="font-medium text-slate-500 dark:text-slate-400">
                Global AI Mode
              </p>
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
                <span className="font-mono">#ai</span> / <span className="font-mono">#start</span>{' '}
                to resume immediately.
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
                  No orders found for +{activeSession.phone} in orders.php.
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
                        <span className="font-mono font-semibold tabular-nums">
                          ₹{ord.totalAmount}
                        </span>
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
        )}
      </aside>

      {/* Inline Photo Lightbox Modal */}
      {lightboxImageUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
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
              className="absolute top-3 right-3 p-1.5 rounded-lg bg-black/60 text-white hover:bg-black/80"
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
