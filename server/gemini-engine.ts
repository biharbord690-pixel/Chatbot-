import {
  Content,
  FunctionDeclaration,
  GoogleGenAI,
  Part,
  Type,
} from '@google/genai';
import type { CustomerState, ToolCallLog } from '../lib/types';
import {
  BIHAR_DISTRICTS,
  lookupLiveOrders,
  placeLiveOrder,
  searchLiveProducts,
} from './ecommerce';
import { resolveServerGeminiApiKey, storage } from './storage';

let cachedGeminiClient: GoogleGenAI | null = null;
let cachedGeminiKey = '';

function getGeminiClient(): GoogleGenAI {
  const apiKey = resolveServerGeminiApiKey();
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY is not configured in server environment secrets.'
    );
  }
  if (cachedGeminiClient && cachedGeminiKey === apiKey) {
    return cachedGeminiClient;
  }
  cachedGeminiKey = apiKey;
  cachedGeminiClient = new GoogleGenAI({
    apiKey,
    // Function calling (tools / functionDeclarations) requires v1beta on @google/genai v2+
    apiVersion: 'v1beta',
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
  return cachedGeminiClient;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (val) => {
        clearTimeout(timer);
        resolve(val);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

function formatFullError(err: unknown): string {
  if (err instanceof Error) {
    return err.message || String(err);
  }
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

export function buildHindiFallbackReply(customerName?: string): string {
  const greeting = customerName && !customerName.startsWith('+') ? `प्रणाम ${customerName} जी!` : 'प्रणाम जी!';
  return (
    `${greeting} *बिहार ग्रामीण बाज़ार* में आपका स्वागत है।\n\n` +
    `हम बिहार के सभी 38 ज़िलों में *कैश ऑन डिलीवरी (COD)* की सुविधा देते हैं:\n` +
    `• ₹499+ के ऑर्डर पर *फ्री डिलीवरी* (कम पर ₹40)\n` +
    `• 7 दिन आसान रिप्लेसमेंट गारंटी\n` +
    `• वेबसाइट: https://bihargraminbazaar.com\n` +
    `• हेल्पलाइन: +91 9472258022\n\n` +
    `कृपया बताएं आपको कौन सा उत्पाद चाहिए या ऑर्डर के बारे में क्या जानकारी चाहिए? हमारी टीम तुरंत आपकी मदद करेगी।`
  );
}

const searchProductsDeclaration: FunctionDeclaration = {
  name: 'search_products',
  description:
    'Search live products from Bihar Gramin Bazaar catalog (https://bihargraminbazaar.com/api/products.php) matching Hindi/English/Hinglish keywords, category, or max price. Returns real prices, discounts, variants, stock status, and image URL.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      query: {
        type: Type.STRING,
        description:
          'Product search query in Hindi, Hinglish, or English (e.g., "jute bag", "sattu", "honey", "kurta"). Leave empty to list featured products.',
      },
      category: {
        type: Type.STRING,
        description: 'Optional category filter.',
      },
      maxPrice: {
        type: Type.NUMBER,
        description: 'Optional maximum price in INR.',
      },
    },
  },
};

const placeOrderDeclaration: FunctionDeclaration = {
  name: 'place_order',
  description:
    'Place a real confirmed COD or UPI order directly on Bihar Gramin Bazaar (https://bihargraminbazaar.com/api/orders.php). ONLY call this tool AFTER the customer has explicitly confirmed product, quantity, full name, 10-digit phone number, village/street address, Bihar district, and 6-digit pincode.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      productId: {
        type: Type.STRING,
        description: 'Product ID or SKU returned by search_products.',
      },
      productName: {
        type: Type.STRING,
        description: 'Product name if productId is not known.',
      },
      quantity: {
        type: Type.INTEGER,
        description: 'Quantity to order (minimum 1).',
      },
      selectedColor: {
        type: Type.STRING,
        description: 'Selected color variant if applicable.',
      },
      selectedSize: {
        type: Type.STRING,
        description: 'Selected size variant if applicable.',
      },
      customerName: {
        type: Type.STRING,
        description: 'Full name of the customer.',
      },
      phone: {
        type: Type.STRING,
        description: '10-digit Indian mobile number.',
      },
      streetOrVillage: {
        type: Type.STRING,
        description: 'Village, mohalla, ward, landmark, or street address.',
      },
      district: {
        type: Type.STRING,
        description: `Bihar district name (one of the 38 Bihar districts such as ${BIHAR_DISTRICTS.slice(0, 6).join(', ')}, etc.).`,
      },
      pincode: {
        type: Type.STRING,
        description: '6-digit postal pincode.',
      },
      paymentMethod: {
        type: Type.STRING,
        description: 'Payment method: COD or UPI. Defaults to COD.',
      },
      couponCode: {
        type: Type.STRING,
        description: 'Optional coupon code (DESHI50, BGB100, BIHAR150).',
      },
    },
    required: [
      'quantity',
      'customerName',
      'phone',
      'streetOrVillage',
      'district',
      'pincode',
    ],
  },
};

