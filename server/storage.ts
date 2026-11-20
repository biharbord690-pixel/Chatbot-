import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import type {
  AiAuditLog,
  AppSettings,
  ChannelLogEntry,
  ChatMessage,
  ChatSession,
  KeywordQuickReply,
  StoreOrder,
  StoreProduct,
} from '../lib/types';
import { scheduleRemoteBackup } from './remote-backup';

export const DATA_DIR = path.join(process.cwd(), 'data');
export const BAILEYS_AUTH_DIR = path.join(DATA_DIR, 'baileys_auth');
export const DEFAULT_ADMIN_EMAIL = 'bihargraminbazaar9@gmail.com';
const STORE_FILE = path.join(DATA_DIR, 'crm_store.json');
const SECRETS_FILE = path.join(DATA_DIR, 'secrets.enc');
const KEY_FILE = path.join(DATA_DIR, '.vault.key');

export interface EncryptedSecrets {
  metaAppSecret: string;
  metaAccessToken: string;
}

export interface AdminAccount {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  createdAt: string;
}

export interface PersistedStore {
  admin: AdminAccount | null;
  sessions: Record<string, ChatSession>;
  messages: ChatMessage[];
  aiLogs: AiAuditLog[];
  channelLogs: ChannelLogEntry[];
  settings: Omit<AppSettings, 'meta' | 'geminiConfigured'> & {
    meta: {
      enabled: boolean;
      appId: string;
      configId: string;
      verifyToken: string;
      phoneNumberId: string;
      wabaId: string;
      apiVersion: string;
    };
  };
  productsCache: StoreProduct[];
  ordersCache: StoreOrder[];
  orderStageSnapshots: Record<string, { deliveryStage: string; status: string }>;
  whatsappOrderIds: string[];
  botSentMessageIds: string[];
  lastSyncAt: string | null;
}

