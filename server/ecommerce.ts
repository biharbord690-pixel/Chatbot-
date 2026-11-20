import type { DeliveryStage, StoreOrder, StoreProduct } from '../lib/types';
import { storage } from './storage';

const BIHAR_DISTRICTS = [
  'Araria', 'Arwal', 'Aurangabad', 'Banka', 'Begusarai', 'Bhagalpur', 'Bhojpur',
  'Buxar', 'Darbhanga', 'East Champaran', 'Gaya', 'Gopalganj', 'Jamui', 'Jehanabad',
  'Kaimur', 'Katihar', 'Khagaria', 'Kishanganj', 'Lakhisarai', 'Madhepura', 'Madhubani',
  'Munger', 'Muzaffarpur', 'Nalanda', 'Nawada', 'Patna', 'Purnia', 'Rohtas', 'Saharsa',
  'Samastipur', 'Saran', 'Sheikhpura', 'Sheohar', 'Sitamarhi', 'Siwan', 'Supaul',
  'Vaishali', 'West Champaran',
];

function resolveStoreImageUrl(rawUrl: string | undefined, websiteUrl: string): string {
  if (!rawUrl) return '';
  if (rawUrl.startsWith('http://') || rawUrl.startsWith('https://')) {
    return rawUrl;
  }
  const base = websiteUrl.replace(/\/$/, '');
  return `${base}${rawUrl.startsWith('/') ? rawUrl : `/${rawUrl}`}`;
}

function normalizeProduct(raw: Record<string, unknown>, websiteUrl: string): StoreProduct {
  const imagesRaw = Array.isArray(raw.images) ? raw.images : [];
  const mainImage = resolveStoreImageUrl(String(raw.image || imagesRaw[0] || ''), websiteUrl);
  const price = Number(raw.price || 0);
  const originalPrice = Number(raw.originalPrice || price);
  const discountPercent =
    Number(raw.discountPercent) ||
    (originalPrice > price ? Math.round(((originalPrice - price) / originalPrice) * 100) : 0);

  return {
    id: String(raw.id || ''),
    sku: String(raw.sku || ''),
    name: String(raw.name || 'Unnamed Product'),
    hindiName: String(raw.hindiName || raw.name || 'Unnamed Product'),
    price,
    originalPrice,
    discountPercent,
    category: String(raw.category || 'General'),
    subcategory: raw.subcategory ? String(raw.subcategory) : undefined,
    brand: raw.brand ? String(raw.brand) : 'Bihar Gramin Bazaar',
    description: String(raw.description || ''),
    image: mainImage,
    images: imagesRaw.map((img) => resolveStoreImageUrl(String(img), websiteUrl)).filter(Boolean),
    stockCount: Number(raw.stockCount ?? 0),
    inStock: raw.inStock !== false && Number(raw.stockCount ?? 1) > 0,
    deliveryDays: Number(raw.deliveryDays || 3),
    slug: raw.slug ? String(raw.slug) : undefined,
    badge: raw.badge ? String(raw.badge) : undefined,
    highlights: Array.isArray(raw.highlights) ? raw.highlights.map(String) : undefined,
    colorVariants: Array.isArray(raw.colorVariants)
      ? (raw.colorVariants as StoreProduct['colorVariants'])
      : undefined,
    sizeVariants: Array.isArray(raw.sizeVariants)
      ? (raw.sizeVariants as StoreProduct['sizeVariants'])
      : undefined,
    createdAt:
      typeof raw.createdAt === 'string'
        ? raw.createdAt
        : typeof raw.created_at === 'string'
        ? raw.created_at
        : undefined,
    updatedAt:
      typeof raw.updatedAt === 'string'
        ? raw.updatedAt
        : typeof raw.updated_at === 'string'
        ? raw.updated_at
        : undefined,
  };
}

