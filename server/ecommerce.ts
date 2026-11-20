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

export async function fetchLiveProducts(): Promise<{
  products: StoreProduct[];
  source: 'live' | 'cache';
  error?: string;
}> {
  const { productsUrl, websiteUrl } = getStoreUrls();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(productsUrl, {
      method: 'GET',
      headers: { Accept: 'application/json', 'User-Agent': 'BGB-WhatsApp-CRM/1.0' },
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
    store.productsCache = products;
    store.lastSyncAt = new Date().toISOString();
    storage.persist();

    return { products, source: 'live' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to reach products.php';
    return {
      products: storage.getStore().productsCache,
      source: 'cache',
      error: msg,
    };
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
    const timeout = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(ordersUrl, {
      method: 'GET',
      headers: { Accept: 'application/json', 'User-Agent': 'BGB-WhatsApp-CRM/1.0' },
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

export async function searchLiveProducts(params: {
  query?: string;
  category?: string;
  maxPrice?: number;
  limit?: number;
}): Promise<StoreProduct[]> {
  let products = storage.getStore().productsCache;
  if (products.length === 0) {
    const fetched = await fetchLiveProducts();
    products = fetched.products;
  }

  const q = (params.query || '').trim().toLowerCase();
  const cat = (params.category || '').trim().toLowerCase();
  const maxPrice = params.maxPrice && params.maxPrice > 0 ? params.maxPrice : undefined;
  const tokens = q.split(/\s+/).filter((t) => t.length > 1);

  const scored = products
    .filter((p) => {
      if (maxPrice && p.price > maxPrice) return false;
      if (cat && !p.category.toLowerCase().includes(cat) && !(p.subcategory || '').toLowerCase().includes(cat)) {
        return false;
      }
      return true;
    })
    .map((p) => {
      if (!q) return { product: p, score: p.inStock ? 2 : 1 };
      const haystack = [
        p.name,
        p.hindiName,
        p.category,
        p.subcategory || '',
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
      return { product: p, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  const limit = params.limit || 6;
  return scored.slice(0, limit).map((s) => s.product);
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
}

export async function placeLiveOrder(input: PlaceOrderInput): Promise<{
  success: boolean;
  orderId?: string;
  subtotal?: number;
  deliveryCharge?: number;
  couponDiscount?: number;
  totalAmount?: number;
  message: string;
}> {
  const { ordersUrl } = getStoreUrls();
  let products = storage.getStore().productsCache;
  if (products.length === 0) {
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
  const payload = {
    customerName: input.customerName.trim(),
    phone: cleanPhone,
    district: input.district.trim(),
    pincode: cleanPin,
    villageOrTown: input.streetOrVillage.trim(),
    address: `${input.streetOrVillage.trim()}, ${input.district.trim()}, Bihar - ${cleanPin}`,
    paymentMethod: input.paymentMethod === 'UPI' ? 'UPI' : 'COD',
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

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
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
    }

    // Refresh orders cache asynchronously
    fetchLiveOrders().catch(() => {});

    return {
      success: true,
      orderId: data.orderId,
      subtotal: data.subtotal,
      deliveryCharge: data.deliveryCharge,
      couponDiscount: data.couponDiscount,
      totalAmount: data.totalAmount,
      message: data.message || 'ऑर्डर सफलतापूर्वक दर्ज हो गया!',
    };
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? err.message : 'ऑर्डर सर्वर से कनेक्ट नहीं हो सका।',
    };
  }
}

export async function lookupLiveOrders(params: {
  orderId?: string;
  phone?: string;
}): Promise<StoreOrder[]> {
  const fetched = await fetchLiveOrders();
  const orders = fetched.orders;
  const targetId = (params.orderId || '').trim().toUpperCase();
  const targetPhone10 = (params.phone || '').replace(/[^0-9]/g, '').slice(-10);

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