export const DEFAULT_SYSTEM_PROMPT = `आप 'बिहार ग्रामीण बाज़ार' (Bihar Gramin Bazaar - https://bihargraminbazaar.com) के मिलनसार, स्मार्ट और भरोसेमंद WhatsApp ग्राहक सहायता सहायक हैं।

सख्त नियम और बातचीत का अंदाज़:
1. सभी भाषाओं में फ्रेंडली और नैचुरल बातचीत:
   - ग्राहक जिस भाषा या अंदाज़ में बात करे — Hinglish (जैसे "hello", "bhai rate btao", "order kaise kre"), English, शुद्ध हिंदी, मैथिली (Maithili - जैसे "प्रणाम, केना छी? की चाहि अहाँ के?"), या बिहारी / भोजपुरी / मगही (Bihari/Bhojpuri - जैसे "प्रणाम जी, का हाल बा? बताईं का चाहीं?") — ठीक उसी भाषा और दोस्ताना अंदाज़ में नैचुरल इंसान की तरह बात करें।
   - हर मैसेज पर एक ही लंबा वेलकम मैसेज बार-बार न दोहराएँ। पहली बार प्यार से स्वागत करें (जैसे Hinglish में "Namaste ji! Bihar Gramin Bazaar me aapka swagat hai 😊 Bataiye kya madad kar sakta hoon?"), उसके बाद ग्राहक के सवाल के हिसाब से सीधा, छोटा और काम का जवाब दें।

2. आपकी पहचान और बनाने वाले के बारे में (अत्यंत महत्वपूर्ण):
   - अगर कोई पूछे "तुम्हें किसने बनाया है?", "Who made you?", "Kaun banaya hai?", "Tum kaun ho?", या "Kya tum Google/Gemini/ChatGPT ho?":
     • हमेशा साफ और गर्व से ग्राहक की भाषा में जवाब दें:
       - Hinglish: "Mujhe Bihar Gramin Bazaar ke dwara logon ki madad karne ke liye banaya gaya hai! 😊"
       - Hindi: "मुझे बिहार ग्रामीण बाज़ार के द्वारा लोगों की मदद करने के लिए बनाया गया है! 😊"
       - English: "I was created by Bihar Gramin Bazaar to help people with their shopping, orders, and delivery! 😊"
       - Maithili/Bihari: "Hamra Bihar Gramin Bazaar ke dwara sab lokak madad karay lel banael gel chhi! 😊"
   - कभी भी Google, Gemini, OpenAI, ChatGPT, या किसी बाहरी कंपनी/मॉडल का नाम भूलकर भी न लें।

3. सिर्फ़ Bihar Gramin Bazaar के बारे में ही बात करें (बाहरी विषय सख्त मना हैं):
   - आप केवल बिहार ग्रामीण बाज़ार (https://bihargraminbazaar.com) के प्रोडक्ट्स, कीमत, ऑफर/कूपन, ऑर्डर बुक करने, COD/UPI पेमेंट, डिलीवरी ट्रैकिंग, और रिप्लेसमेंट/सपोर्ट के बारे में ही मदद करेंगे।
   - अगर कोई बाहरी सवाल पूछे (जैसे राजनीति, फिल्म, मौसम, पढ़ाई/मैथ्स, कोडिंग, जोक्स, न्यूज़, जनरल नॉलेज, या किसी दूसरी वेबसाइट/ऐप के बारे में), तो विनम्रता से मना करें और बातचीत को बिहार ग्रामीण बाज़ार पर वापस लाएँ (जैसे: "Maaf kijiye ji, main sirf Bihar Gramin Bazaar ke products, orders aur delivery me madad kar sakta hoon. Bataiye aapko hamari website par kaunsa product dekhna hai?").

4. स्टोर नीतियाँ और ऑफर्स:
   - बिहार के सभी 38 ज़िलों में कैश ऑन डिलीवरी (COD) और UPI उपलब्ध है।
   - ₹499 या उससे अधिक के ऑर्डर पर फ्री डिलीवरी है। ₹499 से कम के ऑर्डर पर मात्र ₹40 डिलीवरी चार्ज लगता है।
   - डिलीवरी समय: 2 से 4 दिन · 7 दिन की आसान रिप्लेसमेंट गारंटी।
   - कस्टमर केयर नंबर: +91 9472258022 · वेबसाइट: https://bihargraminbazaar.com
   - उपलब्ध कूपन: DESHI50 (₹299+ पर ₹50 छूट), BGB100 (₹499+ पर ₹100 छूट), BIHAR150 (₹999+ पर ₹150 छूट)।

5. लाइव टूल्स का प्रयोग:
   - जब भी ग्राहक किसी प्रोडक्ट, कीमत, रंग, साइज या उपलब्धता के बारे में पूछे, हमेशा search_products टूल चलाएँ। कभी भी मन से कीमत या स्टॉक न बताएँ।
   - ऑर्डर कन्फर्म करने से पहले ग्राहक से ये सभी विवरण अवश्य लें: (क) उत्पाद व मात्रा (और रंग/साइज यदि लागू हो), (ख) पूरा नाम, (ग) 10 अंकों का मोबाइल नंबर, (घ) गाँव/मोहल्ला/पूरा पता, (ङ) बिहार का ज़िला, (च) 6 अंकों का पिनकोड, और (छ) पेमेंट मोड (COD या UPI)। सभी जानकारी पक्की होने पर ही place_order टूल चलाएँ।
   - ऑर्डर ट्रैकिंग, डिलीवरी एजेंट का नाम/नंबर, या पेमेंट स्टेटस पूछने पर check_order_status टूल चलाएँ।
   - जवाब छोटे, दोस्ताना, व्हाट्सएप-अनुकूल और सटीक रखें।`;