const checkOrderStatusDeclaration: FunctionDeclaration = {
  name: 'check_order_status',
  description:
    'Check live order status, payment collection status (CASH/UPI/PREPAID), delivery stage (UNASSIGNED, DISPATCHED, RECEIVED_BY_AGENT, OUT_FOR_DELIVERY, DELIVERED, FAILED_RETURN), and assigned delivery agent name & phone from Bihar Gramin Bazaar.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      orderId: {
        type: Type.STRING,
        description: 'Order ID such as BGB-XXXXXX.',
      },
      phone: {
        type: Type.STRING,
        description: 'Customer 10-digit phone number.',
      },
    },
  },
};

function isWithinBusinessHours(start: string, end: string): boolean {
  try {
    // Use Asia/Kolkata (IST) for Bihar Gramin Bazaar
    const nowIst = new Date(
      new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })
    );
    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = end.split(':').map(Number);
    const curMinutes = nowIst.getHours() * 60 + nowIst.getMinutes();
    const startMinutes = sh * 60 + (sm || 0);
    const endMinutes = eh * 60 + (em || 0);
    return curMinutes >= startMinutes && curMinutes <= endMinutes;
  } catch {
    return true;
  }
}

function matchKeywordQuickReply(text: string): string | null {
  const lower = text.trim().toLowerCase();
  if (!lower || lower.length > 120) return null;
  const rules = storage.getStore().settings.keywordReplies;
  for (const rule of rules) {
    if (!rule.enabled) continue;
    for (const kw of rule.keywords) {
      const normalizedKw = kw.trim().toLowerCase();
      if (normalizedKw && lower.includes(normalizedKw)) {
        return rule.reply;
      }
    }
  }
  return null;
}

export interface GeminiReplyResult {
  reply: string;
  skipped?: boolean;
  skipReason?: string;
  fallbackUsed?: boolean;
  errorDetail?: string;
  nextState: CustomerState;
  toolCalls: ToolCallLog[];
  matchedProductCard?: {
    id: string;
    name: string;
    hindiName?: string;
    price: number;
    originalPrice: number;
    image: string;
    inStock: boolean;
    url: string;
  };
}

