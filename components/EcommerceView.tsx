'use client';

import React, { useMemo, useState } from 'react';
import {
  Package,
  RefreshCw,
  Search,
  Send,
  ShoppingBag,
  Truck,
  X,
} from 'lucide-react';
import type { ChatSession, DeliveryStage, StoreOrder, StoreProduct } from '@/lib/types';

interface EcommerceViewProps {
  products: StoreProduct[];
  orders: StoreOrder[];
  sessions: ChatSession[];
  lastSyncAt: string | null;
  syncing: boolean;
  onSyncStore: () => void;
  onSendProductCard: (phone: string, productId: string, note?: string) => Promise<void>;
  onNotifyOrder: (orderId: string) => Promise<void>;
}

const DELIVERY_STAGES: Array<'ALL' | DeliveryStage> = [
  'ALL',
  'UNASSIGNED',
  'DISPATCHED',
  'RECEIVED_BY_AGENT',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'FAILED_RETURN',
];

export default function EcommerceView({
  products,
  orders,
  sessions,
  lastSyncAt,
  syncing,
  onSyncStore,
  onSendProductCard,
  onNotifyOrder,
}: EcommerceViewProps) {
  const [subTab, setSubTab] = useState<'products' | 'orders'>('products');
  const [search, setSearch] = useState('');
  const [stageFilter, setStageFilter] = useState<'ALL' | DeliveryStage>('ALL');
  const [failedImgs, setFailedImgs] = useState<Record<string, boolean>>({});

  // Send Product Card Modal State
  const [productToSend, setProductToSend] = useState<StoreProduct | null>(null);
  const [targetPhone, setTargetPhone] = useState('');
  const [customNote, setCustomNote] = useState('');
  const [sendingCard, setSendingCard] = useState(false);

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.hindiName.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q)
      );
    });
  }, [products, search]);

  const filteredOrders = useMemo(() => {
    const q = search.trim().toLowerCase();
    return orders.filter((o) => {
      if (stageFilter !== 'ALL' && o.deliveryStage !== stageFilter) return false;
      if (!q) return true;
      return (
        o.id.toLowerCase().includes(q) ||
        o.customerName.toLowerCase().includes(q) ||
        o.phone.includes(q) ||
        o.district.toLowerCase().includes(q) ||
        (o.assignedAgentName || '').toLowerCase().includes(q)
      );
    });
  }, [orders, search, stageFilter]);

  async function handleConfirmSendCard(e: React.FormEvent) {
    e.preventDefault();
    if (!productToSend || !targetPhone.trim()) return;
    setSendingCard(true);
    try {
      await onSendProductCard(targetPhone.trim(), productToSend.id, customNote);
      setProductToSend(null);
      setCustomNote('');
    } finally {
      setSendingCard(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-900">
          <button
            type="button"
            onClick={() => {
              setSubTab('products');
              setSearch('');
            }}
            className={`px-3.5 py-1.5 rounded-md text-xs font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap ${
              subTab === 'products'
                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <ShoppingBag className="w-3.5 h-3.5" />
            Product Catalog ({products.length})
          </button>
          <button
            type="button"
            onClick={() => {
              setSubTab('orders');
              setSearch('');
            }}
            className={`px-3.5 py-1.5 rounded-md text-xs font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap ${
              subTab === 'orders'
                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Truck className="w-3.5 h-3.5" />
            Orders & Delivery ({orders.length})
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-3 flex-1 justify-end">
          <div className="relative w-full sm:w-64">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={
                subTab === 'products'
                  ? 'Search products, SKU, category...'
                  : 'Search Order ID, customer, district...'
              }
              className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 focus:outline-none focus:border-emerald-600"
            />
          </div>

          <span className="text-xs font-mono text-slate-500 hidden md:inline whitespace-nowrap">
            {lastSyncAt ? `Synced ${new Date(lastSyncAt).toLocaleTimeString('en-IN')}` : 'Not synced'}
          </span>

          <button
            type="button"
            disabled={syncing}
            onClick={onSyncStore}
            className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-xs font-medium flex items-center gap-1.5 whitespace-nowrap transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'Syncing...' : 'Live Sync Now'}
          </button>
        </div>
      </div>

      {/* Product Catalog Grid */}
      {subTab === 'products' ? (
        filteredProducts.length === 0 ? (
          <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-12 text-center">
            <ShoppingBag className="w-8 h-8 text-slate-300 dark:text-slate-700 mx-auto mb-3" />
            <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
              No products matched your search
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Click Live Sync Now to fetch live items from bihargraminbazaar.com/api/products.php.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filteredProducts.map((p) => (
              <article
                key={p.id}
                className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden flex flex-col"
              >
                <div className="aspect-[4/3] bg-slate-100 dark:bg-slate-900 relative overflow-hidden">
                  {p.image && !failedImgs[p.id] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={p.image}
                      alt={p.name}
                      referrerPolicy="no-referrer"
                      onError={() => setFailedImgs((prev) => ({ ...prev, [p.id]: true }))}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center p-4 text-center text-slate-400">
                      <Package className="w-7 h-7 mb-1.5" />
                      <span className="text-xs line-clamp-2">{p.name}</span>
                    </div>
                  )}
                </div>

                <div className="p-4 flex-1 flex flex-col">
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                    {p.category} · {p.sku || p.id}
                  </p>
                  <h3 className="mt-1 text-sm font-semibold text-slate-900 dark:text-white line-clamp-2">
                    {p.name}
                  </h3>
                  {p.hindiName && p.hindiName !== p.name && (
                    <p className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">
                      {p.hindiName}
                    </p>
                  )}

                  <div className="mt-3 flex items-baseline gap-2 font-mono tabular-nums">
                    <span className="text-base font-semibold text-slate-900 dark:text-white">
                      ₹{p.price.toLocaleString('en-IN')}
                    </span>
                    {p.originalPrice > p.price && (
                      <span className="text-xs line-through text-slate-400">
                        ₹{p.originalPrice.toLocaleString('en-IN')}
                      </span>
                    )}
                    {p.discountPercent > 0 && (
                      <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
                        {p.discountPercent}% off
                      </span>
                    )}
                  </div>

                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                    {p.inStock ? `In stock (${p.stockCount})` : 'Out of stock'} · {p.deliveryDays}d
                    delivery
                  </p>

                  <button
                    type="button"
                    onClick={() => {
                      setProductToSend(p);
                      setTargetPhone(sessions[0]?.phone || '');
                    }}
                    className="mt-4 w-full py-2 px-3 rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-emerald-600 hover:border-emerald-600 hover:text-white text-xs font-medium flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <Send className="w-3.5 h-3.5" />
                    Send Product Card to Chat
                  </button>
                </div>
              </article>
            ))}
          </div>
        )
      ) : (
        /* Orders & Delivery Tracking Table */
        <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center gap-1.5 overflow-x-auto">
            {DELIVERY_STAGES.map((stage) => (
              <button
                key={stage}
                type="button"
                onClick={() => setStageFilter(stage)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
                  stageFilter === stage
                    ? 'bg-slate-900 dark:bg-emerald-600 text-white'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                {stage.replace(/_/g, ' ')}
              </button>
            ))}
          </div>

          {filteredOrders.length === 0 ? (
            <div className="p-10 text-center text-xs text-slate-500 dark:text-slate-400">
              No orders match this filter. Click Live Sync Now to refresh orders from
              bihargraminbazaar.com/api/orders.php.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 text-slate-500 dark:text-slate-400">
                    <th className="py-3 px-4 font-medium">Order ID</th>
                    <th className="py-3 px-4 font-medium">Customer & Location</th>
                    <th className="py-3 px-4 font-medium text-right">Amount</th>
                    <th className="py-3 px-4 font-medium">Payment</th>
                    <th className="py-3 px-4 font-medium">Delivery Stage</th>
                    <th className="py-3 px-4 font-medium">Assigned Agent</th>
                    <th className="py-3 px-4 font-medium text-right">WhatsApp Alert</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                  {filteredOrders.map((ord) => (
                    <tr
                      key={ord.id}
                      className="hover:bg-slate-50/80 dark:hover:bg-slate-800/30 transition-colors"
                    >
                      <td className="py-3 px-4 font-mono font-semibold text-slate-900 dark:text-white whitespace-nowrap">
                        <div>{ord.id}</div>
                        <div className="text-[11px] font-normal text-slate-400 tabular-nums">
                          {ord.orderDate.slice(0, 10)}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-medium text-slate-900 dark:text-slate-100">
                          {ord.customerName}
                        </div>
                        <div className="text-[11px] text-slate-500 font-mono">
                          {ord.phone} · {ord.district}
                          {ord.pincode ? ` - ${ord.pincode}` : ''}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-semibold tabular-nums text-slate-900 dark:text-white whitespace-nowrap">
                        ₹{ord.totalAmount.toLocaleString('en-IN')}
                      </td>
                      <td className="py-3 px-4 font-mono whitespace-nowrap">
                        <div className="text-slate-800 dark:text-slate-200">{ord.paymentMethod}</div>
                        <div className="text-[11px] text-slate-500">
                          {ord.collectedMethod
                            ? `Collected: ${ord.collectedMethod}`
                            : 'Pending collection'}
                        </div>
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span
                          className={`font-medium ${
                            ord.deliveryStage === 'DELIVERED'
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : ord.deliveryStage === 'FAILED_RETURN'
                              ? 'text-red-600 dark:text-red-400'
                              : ord.deliveryStage === 'OUT_FOR_DELIVERY' ||
                                ord.deliveryStage === 'DISPATCHED'
                              ? 'text-amber-700 dark:text-amber-400'
                              : 'text-slate-600 dark:text-slate-400'
                          }`}
                        >
                          {ord.deliveryStage}
                        </span>
                        <div className="text-[11px] text-slate-400">{ord.status}</div>
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        {ord.assignedAgentName ? (
                          <div>
                            <div className="text-slate-800 dark:text-slate-200">
                              {ord.assignedAgentName}
                            </div>
                            <div className="text-[11px] font-mono text-slate-500">
                              {ord.assignedAgentPhone || ord.assignedAgentCode || ''}
                            </div>
                          </div>
                        ) : (
                          <span className="text-slate-400">Unassigned</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => onNotifyOrder(ord.id)}
                          className="px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-emerald-600 hover:border-emerald-600 hover:text-white text-[11px] font-medium transition-colors"
                        >
                          Send Update
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Modal: Send Product Card to Customer Chat */}
      {productToSend && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                  Send Product Card on WhatsApp
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {productToSend.name} · ₹{productToSend.price}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setProductToSend(null)}
                className="p-1 text-slate-400 hover:text-slate-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleConfirmSendCard} className="space-y-3.5">
              {sessions.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Pick Recent Chat Contact
                  </label>
                  <select
                    value={targetPhone}
                    onChange={(e) => setTargetPhone(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                  >
                    <option value="">-- Or type a phone number below --</option>
                    {sessions.map((s) => (
                      <option key={s.phone} value={s.phone}>
                        {s.name} (+{s.phone})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Customer WhatsApp Number
                </label>
                <input
                  type="text"
                  required
                  value={targetPhone}
                  onChange={(e) => setTargetPhone(e.target.value)}
                  placeholder="919472258022"
                  className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Custom Hindi/English Note (optional)
                </label>
                <input
                  type="text"
                  value={customNote}
                  onChange={(e) => setCustomNote(e.target.value)}
                  placeholder="प्रणाम जी! यह उत्पाद अभी स्टॉक में उपलब्ध है:"
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setProductToSend(null)}
                  className="px-3.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={sendingCard}
                  className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium flex items-center gap-1.5"
                >
                  <Send className="w-3.5 h-3.5" />
                  {sendingCard ? 'Sending...' : 'Send Product Card'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