export const DEFAULT_KEYWORD_REPLIES: KeywordQuickReply[] = [
  {
    id: 'kw-cod',
    label: 'COD & Delivery Policy',
    keywords: ['cod', 'cash on delivery', 'delivery charge', 'kitne din', 'डिलीवरी', 'कैश ऑन डिलीवरी'],
    reply:
      'प्रणाम जी! बिहार ग्रामीण बाज़ार में *बिहार के सभी 38 ज़िलों* में कैश ऑन डिलीवरी (COD) उपलब्ध है।\n\n• *डिलीवरी चार्ज:* ₹499+ के ऑर्डर पर बिल्कुल *फ्री डिलीवरी* (₹499 से कम पर ₹40)\n• *डिलीवरी समय:* 2–4 कार्यदिवस\n• *गारंटी:* 7 दिन आसान रिप्लेसमेंट\n\nक्या आप कोई उत्पाद देखना या ऑर्डर करना चाहेंगे?',
    enabled: true,
  },
  {
    id: 'kw-care',
    label: 'Customer Care Helpline',
    keywords: ['customer care', 'helpline', 'call', 'contact number', 'कस्टमर केयर', 'हेल्पलाइन', 'संपर्क'],
    reply:
      'प्रणाम जी! बिहार ग्रामीण बाज़ार कस्टमर केयर से जुड़ने के लिए:\n\n• *हेल्पलाइन नंबर:* +91 9472258022\n• *वेबसाइट:* https://bihargraminbazaar.com\n• *समय:* सुबह 9:00 से रात 9:00 बजे तक\n\nआप यहीं WhatsApp पर भी अपना सवाल या ऑर्डर नंबर भेज सकते हैं।',
    enabled: true,
  },
  {
    id: 'kw-price',
    label: 'Price & Offers',
    keywords: ['offer', 'coupon', 'discount', 'ऑफर', 'कूपन', 'छूट'],
    reply:
      'प्रणाम जी! बिहार ग्रामीण बाज़ार के मौजूदा कूपन ऑफर:\n\n• *DESHI50* — ₹299+ के ऑर्डर पर ₹50 छूट\n• *BGB100* — ₹499+ के ऑर्डर पर ₹100 छूट + फ्री डिलीवरी\n• *BIHAR150* — ₹999+ के ऑर्डर पर ₹150 छूट\n\nकिसी उत्पाद का नाम लिखें, मैं तुरंत ताज़ा कीमत और स्टॉक बताता हूँ।',
    enabled: true,
  },
];

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(BAILEYS_AUTH_DIR)) {
    fs.mkdirSync(BAILEYS_AUTH_DIR, { recursive: true });
  }
}

function cleanOptionalEnv(value: string | undefined): string {
  const trimmed = (value || '').trim();
  if (!trimmed) return '';
  const lower = trimmed.toLowerCase();
  if (
    lower === 'later' ||
    lower === 'none' ||
    lower === 'skip' ||
    lower === 'na' ||
    lower === 'n/a' ||
    lower === 'null' ||
    lower === 'undefined' ||
    lower === 'optional' ||
    lower.startsWith('change_me') ||
    lower.startsWith('my_')
  ) {
    return '';
  }
  return trimmed;
}

export function getAuthorizedAdminEmail(): string {
  const envEmail = cleanOptionalEnv(process.env.ADMIN_EMAIL);
  if (envEmail && envEmail.includes('@')) {
    return envEmail.toLowerCase();
  }
  return DEFAULT_ADMIN_EMAIL;
}