function normalizeOrder(raw: Record<string, unknown>): StoreOrder {
  const stageRaw = String(raw.deliveryStage || 'UNASSIGNED').toUpperCase();
  const validStages: DeliveryStage[] = [
    'UNASSIGNED',
    'DISPATCHED',
    'RECEIVED_BY_AGENT',
    'OUT_FOR_DELIVERY',
    'DELIVERED',
    'FAILED_RETURN',
  ];
  const deliveryStage = validStages.includes(stageRaw as DeliveryStage)
    ? (stageRaw as DeliveryStage)
    : 'UNASSIGNED';

  const collectedRaw = raw.collectedMethod ? String(raw.collectedMethod).toUpperCase() : null;
  const collectedMethod =
    collectedRaw === 'CASH' || collectedRaw === 'UPI' || collectedRaw === 'PREPAID'
      ? collectedRaw
      : null;

  return {
    id: String(raw.id || ''),
    customerName: String(raw.customerName || 'Customer'),
    phone: String(raw.phone || ''),
    district: String(raw.district || 'Bihar'),
    pincode: String(raw.pincode || ''),
    villageOrTown: String(raw.villageOrTown || ''),
    address:
      typeof raw.address === 'object' && raw.address !== null
        ? (raw.address as Record<string, unknown>)
        : String(raw.address || ''),
    totalAmount: Number(raw.totalAmount || 0),
    paymentMethod: String(raw.paymentMethod || 'COD'),
    status: String(raw.status || 'PENDING'),
    items: Array.isArray(raw.items) ? (raw.items as StoreOrder['items']) : [],
    orderDate: String(raw.orderDate || new Date().toISOString()),
    trackingNumber: raw.trackingNumber ? String(raw.trackingNumber) : undefined,
    assignedAgentId: raw.assignedAgentId ? String(raw.assignedAgentId) : undefined,
    assignedAgentCode: raw.assignedAgentCode ? String(raw.assignedAgentCode) : undefined,
    assignedAgentName: raw.assignedAgentName ? String(raw.assignedAgentName) : undefined,
    assignedAgentPhone: raw.assignedAgentPhone ? String(raw.assignedAgentPhone) : undefined,
    deliveryStage,
    dispatchedAt: raw.dispatchedAt ? String(raw.dispatchedAt) : undefined,
    receivedAt: raw.receivedAt ? String(raw.receivedAt) : undefined,
    deliveredAt: raw.deliveredAt ? String(raw.deliveredAt) : undefined,
    collectedMethod,
    collectedAmount:
      raw.collectedAmount !== undefined && raw.collectedAmount !== null
        ? Number(raw.collectedAmount)
        : null,
    upiRefNote: raw.upiRefNote ? String(raw.upiRefNote) : undefined,
    cashSettled: Boolean(raw.cashSettled),
    settledAt: raw.settledAt ? String(raw.settledAt) : undefined,
    deliveryProofNote: raw.deliveryProofNote ? String(raw.deliveryProofNote) : undefined,
  };
}

export function getStoreUrls() {
  const storeSettings = storage.getStore().settings.store;
  const apiBase = storeSettings.apiBaseUrl.replace(/\/$/, '');
  const websiteUrl = storeSettings.websiteUrl.replace(/\/$/, '');
  return {
    websiteUrl,
    productsUrl: `${apiBase}/products.php`,
    ordersUrl: `${apiBase}/orders.php`,
    deliveryUrl: `${apiBase}/delivery.php`,
  };
}

const PRODUCTS_FRESH_TTL_MS = 20_000; // Auto-refresh catalog every 20s when queried
let lastProductsFetchAt = 0;
let inFlightProductsFetch: Promise<{
  products: StoreProduct[];
  source: 'live' | 'cache';
  addedNames?: string[];
  updatedCount?: number;
  error?: string;
}> | null = null;

