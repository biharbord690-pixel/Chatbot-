import {
  Content,
  FunctionDeclaration,
  GoogleGenAI,
  Part,
  ThinkingLevel,
  Type,
} from '@google/genai';
import type { CustomerState, InboundMediaAttachment, ToolCallLog } from '../lib/types';
import {
  BIHAR_DISTRICTS,
  lookupLiveOrders,
  placeLiveOrder,
  searchLiveProducts,
  type PlaceOrderResult,
} from './ecommerce';
import { resolveServerGeminiApiKey, storage } from './storage';

let cachedGeminiClient: GoogleGenAI | null = null;
let cachedGeminiKey = '';
let cachedWorkingModel = '';
let cachedConfiguredModel = '';
let cachedUseOptionalParams = true;
let cachedWorkingModelAt = 0;
const MODEL_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const unavailableModels = new Map<string, number>();

function isModelMarkedUnavailable(model: string): boolean {
  const markedAt = unavailableModels.get(model);
  if (!markedAt) return false;
  if (Date.now() - markedAt > MODEL_CACHE_TTL_MS) {
    unavailableModels.delete(model);
    return false;
  }
  return true;
}

function isSimpleGreetingOnly(text: string): boolean {
  const cleaned = text
    .trim()
    .toLowerCase()
    .replace(/[!?.,।~🙏😊👋😀😃😄😁🙂❤️]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned || cleaned.length > 28) return false;
  return /^(hi+|hey+|helo+|hello+|hlo+|namaste|namaskar|pranam|parnam|ram ram|radhe radhe|jay shri ram|jai shri ram|salam|good morning|good afternoon|good evening|good night|gm|gn|ok+|okay|thk|thik hai|theek hai|thanks|thank you|dhanyawad|shukriya|bye+|tata|ji|haan|han|hm+|hmm+|नमस्ते|नमस्कार|प्रणाम|हेलो|हाय|ठीक है|धन्यवाद|शुक्रिया)$/.test(
    cleaned
  );
}

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

function sanitizeBrandIdentity(text: string): string {
  // Never mention Google, Gemini, OpenAI, or ChatGPT in customer-facing WhatsApp replies
  // Also convert Markdown **bold** into native WhatsApp *bold*
  return text
    .replace(/\b(google\s*gemini|google\s*ai|google|gemini|openai|chatgpt)\b/gi, 'Bihar Gramin Bazaar')
    .replace(/गूगल/g, 'बिहार ग्रामीण बाज़ार')
    .replace(/जेमिनी/g, 'बिहार ग्रामीण बाज़ार')
    .replace(/\*\*([^*\n]+)\*\*/g, '*$1*');
}

export function buildHindiFallbackReply(customerName?: string): string {
  const greeting =
    customerName && !customerName.startsWith('+') ? `Namaste ${customerName} ji!` : 'Namaste ji!';
  return (
    `${greeting} *Bihar Gramin Bazaar* me aapka swagat hai 😊\n` +
    `Abhi thoda network busy chal raha hai — kripya apna sawal ya product ka naam dobara bhejein, ya hamari website https://bihargraminbazaar.com dekhein (Helpline: +91 9472258022).`
  );
}

const searchProductsDeclaration: FunctionDeclaration = {
  name: 'search_products',
  description:
    'Search LIVE up-to-date products from Bihar Gramin Bazaar website (https://bihargraminbazaar.com/api/products.php), including newly uploaded products, price updates, discounts, variants, stock status, and image URL. Set sortBy="newest" when customer asks for new arrivals, recent uploads, or latest products.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      query: {
        type: Type.STRING,
        description:
          'Product search query in Hindi, Hinglish, or English (e.g., "jute bag", "sattu", "honey", "face wash"). Leave empty to list featured or newest products.',
      },
      category: {
        type: Type.STRING,
        description: 'Optional category filter.',
      },
      maxPrice: {
        type: Type.NUMBER,
        description: 'Optional maximum price in INR.',
      },
      sortBy: {
        type: Type.STRING,
        description:
          'Optional sort order: "relevance" (default) or "newest" (use "newest" when customer asks for recently uploaded / latest / new products).',
      },
    },
  },
};