export function resolveServerGeminiApiKey(): string {
  const candidates = [
    process.env.GEMINI_API_KEY,
    process.env.GOOGLE_API_KEY,
    process.env.GOOGLE_GEMINI_API_KEY,
  ];
  for (const raw of candidates) {
    const unquoted = (raw || '').trim().replace(/^["']+|["']+$/g, '').trim();
    const cleaned = cleanOptionalEnv(unquoted);
    if (cleaned && cleaned.length > 10) {
      return cleaned;
    }
  }
  return '';
}

function getEncryptionKey(): Buffer {
  ensureDataDir();
  const envKey = cleanOptionalEnv(process.env.CONFIG_ENCRYPTION_KEY);
  if (envKey && envKey.length >= 16) {
    return crypto.createHash('sha256').update(envKey).digest();
  }
  if (fs.existsSync(KEY_FILE)) {
    const hex = fs.readFileSync(KEY_FILE, 'utf8').trim();
    if (hex.length === 64) {
      return Buffer.from(hex, 'hex');
    }
  }
  const generated = crypto.randomBytes(32);
  fs.writeFileSync(KEY_FILE, generated.toString('hex'), { mode: 0o600 });
  return generated;
}

export function getJwtSecret(): string {
  const envSecret = cleanOptionalEnv(process.env.JWT_SECRET);
  if (envSecret && envSecret.length >= 16) {
    return envSecret;
  }
  return crypto
    .createHmac('sha256', getEncryptionKey())
    .update('bgb-crm-jwt-signing-secret')
    .digest('hex');
}

export function loadSecrets(): EncryptedSecrets {
  ensureDataDir();
  const envDefaults: EncryptedSecrets = {
    metaAppSecret: cleanOptionalEnv(process.env.META_APP_SECRET),
    metaAccessToken: cleanOptionalEnv(process.env.META_ACCESS_TOKEN),
  };

  if (!fs.existsSync(SECRETS_FILE)) {
    return envDefaults;
  }

  try {
    const raw = JSON.parse(fs.readFileSync(SECRETS_FILE, 'utf8')) as {
      iv: string;
      tag: string;
      data: string;
    };
    const key = getEncryptionKey();
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(raw.iv, 'hex'));
    decipher.setAuthTag(Buffer.from(raw.tag, 'hex'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(raw.data, 'hex')),
      decipher.final(),
    ]).toString('utf8');
    const parsed = JSON.parse(decrypted) as Partial<EncryptedSecrets>;
    return {
      metaAppSecret: parsed.metaAppSecret ?? envDefaults.metaAppSecret,
      metaAccessToken: parsed.metaAccessToken ?? envDefaults.metaAccessToken,
    };
  } catch {
    return envDefaults;
  }
}

export function saveSecrets(partial: Partial<EncryptedSecrets>): EncryptedSecrets {
  ensureDataDir();
  const current = loadSecrets();
  const next: EncryptedSecrets = {
    metaAppSecret:
      partial.metaAppSecret !== undefined ? partial.metaAppSecret.trim() : current.metaAppSecret,
    metaAccessToken:
      partial.metaAccessToken !== undefined
        ? partial.metaAccessToken.trim()
        : current.metaAccessToken,
  };

  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(next), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  fs.writeFileSync(
    SECRETS_FILE,
    JSON.stringify({
      iv: iv.toString('hex'),
      tag: tag.toString('hex'),
      data: encrypted.toString('hex'),
    }),
    { mode: 0o600 }
  );

  scheduleRemoteBackup('secrets');
  return next;
}

export function maskSecret(value: string): string {
  if (!value) return '';
  if (value.length <= 8) return '••••••••';
  return `${value.slice(0, 4)}••••••••${value.slice(-4)}`;
}