export async function fetchLiveProducts(force = false): Promise<{
  products: StoreProduct[];
  source: 'live' | 'cache';
  addedNames?: string[];
  updatedCount?: number;
  error?: string;
}> {
  if (!force && inFlightProductsFetch) {
    return inFlightProductsFetch;
  }

  const runFetch = async () => {
    const { productsUrl, websiteUrl } = getStoreUrls();
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      // Cache-busting timestamp + no-cache headers guarantee newly uploaded products appear immediately
      const bustUrl = `${productsUrl}${productsUrl.includes('?') ? '&' : '?'}_ts=${Date.now()}`;
      const res = await fetch(bustUrl, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          Pragma: 'no-cache',
          'User-Agent': 'BGB-WhatsApp-CRM/1.0',
        },
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!res.ok) {
        throw new Error(`Products API returned HTTP ${res.status}`);
      }
      const json = (await res.json()) as { products?: Record<string, unknown>[] };
      const rawList = Array.isArray(json.products) ? json.products : [];
      const products = rawList.map((item) => normalizeProduct(item, websiteUrl));

      const store = storage.getStore();
      const prevMap = new Map(store.productsCache.map((p) => [p.id, p]));
      const addedNames: string[] = [];
      let updatedCount = 0;

      if (prevMap.size > 0) {
        for (const p of products) {
          const prev = prevMap.get(p.id);
          if (!prev) {
            addedNames.push(p.name);
          } else if (
            prev.price !== p.price ||
            prev.stockCount !== p.stockCount ||
            prev.inStock !== p.inStock ||
            prev.name !== p.name
          ) {
            updatedCount += 1;
          }
        }
      }

      store.productsCache = products;
      store.lastSyncAt = new Date().toISOString();
      lastProductsFetchAt = Date.now();
      storage.persist();

      if (addedNames.length > 0 || updatedCount > 0) {
        const parts: string[] = [];
        if (addedNames.length > 0) {
          parts.push(`+${addedNames.length} new (${addedNames.slice(0, 3).join(', ')})`);
        }
        if (updatedCount > 0) {
          parts.push(`${updatedCount} updated`);
        }
        storage.addChannelLog(
          'system',
          'success',
          `Live catalog synced from website: ${parts.join(', ')} · Total ${products.length} products.`
        );
      }

      return { products, source: 'live' as const, addedNames, updatedCount };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to reach products.php';
      return {
        products: storage.getStore().productsCache,
        source: 'cache' as const,
        error: msg,
      };
    }
  };

  const promise = runFetch();
  inFlightProductsFetch = promise;
  try {
    return await promise;
  } finally {
    if (inFlightProductsFetch === promise) {
      inFlightProductsFetch = null;
    }
  }
}

export async function fetchLiveOrders(): Promise<{
  orders: StoreOrder[];
  source: 'live' | 'cache';
  error?: string;
}> {
  const { ordersUrl } = getStoreUrls();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const bustUrl = `${ordersUrl}${ordersUrl.includes('?') ? '&' : '?'}_ts=${Date.now()}`;
    const res = await fetch(bustUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        Pragma: 'no-cache',
        'User-Agent': 'BGB-WhatsApp-CRM/1.0',
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      throw new Error(`Orders API returned HTTP ${res.status}`);
    }
    const json = (await res.json()) as { orders?: Record<string, unknown>[] };
    const rawList = Array.isArray(json.orders) ? json.orders : [];
    const orders = rawList.map(normalizeOrder);

    const store = storage.getStore();
    store.ordersCache = orders;
    store.lastSyncAt = new Date().toISOString();
    storage.persist();

    return { orders, source: 'live' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to reach orders.php';
    return {
      orders: storage.getStore().ordersCache,
      source: 'cache',
      error: msg,
    };
  }
}

function getProductRecencyScore(p: StoreProduct, idx: number, total: number): number {
  const ts = Date.parse(p.createdAt || p.updatedAt || '');
  if (Number.isFinite(ts) && ts > 0) return ts;
  // Extract trailing numeric timestamp/ID if product ID contains numbers (e.g. prod-17321..., or auto-inc ID)
  const numMatch = p.id.match(/(\d{4,})/);
  if (numMatch) {
    const parsedNum = Number(numMatch[1]);
    if (Number.isFinite(parsedNum)) return parsedNum;
  }
  // Fallback: assume newer uploads appear near start or end consistently; preserve catalog position
  return total - idx;
}

