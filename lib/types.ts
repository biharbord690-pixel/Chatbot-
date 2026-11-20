export type CustomerState = 'IDLE' | 'BROWSING' | 'ORDER_PLACING' | 'TRACKING';

export type AiGlobalMode = 'AUTO_ON' | 'OUTSIDE_BUSINESS_HOURS' | 'MANUAL_ONLY';

export type HandoverSource = 'phone' | 'dashboard' | 'command' | null;

export type DeliveryStage =
  | 'UNASSIGNED'
  | 'DISPATCHED'
  | 'RECEIVED_BY_AGENT'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'FAILED_RETURN';

export type ChannelType = 'baileys' | 'meta';

export type BaileysConnectionStatus =
  | 'DISCONNECTED'
  | 'CONNECTING'
  | 'QR_READY'
  | 'CONNECTED'
  | 'LOGGED_OUT';

export interface ProductColorVariant {
  name: string;
  hindiName?: string;
  hex?: string;
  image?: string;
  inStock?: boolean;
  price?: number;
}

export interface ProductSizeVariant {
  label?: string;
  size?: string;
  color?: string;
  price?: number;
  originalPrice?: number;
  sku?: string;
  inStock?: boolean;
  stockCount?: number;
}

export interface StoreProduct {
  id: string;
  sku: string;
  name: string;
  hindiName: string;
  price: number;
  originalPrice: number;
  discountPercent: number;
  category: string;
  subcategory?: string;
  brand?: string;
  description: string;
  image: string;
  images: string[];
  stockCount: number;
  inStock: boolean;
  deliveryDays: number;
  slug?: string;
  badge?: string;
  highlights?: string[];
  colorVariants?: ProductColorVariant[];
  sizeVariants?: ProductSizeVariant[];
  createdAt?: string;
  updatedAt?: string;
}

export interface OrderItem {
  productId?: string;
  product?: Partial<StoreProduct>;
  quantity: number;
  unitPrice?: number;
  originalUnitPrice?: number;
  selectedSize?: string;
  selectedColor?: string;
  selectedSku?: string;
  selectedImage?: string;
}

export interface StoreOrder {
  id: string;
  customerName: string;
  phone: string;
  district: string;
  pincode: string;
  villageOrTown: string;
  address: string | Record<string, unknown>;
  totalAmount: number;
  paymentMethod: string;
  status: string;
  items: OrderItem[];
  orderDate: string;
  trackingNumber?: string;
  assignedAgentId?: string;
  assignedAgentCode?: string;
  assignedAgentName?: string;
  assignedAgentPhone?: string;
  deliveryStage: DeliveryStage;
  dispatchedAt?: string;
  receivedAt?: string;
  deliveredAt?: string;
  collectedMethod?: 'CASH' | 'UPI' | 'PREPAID' | null;
  collectedAmount?: number | null;
  upiRefNote?: string;
  cashSettled?: boolean;
  settledAt?: string;
  deliveryProofNote?: string;
}

export interface ChatSession {
  phone: string;
  rawJid?: string;
  altJid?: string;
  name: string;
  avatarUrl?: string;
  state: CustomerState;
  channel: ChannelType;
  aiEnabled: boolean;
  aiPausedUntil: string | null;
  aiPausedIndefinitely?: boolean;
  handoverSource?: HandoverSource;
  unreadCount: number;
  lastMessage: string;
  lastMessageDirection: 'INBOUND' | 'OUTBOUND';
  lastMessageAt: string;
  createdAt: string;
  context: {
    lastProductId?: string;
    lastProductName?: string;
    lastOrderId?: string;
    lastOrderProductId?: string;
    lastOrderProductName?: string;
    lastOrderAt?: string;
    district?: string;
  };
}

export interface ToolCallLog {
  name: string;
  args: Record<string, unknown>;
  resultSummary: string;
}

export interface InboundMediaAttachment {
  kind: 'image' | 'audio';
  mimeType: string;
  base64: string;
  mediaUrl?: string;
}

export interface ChatMessage {
  id: string;
  wamId: string;
  phone: string;
  direction: 'INBOUND' | 'OUTBOUND';
  senderType: 'CUSTOMER' | 'AI' | 'HUMAN' | 'SYSTEM';
  origin?: 'dashboard' | 'phone' | 'ai' | 'system';
  messageType: 'text' | 'image' | 'audio' | 'product_card' | 'order_update';
  body: string;
  channel: ChannelType;
  mediaUrl?: string;
  mediaMimeType?: string;
  productCard?: {
    id: string;
    name: string;
    hindiName?: string;
    price: number;
    originalPrice: number;
    image: string;
    inStock: boolean;
    url: string;
  };
  toolCalls?: ToolCallLog[];
  status: 'RECEIVED' | 'SENT' | 'DELIVERED' | 'FAILED';
  createdAt: string;
}

export interface KeywordQuickReply {
  id: string;
  label: string;
  keywords: string[];
  reply: string;
  enabled: boolean;
}

export interface ChannelLogEntry {
  id: string;
  timestamp: string;
  channel: ChannelType | 'system';
  level: 'info' | 'warn' | 'error' | 'success';
  message: string;
}

export interface AiAuditLog {
  id: string;
  phone: string;
  query: string;
  reply: string;
  model: string;
  toolsUsed: string[];
  latencyMs: number;
  status: 'SUCCESS' | 'ERROR';
  error?: string;
  createdAt: string;
}

export interface AppSettings {
  ai: {
    enabled: boolean;
    mode: AiGlobalMode;
    model: string;
    temperature: number;
    systemPrompt: string;
    handoverCooldownMinutes: number;
    maxHistoryTurns: number;
    businessHoursOnly: boolean;
    businessHoursStart: string;
    businessHoursEnd: string;
    afterHoursMessage: string;
  };
  store: {
    name: string;
    hindiName: string;
    websiteUrl: string;
    apiBaseUrl: string;
    supportPhone: string;
    freeDeliveryThreshold: number;
    deliveryFeeBelowThreshold: number;
    autoNotifyOrderStages: boolean;
    syncIntervalMinutes: number;
  };
  meta: {
    enabled: boolean;
    appId: string;
    configId: string;
    verifyToken: string;
    phoneNumberId: string;
    wabaId: string;
    apiVersion: string;
    hasAppSecret: boolean;
    hasAccessToken: boolean;
    maskedAppSecret: string;
    maskedAccessToken: string;
  };
  keywordReplies: KeywordQuickReply[];
  geminiConfigured: boolean;
}

export interface BaileysStateSnapshot {
  status: BaileysConnectionStatus;
  qrDataUrl: string | null;
  pairingCode?: string | null;
  connectedPhone: string | null;
  connectedName: string | null;
  lastConnectedAt: string | null;
  lastError?: string | null;
  updatedAt?: string;
  reconnectAttempts: number;
}

export interface OverviewMetrics {
  totalChats: number;
  activeAiChats: number;
  pausedHandoverChats: number;
  unreadChats: number;
  totalMessages: number;
  aiReplies: number;
  humanReplies: number;
  inboundMessages: number;
  whatsappOrdersCount: number;
  totalSyncedOrders: number;
  totalSyncedProducts: number;
  lastSyncAt: string | null;
  baileysStatus: BaileysConnectionStatus;
  baileysPhone: string | null;
  metaEnabled: boolean;
  aiGlobalEnabled: boolean;
  aiGlobalMode: AiGlobalMode;
}