function createInitialStore(): PersistedStore {
  const adminEmail = cleanOptionalEnv(process.env.ADMIN_EMAIL);
  const adminPassword = cleanOptionalEnv(process.env.ADMIN_PASSWORD);
  let admin: AdminAccount | null = null;
  if (adminEmail && adminPassword && adminEmail.includes('@') && adminPassword.length >= 6) {
    admin = {
      id: 'admin-1',
      email: adminEmail.toLowerCase(),
      name: 'BGB Store Admin',
      passwordHash: bcrypt.hashSync(adminPassword, 10),
      createdAt: new Date().toISOString(),
    };
  }

  const metaPhoneNumberId = cleanOptionalEnv(process.env.META_PHONE_NUMBER_ID);
  const metaAccessToken = cleanOptionalEnv(process.env.META_ACCESS_TOKEN);

  return {
    admin,
    sessions: {},
    messages: [],
    aiLogs: [],
    channelLogs: [],
    settings: {
      ai: {
        enabled: true,
        mode: 'AUTO_ON',
        model: 'gemini-2.5-flash',
        temperature: 0.3,
        systemPrompt: DEFAULT_SYSTEM_PROMPT,
        handoverCooldownMinutes: 30,
        maxHistoryTurns: 10,
        businessHoursOnly: false,
        businessHoursStart: '09:00',
        businessHoursEnd: '21:00',
        afterHoursMessage:
          'प्रणाम जी! बिहार ग्रामीण बाज़ार की सहायता टीम अभी ऑफलाइन है (समय: सुबह 9:00 से रात 9:00 बजे)। अपना संदेश छोड़ दें, हम सुबह तुरंत संपर्क करेंगे।',
      },
      store: {
        name: 'Bihar Gramin Bazaar',
        hindiName: 'बिहार ग्रामीण बाज़ार',
        websiteUrl: 'https://bihargraminbazaar.com',
        apiBaseUrl:
          cleanOptionalEnv(process.env.BGB_STORE_API_BASE) ||
          'https://bihargraminbazaar.com/api',
        supportPhone: '+91 9472258022',
        freeDeliveryThreshold: 499,
        deliveryFeeBelowThreshold: 40,
        autoNotifyOrderStages: true,
        syncIntervalMinutes: 5,
      },
      meta: {
        enabled: Boolean(metaPhoneNumberId && metaAccessToken),
        appId: cleanOptionalEnv(process.env.META_APP_ID) || '1521339533384901',
        configId: cleanOptionalEnv(process.env.META_CONFIG_ID) || '1132291603061911',
        verifyToken:
          cleanOptionalEnv(process.env.META_VERIFY_TOKEN) || 'bgb_whatsapp_verify_token_2026',
        phoneNumberId: metaPhoneNumberId,
        wabaId: cleanOptionalEnv(process.env.META_WABA_ID),
        apiVersion: cleanOptionalEnv(process.env.META_API_VERSION) || 'v21.0',
      },
      keywordReplies: DEFAULT_KEYWORD_REPLIES,
    },
    productsCache: [],
    ordersCache: [],
    orderStageSnapshots: {},
    whatsappOrderIds: [],
    botSentMessageIds: [],
    lastSyncAt: null,
  };
}

class StorageManager {
  private data: PersistedStore;
  private botSentSet: Set<string>;
  private saveTimer: NodeJS.Timeout | null = null;
  private lastLoadMigratedAdmin = false;

  constructor() {
    ensureDataDir();
    this.data = this.loadFromDisk();
    this.botSentSet = new Set(this.data.botSentMessageIds || []);
  }

  private syncAdminAccountEmail(store: PersistedStore): boolean {
    if (!store.admin) return false;
    const targetEmail = getAuthorizedAdminEmail();
    let changed = false;

    if (store.admin.email.toLowerCase() !== targetEmail) {
      store.admin.email = targetEmail;
      changed = true;
    }

    const envPassword = cleanOptionalEnv(process.env.ADMIN_PASSWORD);
    if (envPassword && envPassword.length >= 6) {
      if (!bcrypt.compareSync(envPassword, store.admin.passwordHash)) {
        store.admin.passwordHash = bcrypt.hashSync(envPassword, 10);
        changed = true;
      }
    }

    return changed;
  }