export async function searchLiveProducts(params: {
  query?: string;
  category?: string;
  maxPrice?: number;
  limit?: number;
  sortBy?: 'relevance' | 'newest';
}): Promise<StoreProduct[]> {
  let products = storage.getStore().productsCache;
  let fetchedFreshThisCall = false;

  // Always refresh live from bihargraminbazaar.com if cache is empty, >20s old, or asking for newest uploads
  const cacheAgeMs = Date.now() - lastProductsFetchAt;
  if (products.length === 0 || cacheAgeMs > PRODUCTS_FRESH_TTL_MS || params.sortBy === 'newest') {
    const fetched = await fetchLiveProducts();
    products = fetched.products;
    fetchedFreshThisCall = fetched.source === 'live';
  }

  const scoreProducts = (list: StoreProduct[]): StoreProduct[] => {
    const q = (params.query || '').trim().toLowerCase();
    const cat = (params.category || '').trim().toLowerCase();
    const maxPrice = params.maxPrice && params.maxPrice > 0 ? params.maxPrice : undefined;
    const tokens = q.split(/\s+/).filter((t) => t.length > 1);
    const limit = params.limit || 6;

    const filtered = list.filter((p) => {
      if (maxPrice && p.price > maxPrice) return false;
      if (
        cat &&
        !p.category.toLowerCase().includes(cat) &&
        !(p.subcategory || '').toLowerCase().includes(cat)
      ) {
        return false;
      }
      return true;
    });

    if (params.sortBy === 'newest' && !q) {
      return [...filtered]
        .map((p, idx) => ({ p, recency: getProductRecencyScore(p, idx, filtered.length) }))
        .sort((a, b) => b.recency - a.recency)
        .slice(0, limit)
        .map((entry) => entry.p);
    }

    const scored = filtered
      .map((p, idx) => {
        if (!q) {
          return {
            product: p,
            score: p.inStock ? 2 : 1,
            recency: getProductRecencyScore(p, idx, filtered.length),
          };
        }
        const haystack = [
          p.name,
          p.hindiName,
          p.category,
          p.subcategory || '',
          p.brand || '',
          p.description,
          p.sku,
          ...(p.colorVariants?.map((c) => `${c.name} ${c.hindiName || ''}`) || []),
        ]
          .join(' ')
          .toLowerCase();

        let score = 0;
        if (haystack.includes(q)) score += 10;
        for (const tok of tokens) {
          if (haystack.includes(tok)) score += 3;
        }
        if (score > 0 && p.inStock) score += 1;
        return {
          product: p,
          score,
          recency: getProductRecencyScore(p, idx, filtered.length),
        };
      })
      .filter((entry) => entry.score > 0)
      .sort((a, b) => {
        if (params.sortBy === 'newest' && b.recency !== a.recency) {
          return b.recency - a.recency;
        }
        return b.score - a.score;
      });

    return scored.slice(0, limit).map((s) => s.product);
  };

  let hits = scoreProducts(products);

  // Instant zero-match re-fetch: if a brand-new product was uploaded 1 second ago and isn't in cache yet,
  // force-fetch products.php right now and re-search immediately!
  if (hits.length === 0 && (params.query || params.category) && !fetchedFreshThisCall) {
    const fresh = await fetchLiveProducts(true);
    if (fresh.products.length > 0) {
      hits = scoreProducts(fresh.products);
    }
  }

  return hits;
}

export interface PlaceOrderInput {
  productId?: string;
  productName?: string;
  quantity: number;
  selectedColor?: string;
  selectedSize?: string;
  customerName: string;
  phone: string;
  streetOrVillage: string;
  district: string;
  pincode: string;
  paymentMethod?: 'COD' | 'UPI';
  couponCode?: string;
  allowRepeatOrder?: boolean;
}