const placeOrderDeclaration: FunctionDeclaration = {
  name: 'place_order',
  description:
    'Place ONE real confirmed COD or UPI order directly on Bihar Gramin Bazaar (https://bihargraminbazaar.com/api/orders.php). ONLY call this tool ONCE AFTER the customer has explicitly confirmed product, quantity, full name, 10-digit phone number, village/street address, Bihar district, and 6-digit pincode. NEVER call place_order again if an order is already confirmed for this customer (even if they ask to apply a coupon, change address, check status, or reply "ok/thanks/confirm")!',
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

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matchKeywordQuickReply(text: string): string | null {
  const cleaned = text.trim();
  const lower = cleaned.toLowerCase();
  // Only trigger canned FAQ quick-replies on very short pure-FAQ messages (never hijack real conversations,
  // addresses, pincodes, or phone numbers — e.g. "pincode" contains "cod"!)
  if (!lower || lower.length > 45) return null;
  if (/\d{5,}/.test(lower)) return null; // contains pincode / phone / order number -> always let Gemini handle
  const wordCount = lower.split(/\s+/).filter(Boolean).length;
  if (wordCount > 5) return null;

  const rules = storage.getStore().settings.keywordReplies;
  for (const rule of rules) {
    if (!rule.enabled) continue;
    for (const kw of rule.keywords) {
      const normalizedKw = kw.trim().toLowerCase();
      if (!normalizedKw) continue;
      const isAscii = /^[a-z0-9\s]+$/i.test(normalizedKw);
      if (isAscii) {
        const pattern = new RegExp(`(?<![a-z0-9])${escapeRegExp(normalizedKw)}(?![a-z0-9])`, 'i');
        if (pattern.test(lower)) {
          return rule.reply;
        }
      } else if (lower === normalizedKw || lower.includes(normalizedKw)) {
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
  mediaAttachments?: InboundMediaAttachment[];
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

  const hasMedia = Boolean(params.mediaAttachments && params.mediaAttachments.length > 0);

  // Check instant keyword quick-reply for pure FAQ text messages (never when mid-order or when photo/voice is attached)
  if (!hasMedia && session.state !== 'ORDER_PLACING') {
    const quickReply = matchKeywordQuickReply(params.messageText);
    if (quickReply) {
      return {
        reply: quickReply,
        nextState: session.state,
        toolCalls: [],
      };
    }
  }

  const effectiveHistoryLimit = Math.min(aiSettings.maxHistoryTurns, 6) * 2;
  const recentMessages = storage
    .getMessagesByPhone(phone, effectiveHistoryLimit)
    .slice(-effectiveHistoryLimit);

  // Build strictly alternating user/model turns (Gemini rejects consecutive user turns or model-first history)
  // Keep older turns concise so token count stays low and replies stay ultra-fast even on free tier!
  const contents: Content[] = [];
  const pushTurn = (role: 'user' | 'model', text: string, isOlderTurn = false) => {
    const rawClean = text.trim();
    if (!rawClean) return;
    const clean =
      isOlderTurn && rawClean.length > 420 ? `${rawClean.slice(0, 420)}…` : rawClean;
    const prev = contents[contents.length - 1];
    if (!prev) {
      if (role !== 'user') return;
      contents.push({ role: 'user', parts: [{ text: clean }] });
      return;
    }
    if (prev.role === role) {
      const prevText = prev.parts?.[0]?.text || '';
      prev.parts = [{ text: `${prevText}\n${clean}` }];
    } else {
      contents.push({ role, parts: [{ text: clean }] });
    }
  };

  const recentCutoffIdx = Math.max(0, recentMessages.length - 4);
  for (let idx = 0; idx < recentMessages.length; idx += 1) {
    const m = recentMessages[idx];
    if (m.senderType === 'SYSTEM') continue;
    const role: 'user' | 'model' = m.direction === 'INBOUND' ? 'user' : 'model';
    pushTurn(role, m.body, idx < recentCutoffIdx);
  }

  // Ensure the latest customer message is always at the tail as a user turn
  const latestText = params.messageText.trim();
  const lastContent = contents[contents.length - 1];
  if (
    !lastContent ||
    lastContent.role !== 'user' ||
    !(lastContent.parts?.[0]?.text || '').endsWith(latestText)
  ) {
    pushTurn('user', latestText, false);
  }

  // Attach incoming customer Photos & Voice Messages directly as Gemini multimodal inlineData parts
  const mediaAttachments = (params.mediaAttachments || []).slice(0, 3);
  if (mediaAttachments.length > 0) {
    const tailTurn = contents[contents.length - 1];
    if (tailTurn && tailTurn.role === 'user') {
      const multimodalParts: Part[] = [...(tailTurn.parts || [])];
      let hasImage = false;
      let hasAudio = false;
      for (const att of mediaAttachments) {
        if (!att.base64) continue;
        const cleanMime = (att.mimeType || (att.kind === 'image' ? 'image/jpeg' : 'audio/ogg'))
          .split(';')[0]
          .trim();
        multimodalParts.push({
          inlineData: {
            mimeType: cleanMime,
            data: att.base64,
          },
        });
        if (att.kind === 'image') hasImage = true;
        if (att.kind === 'audio') hasAudio = true;
      }

      const guidanceLines: string[] = [];
      if (hasImage) {
        guidanceLines.push(
          '[ग्राहक ने यह फोटो भेजा है। फोटो को ध्यान से देखें — चाहे कोई प्रोडक्ट हो, स्क्रीनशॉट हो, लिखा हुआ पता/ऑर्डर हो, या डैमेज फोटो हो। अगर यह किसी प्रोडक्ट की फोटो है तो search_products चलाकर हमारे कैटलॉग से मिलता-जुलता प्रोडक्ट, ताज़ा कीमत और उपलब्धता बताएँ।]'
        );
      }
      if (hasAudio) {
        guidanceLines.push(
          '[ग्राहक ने यह वॉइस मैसेज (Voice Note) भेजा है। इसे ध्यान से सुनें — चाहे हिंदी, Hinglish, English, मैथिली या भोजपुरी/बिहारी में हो — और ग्राहक जो पूछ रहा है उसका सीधा, छोटा और सही जवाब उसी भाषा में दें। ज़रूरत हो तो search_products / place_order / check_order_status टूल चलाएँ।]'
        );
      }
      if (guidanceLines.length > 0) {
        multimodalParts.push({ text: guidanceLines.join('\n') });
      }
      tailTurn.parts = multimodalParts;
    }
  }

  const ai = getGeminiClient();
  const rawConfiguredModel = (aiSettings.model || '').trim();
  const isRetiredOrInvalidModel =
    !rawConfiguredModel ||
    rawConfiguredModel.startsWith('gemini-1.') ||
    rawConfiguredModel.startsWith('gemini-2.') ||
    rawConfiguredModel === 'gemini-pro' ||
    rawConfiguredModel === 'gemini-3.8-flash';
  const modelName = isRetiredOrInvalidModel ? 'gemini-4-hydrogen' : rawConfiguredModel;

  const recentOrderWarning = session.context.lastOrderId
    ? `\n- ⚠️ महत्वपूर्ण चेतावनी: इस ग्राहक का ऑर्डर *${session.context.lastOrderId}*${session.context.lastOrderProductName ? ` (${session.context.lastOrderProductName})` : ''} पहले से दर्ज हो चुका है। दोबारा place_order टूल *कभी न चलाएँ* (कूपन लगाने, पता बदलने, या "ok/thanks/confirm" बोलने पर भी नहीं) — जब तक ग्राहक साफ-साफ "एक और नया ऑर्डर करना है" न बोले।`
    : '';

  const sessionContextNote = `\n\n[वर्तमान ग्राहक संदर्भ]:\n- WhatsApp फोन: +${phone}\n- ग्राहक नाम: ${session.name}\n- वर्तमान स्थिति (State): ${session.state}\n- पिछला देखा गया उत्पाद: ${session.context.lastProductName || 'कोई नहीं'} (ID: ${session.context.lastProductId || 'N/A'})\n- पिछला ऑर्डर ID: ${session.context.lastOrderId || 'कोई नहीं'}${recentOrderWarning}`;

  const systemInstruction = `${aiSettings.systemPrompt}${sessionContextNote}`;

  const toolCallsLog: ToolCallLog[] = [];
  let nextState: CustomerState = session.state;
  let matchedProductCard: GeminiReplyResult['matchedProductCard'];

  // Skip attaching heavy tool JSON schemas on pure 1–2 word greetings ("Hello", "Namaste", "Thanks")
  // so Gemini responds in ~1s while still giving a genuine, personalized AI reply!
  const skipToolsForGreeting =
    !hasMedia && session.state !== 'ORDER_PLACING' && isSimpleGreetingOnly(params.messageText);

  const buildConfig = (
    targetModel: string,
    includeOptionalParams: boolean,
    abortSignal?: AbortSignal
  ) => {
    const isGemini4 = targetModel.startsWith('gemini-4');
    const isFlashLite = targetModel.includes('flash-lite');
    const baseConfig: Record<string, unknown> = {
      systemInstruction,
      ...(abortSignal ? { abortSignal } : {}),
      ...(skipToolsForGreeting
        ? {}
        : {
            tools: [
              {
                functionDeclarations: [
                  searchProductsDeclaration,
                  placeOrderDeclaration,
                  checkOrderStatusDeclaration,
                ],
              },
            ],
          }),
    };

    if (includeOptionalParams) {
      // Never pass deprecated sampling params (temperature) to Gemini 4 series models
      if (!isGemini4) {
        baseConfig.temperature = aiSettings.temperature;
      }

      // Gemini 4 defaults to HIGH thinking; use LOW for fast WhatsApp replies.
      // gemini-3.1-flash-lite already defaults to MINIMAL thinking natively — no extra thinkingConfig needed.
      if (isGemini4 && !isFlashLite) {
        baseConfig.thinkingConfig = {
          thinkingLevel: ThinkingLevel.LOW,
        };
      }
    }

    return baseConfig;
  };

  // Ordered active free-tier fallback list (never uses deprecated 1.5/2.0/pro or invalid model IDs)
  // Put the last known fast working model first and skip any model known to return 404 on this API key!
  const isCacheValid =
    Boolean(cachedWorkingModel) &&
    cachedConfiguredModel === modelName &&
    Date.now() - cachedWorkingModelAt < MODEL_CACHE_TTL_MS &&
    !isModelMarkedUnavailable(cachedWorkingModel);

  const allCandidates = Array.from(
    new Set([
      ...(isCacheValid ? [cachedWorkingModel] : []),
      modelName,
      'gemini-4-hydrogen',
      'gemini-3.1-flash-lite',
    ])
  );
  const filteredCandidates = allCandidates.filter((m) => !isModelMarkedUnavailable(m));
  const candidateModels = filteredCandidates.length > 0 ? filteredCandidates : allCandidates;

  let activeModel = candidateModels[0];
  let useOptionalParams = isCacheValid ? cachedUseOptionalParams : true;

  const invokeWithAbortTimeout = async (
    candidate: string,
    turnContents: Content[],
    optParams: boolean,
    timeoutMs: number,
    label: string
  ) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await withTimeout(
        ai.models.generateContent({
          model: candidate,
          contents: turnContents,
          config: buildConfig(candidate, optParams, controller.signal),
        }),
        timeoutMs + 1000,
        label
      );
    } finally {
      clearTimeout(timer);
    }
  };

  const callModelSafely = async (turnContents: Content[]) => {
    let lastError: unknown;
    const attemptSummaries: string[] = [];
    const startIdx = Math.max(0, candidateModels.indexOf(activeModel));
    const baseTimeoutMs = hasMedia ? 30_000 : 24_000;

    for (let i = startIdx; i < candidateModels.length; i += 1) {
      const candidate = candidateModels[i];
      try {
        const res = await invokeWithAbortTimeout(
          candidate,
          turnContents,
          useOptionalParams,
          baseTimeoutMs,
          `gemini:${candidate}`
        );
        activeModel = candidate;
        cachedWorkingModel = candidate;
        cachedConfiguredModel = modelName;
        cachedUseOptionalParams = useOptionalParams;
        cachedWorkingModelAt = Date.now();
        return res;
      } catch (err) {
        lastError = err;
        const rawErrMsg = formatFullError(err);
        const msg = rawErrMsg.toLowerCase();
        attemptSummaries.push(`${candidate}: ${rawErrMsg.slice(0, 120)}`);

        // Cache 404/NOT_FOUND models as unavailable for 30 min so future messages skip them in 0ms
        if (msg.includes('404') || msg.includes('not_found') || msg.includes('is not found')) {
          unavailableModels.set(candidate, Date.now());
          if (candidate === cachedWorkingModel) cachedWorkingModel = '';
          continue;
        }

        // If API key is invalid/unauthorized, fail immediately rather than trying other models
        if (
          msg.includes('api_key_invalid') ||
          msg.includes('permission_denied') ||
          msg.includes('403')
        ) {
          throw lastError;
        }

        // If thinkingConfig or temperature was rejected by this model, retry cleanly with minimal config
        if (
          useOptionalParams &&
          (msg.includes('thinking') ||
            msg.includes('temperature') ||
            msg.includes('invalid_argument') ||
            msg.includes('400'))
        ) {
          try {
            const retryRes = await invokeWithAbortTimeout(
              candidate,
              turnContents,
              false,
              baseTimeoutMs,
              `gemini:${candidate}:minimal`
            );
            activeModel = candidate;
            useOptionalParams = false;
            cachedWorkingModel = candidate;
            cachedConfiguredModel = modelName;
            cachedUseOptionalParams = false;
            cachedWorkingModelAt = Date.now();
            return retryRes;
          } catch (retryErr) {
            lastError = retryErr;
            attemptSummaries.push(`${candidate}(minimal): ${formatFullError(retryErr).slice(0, 100)}`);
          }
        }

        // Transient timeout / 503 / 429 / network stall: retry ONCE cleanly after a short 700ms backoff
        // using trimmed recent context so free-tier spikes recover automatically without failing the user!
        const isTransient =
          msg.includes('timed out') ||
          msg.includes('abort') ||
          msg.includes('503') ||
          msg.includes('unavailable') ||
          msg.includes('overloaded') ||
          msg.includes('429') ||
          msg.includes('resource_exhausted') ||
          msg.includes('fetch failed') ||
          msg.includes('econnreset') ||
          msg.includes('etimedout');

        if (isTransient) {
          await new Promise((r) => setTimeout(r, 700));
          // Keep last 4 turns on retry (ensuring first turn is 'user') to guarantee fast response
          let compactContents = turnContents;
          if (turnContents.length > 4) {
            const sliced = turnContents.slice(-4);
            const firstUserIdx = sliced.findIndex((c) => c.role === 'user');
            if (firstUserIdx >= 0) {
              compactContents = sliced.slice(firstUserIdx);
            }
          }
          try {
            const retryRes = await invokeWithAbortTimeout(
              candidate,
              compactContents,
              false,
              28_000,
              `gemini:${candidate}:retry`
            );
            activeModel = candidate;
            cachedWorkingModel = candidate;
            cachedConfiguredModel = modelName;
            cachedUseOptionalParams = false;
            cachedWorkingModelAt = Date.now();
            return retryRes;
          } catch (retryErr) {
            lastError = retryErr;
            attemptSummaries.push(`${candidate}(retry): ${formatFullError(retryErr).slice(0, 100)}`);
          }
        }

        if (candidate === cachedWorkingModel) {
          cachedWorkingModel = '';
        }
      }
    }

    throw new Error(
      attemptSummaries.length > 0 ? attemptSummaries.join(' | ') : formatFullError(lastError)
    );
  };

  try {
    let response;
    try {
      response = await callModelSafely(contents);
    } catch (initialErr) {
      // Smart fallback for WhatsApp voice notes: if multimodal audio failed directly on the chat model,
      // transcribe with gemini-3.5-transcribe first and retry cleanly as text!
      const audioAttachment = mediaAttachments.find((a) => a.kind === 'audio' && a.base64);
      if (audioAttachment) {
        const cleanMime = (audioAttachment.mimeType || 'audio/ogg').split(';')[0].trim();
        const transcriptRes = await withTimeout(
          ai.models.generateContent({
            model: 'gemini-3.5-transcribe',
            contents: {
              parts: [
                { inlineData: { mimeType: cleanMime, data: audioAttachment.base64 } },
                { text: 'Transcribe this WhatsApp voice message accurately in its original language (Hindi, Hinglish, English, Maithili, or Bhojpuri).' },
              ],
            },
          }),
          24_000,
          'gemini:transcribe'
        );
        const transcript = (transcriptRes.text || '').trim();
        if (transcript) {
          const tail = contents[contents.length - 1];
          if (tail && tail.role === 'user') {
            tail.parts = [
              { text: `${latestText}\n[Voice Message Transcript]: ${transcript}` },
            ];
          }
          response = await callModelSafely(contents);
        } else {
          throw initialErr;
        }
      } else {
        throw initialErr;
      }
    }
    let placedOrderInTurn: PlaceOrderResult | null = null;

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
            const sortBy = args.sortBy === 'newest' ? 'newest' : 'relevance';
            const results = await withTimeout(
              searchLiveProducts({
                query: typeof args.query === 'string' ? args.query : undefined,
                category: typeof args.category === 'string' ? args.category : undefined,
                maxPrice: typeof args.maxPrice === 'number' ? args.maxPrice : undefined,
                sortBy,
                limit: 6,
              }),
              7000,
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

            summary = `Found ${results.length} live products${sortBy === 'newest' ? ' (newest)' : ''}`;
            toolOutput = {
              count: results.length,
              syncedAt: store.lastSyncAt,
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
                createdAt: p.createdAt,
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
          const explicitRepeatIntent =
            /(ek aur|aur ek|dusra order|doosra order|naya order|new order|second order|another order|2nd order|phir se order|dobara order|order again|एक और|दूसरा ऑर्डर|नया ऑर्डर)/i.test(
              params.messageText
            );

          // Hard single-order guard: never submit place_order more than once in the same turn
          if (placedOrderInTurn && placedOrderInTurn.success) {
            summary = `Duplicate place_order blocked (already confirmed: ${placedOrderInTurn.orderId})`;
            toolOutput = {
              ...placedOrderInTurn,
              alreadyPlaced: true,
              message: `Order ${placedOrderInTurn.orderId} is already confirmed. Share this single Order ID with the customer without placing another order.`,
            };
          } else {
            try {
              const targetProductId =
                typeof args.productId === 'string' ? args.productId : session.context.lastProductId;
              const targetProductName =
                typeof args.productName === 'string'
                  ? args.productName
                  : session.context.lastProductName;

              const orderResult = await withTimeout(
                placeLiveOrder({
                  productId: targetProductId,
                  productName: targetProductName,
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
                  allowRepeatOrder: explicitRepeatIntent,
                }),
                16_000,
                'place_order'
              );

              if (orderResult.success && orderResult.orderId) {
                placedOrderInTurn = orderResult;
                // Do not attach a slow product image card on order confirmation replies
                matchedProductCard = undefined;
                nextState = 'TRACKING';
                storage.upsertSession(phone, {
                  state: 'TRACKING',
                  name: String(args.customerName || session.name),
                  context: {
                    lastOrderId: orderResult.orderId,
                    lastOrderProductId: targetProductId,
                    lastOrderProductName: targetProductName,
                    lastOrderAt: new Date().toISOString(),
                    district: String(args.district || ''),
                  },
                });
              }

              summary = orderResult.success
                ? orderResult.alreadyPlaced
                  ? `Duplicate blocked — existing order: ${orderResult.orderId}`
                  : `Order confirmed: ${orderResult.orderId}`
                : `Order failed: ${orderResult.message}`;
              toolOutput = { ...orderResult };
            } catch (toolErr) {
              const toolErrMsg = formatFullError(toolErr);
              summary = `Order API timeout/error (${toolErrMsg})`;
              toolOutput = {
                success: false,
                message: `Store order API temporarily unreachable (${toolErrMsg}). Ask customer to confirm or call +91 9472258022.`,
              };
            }
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

      response = await callModelSafely(contents);
    }

    const rawFinalText =
      (response.text || '').trim() ||
      'Namaste ji! Kripya apna sawal thoda detail me batayein, ya helpline +91 9472258022 par sampark karein.';
    const finalText = sanitizeBrandIdentity(rawFinalText);

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
      model: activeModel,
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
      model: activeModel,
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