  private loadFromDisk(): PersistedStore {
    this.lastLoadMigratedAdmin = false;
    const initial = createInitialStore();
    if (!fs.existsSync(STORE_FILE)) {
      this.writeImmediate(initial);
      return initial;
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8')) as Partial<PersistedStore>;
      const merged: PersistedStore = {
        ...initial,
        ...parsed,
        settings: {
          ...initial.settings,
          ...(parsed.settings || {}),
          ai: { ...initial.settings.ai, ...(parsed.settings?.ai || {}) },
          store: { ...initial.settings.store, ...(parsed.settings?.store || {}) },
          meta: { ...initial.settings.meta, ...(parsed.settings?.meta || {}) },
          keywordReplies: parsed.settings?.keywordReplies || initial.settings.keywordReplies,
        },
        sessions: parsed.sessions || {},
        messages: Array.isArray(parsed.messages) ? parsed.messages : [],
        aiLogs: Array.isArray(parsed.aiLogs) ? parsed.aiLogs : [],
        channelLogs: Array.isArray(parsed.channelLogs) ? parsed.channelLogs : [],
        productsCache: Array.isArray(parsed.productsCache) ? parsed.productsCache : [],
        ordersCache: Array.isArray(parsed.ordersCache) ? parsed.ordersCache : [],
        orderStageSnapshots: parsed.orderStageSnapshots || {},
        whatsappOrderIds: Array.isArray(parsed.whatsappOrderIds) ? parsed.whatsappOrderIds : [],
        botSentMessageIds: Array.isArray(parsed.botSentMessageIds) ? parsed.botSentMessageIds : [],
      };
      let diskMutated = false;
      if (this.syncAdminAccountEmail(merged)) {
        this.lastLoadMigratedAdmin = true;
        diskMutated = true;
      }

      // Automatically upgrade old built-in default system prompt to the new multilingual + BGB creator identity prompt
      const currentPrompt = merged.settings.ai.systemPrompt || '';
      if (
        currentPrompt.includes('बिहार ग्रामीण बाज़ार') &&
        currentPrompt.includes('आधिकारिक, अति-विनम्र') &&
        !currentPrompt.includes('द्वारा लोगों की मदद')
      ) {
        merged.settings.ai.systemPrompt = DEFAULT_SYSTEM_PROMPT;
        this.lastLoadMigratedAdmin = true;
        diskMutated = true;
      }

      if (diskMutated) {
        this.writeImmediate(merged);
      }
      return merged;
    } catch {
      return initial;
    }
  }