export interface PlaceOrderResult {
  success: boolean;
  orderId?: string;
  subtotal?: number;
  deliveryCharge?: number;
  couponDiscount?: number;
  totalAmount?: number;
  alreadyPlaced?: boolean;
  message: string;
}

const ORDER_DEDUP_WINDOW_MS = 30 * 60 * 1000; // 30 minutes strict duplicate protection
const inFlightOrders = new Map<string, Promise<PlaceOrderResult>>();
const recentPlacedOrders = new Map<string, { result: PlaceOrderResult; createdAt: number }>();
let lastOrdersFetchAt = 0;

function pruneRecentOrders(): void {
  const cutoff = Date.now() - ORDER_DEDUP_WINDOW_MS;
  for (const [key, entry] of recentPlacedOrders.entries()) {
    if (entry.createdAt < cutoff) {
      recentPlacedOrders.delete(key);
    }
  }
}

export async function placeLiveOrder(input: PlaceOrderInput): Promise<PlaceOrderResult> {
  const { ordersUrl } = getStoreUrls();
  let products = storage.getStore().productsCache;
  if (products.length === 0 || Date.now() - lastProductsFetchAt > PRODUCTS_FRESH_TTL_MS) {
    const res = await fetchLiveProducts();
    products = res.products;
  }

  let matchedProduct = input.productId
    ? products.find((p) => p.id === input.productId || p.sku === input.productId)
    : undefined;

  if (!matchedProduct && input.productName) {
    const searchHits = await searchLiveProducts({ query: input.productName, limit: 1 });
    matchedProduct = searchHits[0];
  }

  if (!matchedProduct) {
    return {
      success: false,
      message: 'उत्पाद कैटलॉग में नहीं मिला। कृपया पहले सही उत्पाद चुनें।',
    };
  }

  const cleanPhone = input.phone.replace(/[^0-9]/g, '').slice(-10);
  if (cleanPhone.length !== 10) {
    return {
      success: false,
      message: 'कृपया सही 10 अंकों का मोबाइल नंबर दें।',
    };
  }

  const cleanPin = input.pincode.replace(/[^0-9]/g, '');
  if (cleanPin.length !== 6) {
    return {
      success: false,
      message: 'कृपया सही 6 अंकों का पिनकोड दें।',
    };
  }

  const qty = Math.max(1, Math.min(20, Math.round(Number(input.quantity) || 1)));
  const paymentMethod: 'COD' | 'UPI' = input.paymentMethod === 'UPI' ? 'UPI' : 'COD';

  // Deterministic idempotency keys: block duplicate orders for the SAME phone + product
  // even if coupon/quantity/whitespace slightly varied in follow-up chat turns!
  const phoneLockKey = `phone:${cleanPhone}`;
  const phoneProductKey = `${cleanPhone}|${matchedProduct.id}`;

  pruneRecentOrders();

  // 1. If an order for this customer/product is currently in-flight, await that exact promise (ZERO parallel POSTs!)
  const existingInFlight = inFlightOrders.get(phoneProductKey) || inFlightOrders.get(phoneLockKey);
  if (existingInFlight) {
    const sharedRes = await existingInFlight;
    return {
      ...sharedRes,
      alreadyPlaced: sharedRes.success ? true : sharedRes.alreadyPlaced,
    };
  }

  // 2. Unless customer explicitly asked for an additional/second order, check 30-min in-memory + persisted + live-website guards!
  if (!input.allowRepeatOrder) {
    const recentHit = recentPlacedOrders.get(phoneProductKey);
    if (recentHit && Date.now() - recentHit.createdAt < ORDER_DEDUP_WINDOW_MS) {
      return {
        ...recentHit.result,
        alreadyPlaced: true,
        message: `DUPLICATE BLOCKED: ऑर्डर पहले से ही कन्फर्म हो चुका है (Order ID: ${recentHit.result.orderId || 'Confirmed'})। नया डुप्लीकेट ऑर्डर नहीं बनाया गया — ग्राहक को यही Order ID बताएं।`,
      };
    }

    const persistedGuard = storage.findRecentOrderGuard(
      cleanPhone,
      matchedProduct.id,
      ORDER_DEDUP_WINDOW_MS
    );
    if (persistedGuard) {
      return {
        success: true,
        alreadyPlaced: true,
        orderId: persistedGuard.orderId,
        totalAmount: persistedGuard.totalAmount,
        message: `DUPLICATE BLOCKED: ऑर्डर पहले से ही कन्फर्म हो चुका है (Order ID: ${persistedGuard.orderId})। नया डुप्लीकेट ऑर्डर नहीं बनाया गया — ग्राहक को यही Order ID बताएं।`,
      };
    }

    // Also check cached live website orders placed in the last 30 mins for this same phone + product
    const recentLiveOrder = storage.getStore().ordersCache.find((o) => {
      const oPhone = o.phone.replace(/[^0-9]/g, '').slice(-10);
      if (oPhone !== cleanPhone) return false;
      if (String(o.status || '').toUpperCase() === 'CANCELLED') return false;
      const oTime = Date.parse(o.orderDate || '');
      if (Number.isFinite(oTime) && Date.now() - oTime > ORDER_DEDUP_WINDOW_MS) return false;
      return o.items.some(
        (it) =>
          it.productId === matchedProduct!.id ||
          it.product?.id === matchedProduct!.id ||
          (it.product?.name || '').toLowerCase() === matchedProduct!.name.toLowerCase()
      );
    });
    if (recentLiveOrder) {
      return {
        success: true,
        alreadyPlaced: true,
        orderId: recentLiveOrder.id,
        totalAmount: recentLiveOrder.totalAmount,
        message: `DUPLICATE BLOCKED: वेबसाइट पर यह ऑर्डर पहले से दर्ज है (Order ID: ${recentLiveOrder.id})। नया डुप्लीकेट ऑर्डर नहीं बनाया गया।`,
      };
    }
  }

  const payload = {
    customerName: input.customerName.trim(),
    phone: cleanPhone,
    district: input.district.trim(),
    pincode: cleanPin,
    villageOrTown: input.streetOrVillage.trim(),
    address: `${input.streetOrVillage.trim()}, ${input.district.trim()}, Bihar - ${cleanPin}`,
    paymentMethod,
    couponCode: input.couponCode ? input.couponCode.trim().toUpperCase() : '',
    items: [
      {
        product: matchedProduct,
        productId: matchedProduct.id,
        quantity: qty,
        selectedColor: input.selectedColor || '',
        selectedSize: input.selectedSize || '',
        selectedSku: matchedProduct.sku,
        selectedImage: matchedProduct.image,
        unitPrice: matchedProduct.price,
        originalUnitPrice: matchedProduct.originalPrice,
      },
    ],
  };

  const executeOrderPost = async (): Promise<PlaceOrderResult> => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 14000);
      const res = await fetch(ordersUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'User-Agent': 'BGB-WhatsApp-CRM/1.0',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const data = (await res.json()) as {
        success?: boolean;
        orderId?: string;
        subtotal?: number;
        deliveryCharge?: number;
        couponDiscount?: number;
        totalAmount?: number;
        message?: string;
      };

      if (!res.ok || !data.success) {
        return {
          success: false,
          message: data.message || `ऑर्डर दर्ज करने में त्रुटि (HTTP ${res.status})`,
        };
      }

      if (data.orderId) {
        storage.recordWhatsappOrder(data.orderId);
        storage.recordRecentOrderGuard({
          phone: cleanPhone,
          productId: matchedProduct!.id,
          productName: matchedProduct!.name,
          orderId: data.orderId,
          totalAmount: data.totalAmount,
        });
        // Pre-register order stage snapshot so background sync never sends a duplicate confirmation alert
        const store = storage.getStore();
        if (!store.orderStageSnapshots[data.orderId]) {
          store.orderStageSnapshots[data.orderId] = {
            deliveryStage: 'UNASSIGNED',
            status: 'PENDING',
          };
          storage.persist();
        }
      }

      const result: PlaceOrderResult = {
        success: true,
        orderId: data.orderId,
        subtotal: data.subtotal,
        deliveryCharge: data.deliveryCharge,
        couponDiscount: data.couponDiscount,
        totalAmount: data.totalAmount,
        message: data.message || 'ऑर्डर सफलतापूर्वक दर्ज हो गया!',
      };

      recentPlacedOrders.set(phoneProductKey, { result, createdAt: Date.now() });

      // Refresh orders cache asynchronously without blocking customer reply
      lastOrdersFetchAt = 0;
      fetchLiveOrders().catch(() => {});

      return result;
    } catch (err) {
      return {
        success: false,
        message: err instanceof Error ? err.message : 'ऑर्डर सर्वर से कनेक्ट नहीं हो सका।',
      };
    }
  };

  const pendingPromise = executeOrderPost();
  inFlightOrders.set(phoneProductKey, pendingPromise);
  inFlightOrders.set(phoneLockKey, pendingPromise);

  try {
    return await pendingPromise;
  } finally {
    inFlightOrders.delete(phoneProductKey);
    inFlightOrders.delete(phoneLockKey);
  }
}