export async function generateAiReply(params: {
  phone: string;
  customerName?: string;
  messageText: string;
  bypassPauseCheck?: boolean;
}): Promise<GeminiReplyResult> {
  const startedAt = Date.now();
  const store = storage.getStore();
  const aiSettings = store.settings.ai;
  const phone = storage.normalizePhone(params.phone);
  const session = storage.upsertSession(phone, {
    name: params.customerName,
  });

  if (!params.bypassPauseCheck) {
    const globalMode =
      aiSettings.mode || (aiSettings.enabled ? 'AUTO_ON' : 'MANUAL_ONLY');

    if (globalMode === 'MANUAL_ONLY' || !aiSettings.enabled) {
      return {
        reply: '',
        skipped: true,
        skipReason: 'Global mode is Manual Only (AI OFF)',
        nextState: session.state,
        toolCalls: [],
      };
    }

    if (
      globalMode === 'OUTSIDE_BUSINESS_HOURS' &&
      isWithinBusinessHours(aiSettings.businessHoursStart, aiSettings.businessHoursEnd)
    ) {
      return {
        reply: '',
        skipped: true,
        skipReason: `Inside business hours (${aiSettings.businessHoursStart}-${aiSettings.businessHoursEnd} IST) — AI runs only outside business hours`,
        nextState: session.state,
        toolCalls: [],
      };
    }

    if (!session.aiEnabled || session.aiPausedIndefinitely) {
      return {
        reply: '',
        skipped: true,
        skipReason:
          session.handoverSource === 'command'
            ? 'AI paused indefinitely via phone #manual/#stop command'
            : 'AI paused manually for this chat',
        nextState: session.state,
        toolCalls: [],
      };
    }

    if (session.aiPausedUntil && new Date(session.aiPausedUntil).getTime() > Date.now()) {
      return {
        reply: '',
        skipped: true,
        skipReason: `Human handover cooldown active until ${session.aiPausedUntil}`,
        nextState: session.state,
        toolCalls: [],
      };
    }
  }

  // Check instant keyword quick-reply for pure FAQ messages (when not mid-order)
  if (session.state !== 'ORDER_PLACING') {
    const quickReply = matchKeywordQuickReply(params.messageText);
    if (quickReply) {
      return {
        reply: quickReply,
        nextState: session.state,
        toolCalls: [],
      };
    }
  }

  const recentMessages = storage
    .getMessagesByPhone(phone, aiSettings.maxHistoryTurns * 2)
    .slice(-aiSettings.maxHistoryTurns * 2);

  const contents: Content[] = [];
  for (const m of recentMessages) {
    const role = m.direction === 'INBOUND' ? 'user' : 'model';
    if (m.body.trim()) {
      contents.push({
        role,
        parts: [{ text: m.body }],
      });
    }
  }

  // Ensure the latest user message is present at the tail
  const lastContent = contents[contents.length - 1];
  if (
    !lastContent ||
    lastContent.role !== 'user' ||
    lastContent.parts?.[0]?.text !== params.messageText
  ) {
    contents.push({
      role: 'user',
      parts: [{ text: params.messageText }],
    });
  }

  const ai = getGeminiClient();
  const configuredModel = (aiSettings.model || '').trim();
  const modelName = configuredModel || 'gemini-2.5-flash';
  const isGemini4 = modelName.startsWith('gemini-4');

  const sessionContextNote = `\n\n[वर्तमान ग्राहक संदर्भ]:\n- WhatsApp फोन: +${phone}\n- ग्राहक नाम: ${session.name}\n- वर्तमान स्थिति (State): ${session.state}\n- पिछला देखा गया उत्पाद: ${session.context.lastProductName || 'कोई नहीं'} (ID: ${session.context.lastProductId || 'N/A'})\n- पिछला ऑर्डर ID: ${session.context.lastOrderId || 'कोई नहीं'}`;

  const systemInstruction = `${aiSettings.systemPrompt}${sessionContextNote}`;

  const toolCallsLog: ToolCallLog[] = [];
  let nextState: CustomerState = session.state;
  let matchedProductCard: GeminiReplyResult['matchedProductCard'];

  const buildConfig = () => {
    const baseConfig: Record<string, unknown> = {
      systemInstruction,
      maxOutputTokens: 450,
      tools: [
        {
          functionDeclarations: [
            searchProductsDeclaration,
            placeOrderDeclaration,
            checkOrderStatusDeclaration,
          ],
        },
      ],
    };
    if (!isGemini4) {
      baseConfig.temperature = aiSettings.temperature;
    }
    // Disable hidden thinking tokens on Gemini 2.5 Flash for ultra-fast (<1s) WhatsApp chat replies
    if (modelName.includes('2.5-flash')) {
      baseConfig.thinkingConfig = { thinkingBudget: 0 };
    }
    return baseConfig;
  };

  try {
    let response = await ai.models.generateContent({
      model: modelName,
      contents,
      config: buildConfig(),
    });

    // Multi-turn tool execution loop (up to 4 tool steps)
    let loops = 0;
    while (response.functionCalls && response.functionCalls.length > 0 && loops < 4) {
      loops += 1;
      const modelContent = response.candidates?.[0]?.content;
      if (modelContent) {
        contents.push(modelContent);
      }

      const responseParts: Part[] = [];

      for (const call of response.functionCalls) {
        const args = (call.args || {}) as Record<string, unknown>;
        let toolOutput: Record<string, unknown> = {};
        let summary = '';

        if (call.name === 'search_products') {
          nextState = 'BROWSING';
          try {
            const results = await withTimeout(
              searchLiveProducts({
                query: typeof args.query === 'string' ? args.query : undefined,
                category: typeof args.category === 'string' ? args.category : undefined,
                maxPrice: typeof args.maxPrice === 'number' ? args.maxPrice : undefined,
                limit: 5,
              }),
              6000,
              'search_products'
            );

            if (results.length > 0) {
              const top = results[0];
              const website = store.settings.store.websiteUrl.replace(/\/$/, '');
              matchedProductCard = {
                id: top.id,
                name: top.name,
                hindiName: top.hindiName,
                price: top.price,
                originalPrice: top.originalPrice,
                image: top.image,
                inStock: top.inStock,
                url: top.slug ? `${website}/product/${top.slug}` : website,
              };
              storage.upsertSession(phone, {
                state: 'BROWSING',
                context: {
                  lastProductId: top.id,
                  lastProductName: top.name,
                },
              });
            }

            summary = `Found ${results.length} products`;
            toolOutput = {
              count: results.length,
              products: results.map((p) => ({
                id: p.id,
                sku: p.sku,
                name: p.name,
                hindiName: p.hindiName,
                price: p.price,
                originalPrice: p.originalPrice,
                discountPercent: p.discountPercent,
                inStock: p.inStock,
                stockCount: p.stockCount,
                category: p.category,
                deliveryDays: p.deliveryDays,
                image: p.image,
                colors: p.colorVariants?.map((c) => c.name) || [],
                sizes: p.sizeVariants?.map((s) => s.label || s.size).filter(Boolean) || [],
              })),
            };
          } catch (toolErr) {
            const toolErrMsg = formatFullError(toolErr);
            summary = `Store search fallback (${toolErrMsg})`;
            const cached = store.productsCache.slice(0, 5);
            toolOutput = {
              warning: `Live catalog temporarily slow (${toolErrMsg}). Showing cached items if available.`,
              count: cached.length,
              products: cached.map((p) => ({
                id: p.id,
                name: p.name,
                hindiName: p.hindiName,
                price: p.price,
                inStock: p.inStock,
                category: p.category,
              })),
            };
          }
        } else if (call.name === 'place_order') {
          nextState = 'ORDER_PLACING';
          try {
            const orderResult = await withTimeout(
              placeLiveOrder({
                productId: typeof args.productId === 'string' ? args.productId : session.context.lastProductId,
                productName:
                  typeof args.productName === 'string' ? args.productName : session.context.lastProductName,
                quantity: Number(args.quantity || 1),
                selectedColor: typeof args.selectedColor === 'string' ? args.selectedColor : undefined,
                selectedSize: typeof args.selectedSize === 'string' ? args.selectedSize : undefined,
                customerName: String(args.customerName || session.name),
                phone: String(args.phone || phone),
                streetOrVillage: String(args.streetOrVillage || ''),
                district: String(args.district || ''),
                pincode: String(args.pincode || ''),
                paymentMethod: args.paymentMethod === 'UPI' ? 'UPI' : 'COD',
                couponCode: typeof args.couponCode === 'string' ? args.couponCode : undefined,
              }),
              8000,
              'place_order'
            );

            if (orderResult.success && orderResult.orderId) {
              nextState = 'TRACKING';
              storage.upsertSession(phone, {
                state: 'TRACKING',
                name: String(args.customerName || session.name),
                context: {
                  lastOrderId: orderResult.orderId,
                  district: String(args.district || ''),
                },
              });
            }

            summary = orderResult.success
              ? `Order confirmed: ${orderResult.orderId}`
              : `Order failed: ${orderResult.message}`;
            toolOutput = orderResult;
          } catch (toolErr) {
            const toolErrMsg = formatFullError(toolErr);
            summary = `Order API timeout/error (${toolErrMsg})`;
            toolOutput = {
              success: false,
              message: `Store order API temporarily unreachable (${toolErrMsg}). Ask customer to confirm or call +91 9472258022.`,
            };
          }
        } else if (call.name === 'check_order_status') {
          nextState = 'TRACKING';
          try {
            const foundOrders = await withTimeout(
              lookupLiveOrders({
                orderId: typeof args.orderId === 'string' ? args.orderId : undefined,
                phone: typeof args.phone === 'string' ? args.phone : phone,
              }),
              6000,
              'check_order_status'
            );

            if (foundOrders.length > 0) {
              storage.upsertSession(phone, {
                state: 'TRACKING',
                context: {
                  lastOrderId: foundOrders[0].id,
                },
              });
            }

            summary = `Matched ${foundOrders.length} orders`;
            toolOutput = {
              count: foundOrders.length,
              orders: foundOrders.slice(0, 4).map((o) => ({
                orderId: o.id,
                customerName: o.customerName,
                status: o.status,
                deliveryStage: o.deliveryStage,
                totalAmount: o.totalAmount,
                paymentMethod: o.paymentMethod,
                collectedMethod: o.collectedMethod,
                collectedAmount: o.collectedAmount,
                district: o.district,
                pincode: o.pincode,
                orderDate: o.orderDate,
                trackingNumber: o.trackingNumber,
                assignedAgentName: o.assignedAgentName,
                assignedAgentPhone: o.assignedAgentPhone,
                dispatchedAt: o.dispatchedAt,
                deliveredAt: o.deliveredAt,
              })),
            };
          } catch (toolErr) {
            const toolErrMsg = formatFullError(toolErr);
            summary = `Order lookup failed (${toolErrMsg})`;
            toolOutput = {
              count: 0,
              warning: `Live order API temporarily unreachable (${toolErrMsg}). Please share Order ID or call +91 9472258022.`,
            };
          }
        } else {
          summary = `Unknown tool: ${call.name}`;
          toolOutput = { error: `Unknown tool ${call.name}` };
        }

        toolCallsLog.push({
          name: call.name || 'unknown',
          args,
          resultSummary: summary,
        });

        responseParts.push({
          functionResponse: {
            id: call.id,
            name: call.name,
            response: toolOutput,
          },
        });
      }

      contents.push({
        role: 'user',
        parts: responseParts,
      });

      response = await ai.models.generateContent({
        model: modelName,
        contents,
        config: buildConfig(),
      });
    }

    const finalText =
      (response.text || '').trim() ||
      'प्रणाम जी! कृपया अपना प्रश्न थोड़ा विस्तार से लिखें, या कस्टमर केयर +91 9472258022 पर संपर्क करें।';

    // Detect if customer is actively ordering even before calling place_order
    if (
      nextState !== 'TRACKING' &&
      /(order|ऑर्डर|खरीदना|lena hai|book|confirm|cod|pata|pincode|पिनकोड)/i.test(params.messageText)
    ) {
      nextState = 'ORDER_PLACING';
    }

    storage.upsertSession(phone, { state: nextState });
    storage.addAiLog({
      id: `ai-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      phone,
      query: params.messageText.slice(0, 300),
      reply: finalText.slice(0, 500),
      model: modelName,
      toolsUsed: toolCallsLog.map((t) => t.name),
      latencyMs: Date.now() - startedAt,
      status: 'SUCCESS',
      createdAt: new Date().toISOString(),
    });

    return {
      reply: finalText,
      nextState,
      toolCalls: toolCallsLog,
      matchedProductCard,
    };
  } catch (err) {
    const errMsg = formatFullError(err);
    storage.addAiLog({
      id: `ai-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      phone,
      query: params.messageText.slice(0, 300),
      reply: '',
      model: modelName,
      toolsUsed: toolCallsLog.map((t) => t.name),
      latencyMs: Date.now() - startedAt,
      status: 'ERROR',
      error: errMsg,
      createdAt: new Date().toISOString(),
    });
    // For the admin AI Test Bench (bypassPauseCheck === true), surface the raw error directly
    if (params.bypassPauseCheck) {
      throw new Error(errMsg);
    }
    // For real WhatsApp customers, still return a polite Hindi/Hinglish fallback while logging full error
    return {
      reply: buildHindiFallbackReply(params.customerName || session.name),
      fallbackUsed: true,
      errorDetail: errMsg,
      nextState: session.state,
      toolCalls: toolCallsLog,
    };
  }
}