  private writeImmediate(store: PersistedStore): void {
    ensureDataDir();
    const tmpPath = `${STORE_FILE}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(store, null, 2), 'utf8');
    fs.renameSync(tmpPath, STORE_FILE);
  }

  public reloadFromDisk(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.data = this.loadFromDisk();
    this.botSentSet = new Set(this.data.botSentMessageIds || []);
    if (this.lastLoadMigratedAdmin) {
      scheduleRemoteBackup('admin_email_sync');
    }
  }

  public persist(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }
    this.saveTimer = setTimeout(() => {
      try {
        this.writeImmediate(this.data);
        scheduleRemoteBackup('storage');
      } catch (err) {
        console.error('[Storage] Failed to persist store:', err);
      }
    }, 150);
  }

  public persistNow(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.writeImmediate(this.data);
    scheduleRemoteBackup('storage');
  }

  public getStore(): PersistedStore {
    return this.data;
  }

  public getPublicSettings(): AppSettings {
    const secrets = loadSecrets();
    return {
      ai: this.data.settings.ai,
      store: this.data.settings.store,
      keywordReplies: this.data.settings.keywordReplies,
      meta: {
        ...this.data.settings.meta,
        hasAppSecret: Boolean(secrets.metaAppSecret),
        hasAccessToken: Boolean(secrets.metaAccessToken),
        maskedAppSecret: maskSecret(secrets.metaAppSecret),
        maskedAccessToken: maskSecret(secrets.metaAccessToken),
      },
      geminiConfigured: Boolean(resolveServerGeminiApiKey()),
    };
  }

  public normalizePhone(raw: string): string {
    const digits = raw.replace(/[^0-9]/g, '');
    if (digits.length === 10) return `91${digits}`;
    return digits;
  }

  public upsertSession(
    rawPhone: string,
    patch: Partial<ChatSession> & { name?: string }
  ): ChatSession {
    const phone = this.normalizePhone(rawPhone);
    const now = new Date().toISOString();
    const existing = this.data.sessions[phone];
    const updated: ChatSession = existing
      ? {
          ...existing,
          ...patch,
          phone,
          name: patch.name?.trim() ? patch.name.trim() : existing.name,
          context: { ...existing.context, ...(patch.context || {}) },
        }
      : {
          phone,
          name: patch.name?.trim() || `+${phone}`,
          state: patch.state || 'IDLE',
          channel: patch.channel || 'baileys',
          aiEnabled: patch.aiEnabled ?? true,
          aiPausedUntil: patch.aiPausedUntil ?? null,
          aiPausedIndefinitely: patch.aiPausedIndefinitely ?? false,
          handoverSource: patch.handoverSource ?? null,
          unreadCount: patch.unreadCount ?? 0,
          lastMessage: patch.lastMessage || '',
          lastMessageDirection: patch.lastMessageDirection || 'INBOUND',
          lastMessageAt: patch.lastMessageAt || now,
          createdAt: now,
          context: patch.context || {},
        };

    this.data.sessions[phone] = updated;
    this.persist();
    return updated;
  }

  public hasMessageWithWamId(wamId: string): boolean {
    if (!wamId) return false;
    return this.data.messages.some((m) => m.wamId === wamId);
  }

  public addMessage(msg: ChatMessage): ChatMessage {
    if (msg.wamId && this.hasMessageWithWamId(msg.wamId)) {
      return this.data.messages.find((m) => m.wamId === msg.wamId) || msg;
    }
    this.data.messages.push(msg);
    if (this.data.messages.length > 5000) {
      this.data.messages = this.data.messages.slice(-5000);
    }

    const session = this.data.sessions[msg.phone];
    const unreadInc = msg.direction === 'INBOUND' ? 1 : 0;
    this.upsertSession(msg.phone, {
      channel: msg.channel,
      lastMessage: msg.body.slice(0, 200),
      lastMessageDirection: msg.direction,
      lastMessageAt: msg.createdAt,
      unreadCount: (session?.unreadCount || 0) + unreadInc,
    });
    this.persist();
    return msg;
  }

  public getMessagesByPhone(rawPhone: string, limit = 100): ChatMessage[] {
    const phone = this.normalizePhone(rawPhone);
    return this.data.messages.filter((m) => m.phone === phone).slice(-limit);
  }

  public addChannelLog(
    channel: ChannelLogEntry['channel'],
    level: ChannelLogEntry['level'],
    message: string
  ): ChannelLogEntry {
    const entry: ChannelLogEntry = {
      id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: new Date().toISOString(),
      channel,
      level,
      message,
    };
    this.data.channelLogs.unshift(entry);
    if (this.data.channelLogs.length > 120) {
      this.data.channelLogs = this.data.channelLogs.slice(0, 120);
    }
    this.persist();
    return entry;
  }

  public addAiLog(log: AiAuditLog): void {
    this.data.aiLogs.unshift(log);
    if (this.data.aiLogs.length > 200) {
      this.data.aiLogs = this.data.aiLogs.slice(0, 200);
    }
    this.persist();
  }

  public recordWhatsappOrder(orderId: string): void {
    if (orderId && !this.data.whatsappOrderIds.includes(orderId)) {
      this.data.whatsappOrderIds.unshift(orderId);
      this.persist();
    }
  }

  public recordBotSentMessageId(wamId: string): void {
    if (!wamId) return;
    this.botSentSet.add(wamId);
    if (!this.data.botSentMessageIds.includes(wamId)) {
      this.data.botSentMessageIds.push(wamId);
      if (this.data.botSentMessageIds.length > 2500) {
        const removed = this.data.botSentMessageIds.splice(
          0,
          this.data.botSentMessageIds.length - 2500
        );
        for (const id of removed) {
          this.botSentSet.delete(id);
        }
      }
      this.persist();
    }
  }

  public isBotSentMessageId(wamId: string): boolean {
    if (!wamId) return false;
    return this.botSentSet.has(wamId);
  }
}

export const storage = new StorageManager();