export async function lookupLiveOrders(params: {
  orderId?: string;
  phone?: string;
}): Promise<StoreOrder[]> {
  const targetId = (params.orderId || '').trim().toUpperCase();
  const targetPhone10 = (params.phone || '').replace(/[^0-9]/g, '').slice(-10);

  let orders = storage.getStore().ordersCache;
  const cacheAgeMs = Date.now() - lastOrdersFetchAt;
  const shouldRefresh =
    orders.length === 0 ||
    cacheAgeMs > 15_000 ||
    (targetId && !orders.some((o) => o.id.toUpperCase().includes(targetId)));

  if (shouldRefresh) {
    const fetched = await fetchLiveOrders();
    orders = fetched.orders;
    if (fetched.source === 'live') {
      lastOrdersFetchAt = Date.now();
    }
  }

  return orders.filter((o) => {
    const idMatch = targetId ? o.id.toUpperCase().includes(targetId) : false;
    const orderPhone10 = o.phone.replace(/[^0-9]/g, '').slice(-10);
    const phoneMatch = targetPhone10.length === 10 && orderPhone10 === targetPhone10;
    if (targetId && targetPhone10) return idMatch || phoneMatch;
    if (targetId) return idMatch;
    if (targetPhone10) return phoneMatch;
    return false;
  });
}

export function formatOrderStageNotification(order: StoreOrder): string {
  const stage = order.deliveryStage;
  const agentInfo = order.assignedAgentName
    ? `\n• *डिलीवरी एजेंट:* ${order.assignedAgentName}${order.assignedAgentPhone ? ` (${order.assignedAgentPhone})` : ''}`
    : '';

  if (stage === 'DISPATCHED') {
    return (
      `प्रणाम ${order.customerName} जी! बिहार ग्रामीण बाज़ार से आपका ऑर्डर *${order.id}* डिस्पैच (रवाना) कर दिया गया है।\n\n` +
      `• *राशि:* ₹${order.totalAmount} (${order.paymentMethod})\n` +
      `• *पता:* ${order.villageOrTown || ''}, ${order.district} - ${order.pincode}` +
      agentInfo +
      `\n\nकिसी सहायता के लिए +91 9472258022 पर कॉल करें।`
    );
  }
  if (stage === 'RECEIVED_BY_AGENT') {
    return (
      `प्रणाम ${order.customerName} जी! आपका ऑर्डर *${order.id}* हमारे स्थानीय डिलीवरी एजेंट के पास पहुँच गया है।` +
      agentInfo +
      `\n\nजल्द ही डिलीवरी के लिए संपर्क किया जाएगा।`
    );
  }
  if (stage === 'OUT_FOR_DELIVERY') {
    return (
      `प्रणाम ${order.customerName} जी! आपका ऑर्डर *${order.id}* आज *Out for Delivery* है और जल्द ही आपके पते पर पहुँचेगा।\n\n` +
      `• *देय राशि:* ₹${order.totalAmount} (${order.paymentMethod})` +
      agentInfo +
      `\n\nकृपया अपना फोन चालू रखें।`
    );
  }
  if (stage === 'DELIVERED') {
    const payNote = order.collectedMethod
      ? `\n• *पेमेंट प्राप्त:* ${order.collectedMethod} (₹${order.collectedAmount ?? order.totalAmount})`
      : '';
    return (
      `प्रणाम ${order.customerName} जी! आपका ऑर्डर *${order.id}* सफलतापूर्वक डिलीवर हो गया है।` +
      payNote +
      `\n\nबिहार ग्रामीण बाज़ार से खरीदारी के लिए धन्यवाद! किसी भी रिप्लेसमेंट (7 दिन गारंटी) या सहायता के लिए यहीं मैसेज करें।`
    );
  }
  if (stage === 'FAILED_RETURN') {
    return (
      `प्रणाम ${order.customerName} जी! आपके ऑर्डर *${order.id}* की डिलीवरी पूरी नहीं हो सकी। दोबारा डिलीवरी शेड्यूल करने के लिए कृपया यहीं रिप्लाई करें या +91 9472258022 पर कॉल करें।`
    );
  }
  return (
    `प्रणाम ${order.customerName} जी! आपके ऑर्डर *${order.id}* की पुष्टि हो गई है।\n\n` +
    `• *स्टेटस:* ${order.status}\n` +
    `• *कुल राशि:* ₹${order.totalAmount} (${order.paymentMethod})\n` +
    `• *डिलीवरी:* 2–4 दिनों में (${order.district} - ${order.pincode})`
  );
}

export async function syncStoreAndDetectTransitions(
  onStageTransition?: (order: StoreOrder, previousStage: string) => Promise<void>
): Promise<{
  productsCount: number;
  ordersCount: number;
  transitions: Array<{ orderId: string; from: string; to: string }>;
  errors: string[];
}> {
  const errors: string[] = [];
  const [prodRes, ordRes] = await Promise.all([fetchLiveProducts(), fetchLiveOrders()]);
  if (prodRes.error) errors.push(`Products: ${prodRes.error}`);
  if (ordRes.error) errors.push(`Orders: ${ordRes.error}`);

  const store = storage.getStore();
  const isInitialSnapshot = Object.keys(store.orderStageSnapshots).length === 0;
  const transitions: Array<{ orderId: string; from: string; to: string }> = [];

  for (const order of ordRes.orders) {
    const prev = store.orderStageSnapshots[order.id];
    if (!prev) {
      store.orderStageSnapshots[order.id] = {
        deliveryStage: order.deliveryStage,
        status: order.status,
      };
      // Do not spam notifications for pre-existing orders on very first bootstrap
      if (!isInitialSnapshot && order.deliveryStage !== 'UNASSIGNED') {
        transitions.push({ orderId: order.id, from: 'NEW', to: order.deliveryStage });
        if (onStageTransition && store.settings.store.autoNotifyOrderStages) {
          await onStageTransition(order, 'NEW').catch(() => {});
        }
      }
    } else if (prev.deliveryStage !== order.deliveryStage) {
      const fromStage = prev.deliveryStage;
      store.orderStageSnapshots[order.id] = {
        deliveryStage: order.deliveryStage,
        status: order.status,
      };
      transitions.push({ orderId: order.id, from: fromStage, to: order.deliveryStage });
      if (onStageTransition && store.settings.store.autoNotifyOrderStages) {
        await onStageTransition(order, fromStage).catch(() => {});
      }
    }
  }

  storage.persist();
  return {
    productsCount: prodRes.products.length,
    ordersCount: ordRes.orders.length,
    transitions,
    errors,
  };
}

export { BIHAR_DISTRICTS };
