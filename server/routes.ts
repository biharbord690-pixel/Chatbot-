import bcrypt from 'bcryptjs';
import express, { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import type { OverviewMetrics } from '../lib/types';
import {
  fetchLiveOrders,
  fetchLiveProducts,
  syncStoreAndDetectTransitions,
} from './ecommerce';
import { generateAiReply } from './gemini-engine';
import { messageRouter } from './message-router';
import {
  DEFAULT_SYSTEM_PROMPT,
  getJwtSecret,
  saveSecrets,
  storage,
} from './storage';
import { baileysManager } from './whatsapp-baileys';
import {
  extractMetaEchoMessages,
  extractMetaInboundMessages,
  verifyMetaSignature,
} from './whatsapp-meta';

interface AuthedRequest extends Request {
  admin?: { id: string; email: string; name: string };
  rawBody?: Buffer;
}

const COOKIE_NAME = 'bgb_crm_token';

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = decodeURIComponent(part.slice(idx + 1).trim());
    out[key] = val;
  }
  return out;
}

function getTokenFromRequest(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  const cookies = parseCookies(req.headers.cookie);
  return cookies[COOKIE_NAME] || null;
}

function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  const token = getTokenFromRequest(req);
  if (!token) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  try {
    const payload = jwt.verify(token, getJwtSecret()) as {
      id: string;
      email: string;
      name: string;
    };
    req.admin = payload;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired session' });
  }
}

function setAuthCookie(req: Request, res: Response, token: string): void {
  const isHttps =
    req.secure ||
    req.headers['x-forwarded-proto'] === 'https' ||
    process.env.NODE_ENV === 'production';
  const cookieParts = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    isHttps ? 'SameSite=None' : 'SameSite=Lax',
    `Max-Age=${60 * 60 * 24 * 7}`,
  ];
  if (isHttps) cookieParts.push('Secure');
  res.setHeader('Set-Cookie', cookieParts.join('; '));
}

export function createApiRouter(): express.Router {
  const router = express.Router();

  // Capture raw body for Meta HMAC-SHA256 webhook verification
  router.use(
    express.json({
      limit: '2mb',
      verify: (req, _res, buf) => {
        (req as AuthedRequest).rawBody = buf;
      },
    })
  );

  // Health Check (lightweight for Render healthCheckPath & UptimeRobot keep-alive pings)
  router.get('/health', (_req, res) => {
    res.status(200).json({
      ok: true,
      baileysStatus: baileysManager.getSnapshot().status,
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  });

  // =========================================================================
  // META WHATSAPP CLOUD API WEBHOOK (Public — verified via token & HMAC)
  // =========================================================================
  router.get('/webhooks/meta', (req, res) => {
    const mode = String(req.query['hub.mode'] || '');
    const token = String(req.query['hub.verify_token'] || '');
    const challenge = String(req.query['hub.challenge'] || '');
    const expectedToken = storage.getStore().settings.meta.verifyToken;

    if (mode === 'subscribe' && token === expectedToken) {
      storage.addChannelLog('meta', 'success', 'Meta Cloud API webhook verified successfully.');
      res.status(200).send(challenge);
      return;
    }
    res.status(403).send('Forbidden: verify_token mismatch');
  });

  router.post('/webhooks/meta', async (req: AuthedRequest, res) => {
    const signature = req.headers['x-hub-signature-256'] as string | undefined;
    if (req.rawBody && !verifyMetaSignature(req.rawBody, signature)) {
      storage.addChannelLog('meta', 'error', 'Rejected webhook payload: invalid X-Hub-Signature-256.');
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }

    const inboundList = extractMetaInboundMessages(req.body);
    const echoList = extractMetaEchoMessages(req.body);
    // Respond immediately to Meta so webhook never times out
    res.status(200).json({
      status: 'EVENT_RECEIVED',
      count: inboundList.length,
      echoCount: echoList.length,
    });

    for (const echo of echoList) {
      await messageRouter
        .handlePhoneOutgoingMessage({
          channel: 'meta',
          wamId: echo.wamId,
          phone: echo.phone,
          body: echo.body,
          timestamp: echo.timestamp,
        })
        .catch(() => {});
    }

    for (const inbound of inboundList) {
      await messageRouter
        .handleInboundMessage({
          channel: 'meta',
          wamId: inbound.wamId,
          phone: inbound.phone,
          customerName: inbound.customerName,
          body: inbound.body,
          timestamp: inbound.timestamp,
        })
        .catch(() => {});
    }
  });

  // =========================================================================
  // AUTHENTICATION ROUTES
  // =========================================================================
  router.get('/auth/status', (req, res) => {
    const admin = storage.getStore().admin;
    const token = getTokenFromRequest(req);
    let currentUser: { id: string; email: string; name: string } | null = null;

    if (token) {
      try {
        currentUser = jwt.verify(token, getJwtSecret()) as {
          id: string;
          email: string;
          name: string;
        };
      } catch {
        currentUser = null;
      }
    }

    res.json({
      needsSetup: !admin,
      authenticated: Boolean(currentUser),
      user: currentUser,
      token: currentUser ? token : null,
    });
  });

  router.post('/auth/setup', (req, res) => {
    const store = storage.getStore();
    if (store.admin) {
      res.status(409).json({ error: 'Admin account is already configured. Please sign in.' });
      return;
    }

    const schema = z.object({
      name: z.string().min(2).max(80),
      email: z.string().email(),
      password: z.string().min(6).max(128),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Provide a valid name, email, and password (min 6 chars).' });
      return;
    }

    const account = {
      id: 'admin-1',
      email: parsed.data.email.trim().toLowerCase(),
      name: parsed.data.name.trim(),
      passwordHash: bcrypt.hashSync(parsed.data.password, 10),
      createdAt: new Date().toISOString(),
    };
    store.admin = account;
    storage.persistNow();

    const tokenPayload = { id: account.id, email: account.email, name: account.name };
    const token = jwt.sign(tokenPayload, getJwtSecret(), { expiresIn: '7d' });
    setAuthCookie(req, res, token);

    res.json({
      success: true,
      token,
      user: tokenPayload,
    });
  });

  router.post('/auth/login', (req, res) => {
    const store = storage.getStore();
    if (!store.admin) {
      res.status(400).json({ error: 'Admin account not yet created. Complete initial setup first.' });
      return;
    }

    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');

    if (email !== store.admin.email || !bcrypt.compareSync(password, store.admin.passwordHash)) {
      res.status(401).json({ error: 'Invalid email or password.' });
      return;
    }

    const tokenPayload = {
      id: store.admin.id,
      email: store.admin.email,
      name: store.admin.name,
    };
    const token = jwt.sign(tokenPayload, getJwtSecret(), { expiresIn: '7d' });
    setAuthCookie(req, res, token);

    res.json({
      success: true,
      token,
      user: tokenPayload,
    });
  });

  router.post('/auth/logout', (req, res) => {
    const isHttps =
      req.secure ||
      req.headers['x-forwarded-proto'] === 'https' ||
      process.env.NODE_ENV === 'production';
    res.setHeader(
      'Set-Cookie',
      `${COOKIE_NAME}=; Path=/; HttpOnly; ${isHttps ? 'SameSite=None; Secure; ' : 'SameSite=Lax; '}Max-Age=0`
    );
    res.json({ success: true });
  });

  router.post('/auth/change-password', requireAuth, (req: AuthedRequest, res) => {
    const store = storage.getStore();
    if (!store.admin) {
      res.status(400).json({ error: 'Admin not initialized' });
      return;
    }
    const currentPassword = String(req.body?.currentPassword || '');
    const newPassword = String(req.body?.newPassword || '');
    if (!bcrypt.compareSync(currentPassword, store.admin.passwordHash)) {
      res.status(400).json({ error: 'Current password is incorrect.' });
      return;
    }
    if (newPassword.length < 6) {
      res.status(400).json({ error: 'New password must be at least 6 characters.' });
      return;
    }
    store.admin.passwordHash = bcrypt.hashSync(newPassword, 10);
    storage.persistNow();
    res.json({ success: true });
  });

  // =========================================================================
  // PROTECTED CRM ROUTES
  // =========================================================================
  router.use(requireAuth);

  // Overview Analytics
  router.get('/overview', (_req, res) => {
    const store = storage.getStore();
    const sessions = Object.values(store.sessions);
    const now = Date.now();

    const activeAiChats = sessions.filter(
      (s) =>
        s.aiEnabled &&
        !s.aiPausedIndefinitely &&
        (!s.aiPausedUntil || new Date(s.aiPausedUntil).getTime() <= now)
    ).length;
    const pausedHandoverChats = sessions.length - activeAiChats;
    const unreadChats = sessions.filter((s) => s.unreadCount > 0).length;

    const aiReplies = store.messages.filter((m) => m.senderType === 'AI').length;
    const humanReplies = store.messages.filter((m) => m.senderType === 'HUMAN').length;
    const inboundMessages = store.messages.filter((m) => m.direction === 'INBOUND').length;
    const waSnap = baileysManager.getSnapshot();

    const metrics: OverviewMetrics = {
      totalChats: sessions.length,
      activeAiChats,
      pausedHandoverChats,
      unreadChats,
      totalMessages: store.messages.length,
      aiReplies,
      humanReplies,
      inboundMessages,
      whatsappOrdersCount: store.whatsappOrderIds.length,
      totalSyncedOrders: store.ordersCache.length,
      totalSyncedProducts: store.productsCache.length,
      lastSyncAt: store.lastSyncAt,
      baileysStatus: waSnap.status,
      baileysPhone: waSnap.connectedPhone,
      metaEnabled: store.settings.meta.enabled,
      aiGlobalEnabled: store.settings.ai.enabled,
      aiGlobalMode:
        store.settings.ai.mode || (store.settings.ai.enabled ? 'AUTO_ON' : 'MANUAL_ONLY'),
    };

    res.json({
      metrics,
      recentSessions: sessions
        .sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime())
        .slice(0, 6),
      recentOrders: store.ordersCache.slice(0, 6),
      recentAiLogs: store.aiLogs.slice(0, 8),
    });
  });

  // =========================================================================
  // LIVE INBOX & CHATS
  // =========================================================================
  router.get('/chats', (_req, res) => {
    const sessions = Object.values(storage.getStore().sessions).sort(
      (a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime()
    );
    res.json({ sessions });
  });

  router.get('/chats/:phone/messages', (req, res) => {
    const phone = storage.normalizePhone(String(req.params.phone || ''));
    const session = storage.getStore().sessions[phone] || null;
    if (session && session.unreadCount > 0) {
      storage.upsertSession(phone, { unreadCount: 0 });
    }
    const messages = storage.getMessagesByPhone(phone, 150);
    res.json({ session: storage.getStore().sessions[phone] || null, messages });
  });

  router.post('/chats/start', (req, res) => {
    const rawPhone = String(req.body?.phone || '');
    const name = String(req.body?.name || '').trim();
    const digits = storage.normalizePhone(rawPhone);
    if (digits.length < 10) {
      res.status(400).json({ error: 'Enter a valid 10-digit or country-coded WhatsApp number.' });
      return;
    }
    const session = storage.upsertSession(digits, {
      name: name || `+${digits}`,
      channel: baileysManager.getSnapshot().status === 'CONNECTED' ? 'baileys' : 'meta',
    });
    messageRouter.emit('chat:session', session);
    res.json({ session });
  });

  router.post('/chats/:phone/send', async (req, res) => {
    const phone = storage.normalizePhone(String(req.params.phone || ''));
    const body = String(req.body?.body || '').trim();
    if (!phone || !body) {
      res.status(400).json({ error: 'Phone number and message body are required.' });
      return;
    }

    const result = await messageRouter.dispatchOutboundMessage({
      phone,
      body,
      senderType: 'HUMAN',
      messageType: 'text',
      pauseAiOnSend: true,
    });

    res.json(result);
  });

  router.post('/chats/:phone/send-product', async (req, res) => {
    const phone = storage.normalizePhone(String(req.params.phone || ''));
    const productId = String(req.body?.productId || '');
    const customNote = String(req.body?.note || '');
    let products = storage.getStore().productsCache;
    if (products.length === 0) {
      const fetched = await fetchLiveProducts();
      products = fetched.products;
    }
    const product = products.find((p) => p.id === productId);
    if (!product) {
      res.status(404).json({ error: 'Product not found in synced catalog.' });
      return;
    }

    const result = await messageRouter.sendProductCardToCustomer(phone, product, customNote);
    res.json(result);
  });

  router.post('/chats/:phone/toggle-ai', (req, res) => {
    const phone = storage.normalizePhone(String(req.params.phone || ''));
    const enabled = Boolean(req.body?.enabled);
    const session = storage.upsertSession(phone, {
      aiEnabled: enabled,
      aiPausedIndefinitely: !enabled,
      aiPausedUntil: null,
      handoverSource: enabled ? null : 'dashboard',
    });
    messageRouter.emit('chat:session', session);
    res.json({ session });
  });

  // =========================================================================
  // LIVE GEMINI AI TOOL-CALLING TESTER (Uses real Gemini + real BGB APIs)
  // =========================================================================
  router.post('/ai/test', async (req, res) => {
    const messageText = String(req.body?.message || '').trim();
    const phone = storage.normalizePhone(String(req.body?.phone || '919472258022'));
    const customerName = String(req.body?.customerName || 'Test Customer');
    if (!messageText) {
      res.status(400).json({ error: 'Enter a test message to send to Gemini AI.' });
      return;
    }

    try {
      const result = await generateAiReply({
        phone,
        customerName,
        messageText,
        bypassPauseCheck: true,
      });
      res.json({ success: true, ...result });
    } catch (err) {
      res.status(500).json({
        success: false,
        error: err instanceof Error ? err.message : 'Gemini AI error',
      });
    }
  });

  // =========================================================================
  // WHATSAPP CHANNELS (BAILEYS QR + 8-DIGIT PAIRING CODE + META CLOUD API)
  // =========================================================================
  router.get('/whatsapp/status', (_req, res) => {
    const snap = baileysManager.getSnapshot();
    res.json({
      ok: true,
      status: snap.status,
      qrDataUrl: snap.qrDataUrl,
      pairingCode: snap.pairingCode || null,
      connectedPhone: snap.connectedPhone,
      connectedName: snap.connectedName,
      lastError: snap.lastError || null,
      updatedAt: snap.updatedAt || new Date().toISOString(),
      baileys: snap,
      logs: storage.getStore().channelLogs.slice(0, 60),
      meta: storage.getPublicSettings().meta,
    });
  });

  router.post('/whatsapp/connect', async (req, res) => {
    const forceFresh = Boolean(req.body?.forceFresh);
    const snap = await baileysManager.connect({
      forceFresh,
      waitForQrMs: 6000,
    });
    res.json({
      ok: true,
      status: snap.status,
      qrDataUrl: snap.qrDataUrl,
      connectedPhone: snap.connectedPhone,
      connectedName: snap.connectedName,
      lastError: snap.lastError || null,
      updatedAt: snap.updatedAt || new Date().toISOString(),
      baileys: snap,
    });
  });

  router.post('/whatsapp/pairing-code', async (req, res) => {
    const phoneNumber = String(req.body?.phoneNumber || '').trim();
    if (!phoneNumber) {
      res.status(400).json({
        ok: false,
        error: 'Please enter your WhatsApp phone number with country code (e.g. 919472258022).',
      });
      return;
    }
    const result = await baileysManager.requestPairingCode(phoneNumber);
    if (!result.ok) {
      res.status(400).json({
        ...result,
        baileys: baileysManager.getSnapshot(),
      });
      return;
    }
    res.json({
      ...result,
      baileys: baileysManager.getSnapshot(),
    });
  });

  router.post('/whatsapp/disconnect', async (req, res) => {
    const logout = req.body?.logout !== false;
    const snap = await baileysManager.disconnect(logout);
    res.json({
      ok: true,
      success: true,
      status: snap.status,
      baileys: snap,
    });
  });

  router.post('/whatsapp/repair', async (_req, res) => {
    const snap = await baileysManager.repairQr();
    res.json({
      ok: true,
      success: true,
      status: snap.status,
      qrDataUrl: snap.qrDataUrl,
      baileys: snap,
    });
  });

  // =========================================================================
  // E-COMMERCE SYNC (BIHAR GRAMIN BAZAAR LIVE API)
  // =========================================================================
  router.get('/ecommerce/products', async (req, res) => {
    const refresh = req.query.refresh === '1';
    if (refresh || storage.getStore().productsCache.length === 0) {
      const result = await fetchLiveProducts();
      res.json({
        products: result.products,
        source: result.source,
        error: result.error,
        lastSyncAt: storage.getStore().lastSyncAt,
      });
      return;
    }
    res.json({
      products: storage.getStore().productsCache,
      source: 'cache',
      lastSyncAt: storage.getStore().lastSyncAt,
    });
  });

  router.get('/ecommerce/orders', async (req, res) => {
    const refresh = req.query.refresh === '1';
    if (refresh || storage.getStore().ordersCache.length === 0) {
      const result = await fetchLiveOrders();
      res.json({
        orders: result.orders,
        source: result.source,
        error: result.error,
        lastSyncAt: storage.getStore().lastSyncAt,
      });
      return;
    }
    res.json({
      orders: storage.getStore().ordersCache,
      source: 'cache',
      lastSyncAt: storage.getStore().lastSyncAt,
    });
  });

  router.post('/ecommerce/sync', async (_req, res) => {
    const summary = await syncStoreAndDetectTransitions(async (order) => {
      await messageRouter.sendOrderStageNotification(order);
    });
    messageRouter.emit('ecommerce:synced', {
      ...summary,
      lastSyncAt: storage.getStore().lastSyncAt,
    });
    res.json({
      success: true,
      ...summary,
      lastSyncAt: storage.getStore().lastSyncAt,
    });
  });

  router.post('/ecommerce/notify-order', async (req, res) => {
    const orderId = String(req.body?.orderId || '').trim();
    const order = storage.getStore().ordersCache.find((o) => o.id === orderId);
    if (!order) {
      res.status(404).json({ error: 'Order not found in synced orders.' });
      return;
    }
    const result = await messageRouter.sendOrderStageNotification(order);
    res.json({ success: true, ...result });
  });

  // =========================================================================
  // SETTINGS & AUTOMATION RULES
  // =========================================================================
  router.get('/settings', (_req, res) => {
    res.json({
      settings: storage.getPublicSettings(),
      defaultSystemPrompt: DEFAULT_SYSTEM_PROMPT,
    });
  });

  router.put('/settings', (req, res) => {
    const store = storage.getStore();
    const body = req.body || {};

    if (body.ai && typeof body.ai === 'object') {
      const validModes = ['AUTO_ON', 'OUTSIDE_BUSINESS_HOURS', 'MANUAL_ONLY'] as const;
      const incomingMode = validModes.includes(body.ai.mode)
        ? (body.ai.mode as (typeof validModes)[number])
        : body.ai.enabled === false
        ? 'MANUAL_ONLY'
        : body.ai.enabled === true && store.settings.ai.mode === 'MANUAL_ONLY'
        ? 'AUTO_ON'
        : store.settings.ai.mode || 'AUTO_ON';

      store.settings.ai = {
        ...store.settings.ai,
        mode: incomingMode,
        enabled: incomingMode !== 'MANUAL_ONLY',
        model: typeof body.ai.model === 'string' && body.ai.model.trim() ? body.ai.model.trim() : store.settings.ai.model,
        temperature:
          typeof body.ai.temperature === 'number'
            ? Math.min(1, Math.max(0, body.ai.temperature))
            : store.settings.ai.temperature,
        systemPrompt:
          typeof body.ai.systemPrompt === 'string' && body.ai.systemPrompt.trim()
            ? body.ai.systemPrompt
            : store.settings.ai.systemPrompt,
        handoverCooldownMinutes:
          typeof body.ai.handoverCooldownMinutes === 'number'
            ? Math.max(1, Math.min(1440, Math.round(body.ai.handoverCooldownMinutes)))
            : store.settings.ai.handoverCooldownMinutes,
        maxHistoryTurns:
          typeof body.ai.maxHistoryTurns === 'number'
            ? Math.max(2, Math.min(30, Math.round(body.ai.maxHistoryTurns)))
            : store.settings.ai.maxHistoryTurns,
        businessHoursOnly: incomingMode === 'OUTSIDE_BUSINESS_HOURS',
        businessHoursStart:
          typeof body.ai.businessHoursStart === 'string'
            ? body.ai.businessHoursStart
            : store.settings.ai.businessHoursStart,
        businessHoursEnd:
          typeof body.ai.businessHoursEnd === 'string'
            ? body.ai.businessHoursEnd
            : store.settings.ai.businessHoursEnd,
        afterHoursMessage:
          typeof body.ai.afterHoursMessage === 'string'
            ? body.ai.afterHoursMessage
            : store.settings.ai.afterHoursMessage,
      };
    }

    if (body.store && typeof body.store === 'object') {
      store.settings.store = {
        ...store.settings.store,
        name: typeof body.store.name === 'string' ? body.store.name : store.settings.store.name,
        hindiName:
          typeof body.store.hindiName === 'string' ? body.store.hindiName : store.settings.store.hindiName,
        websiteUrl:
          typeof body.store.websiteUrl === 'string'
            ? body.store.websiteUrl
            : store.settings.store.websiteUrl,
        apiBaseUrl:
          typeof body.store.apiBaseUrl === 'string'
            ? body.store.apiBaseUrl
            : store.settings.store.apiBaseUrl,
        supportPhone:
          typeof body.store.supportPhone === 'string'
            ? body.store.supportPhone
            : store.settings.store.supportPhone,
        autoNotifyOrderStages:
          body.store.autoNotifyOrderStages ?? store.settings.store.autoNotifyOrderStages,
        syncIntervalMinutes:
          typeof body.store.syncIntervalMinutes === 'number'
            ? Math.max(1, Math.min(60, Math.round(body.store.syncIntervalMinutes)))
            : store.settings.store.syncIntervalMinutes,
      };
    }

    if (body.meta && typeof body.meta === 'object') {
      store.settings.meta = {
        ...store.settings.meta,
        enabled: body.meta.enabled ?? store.settings.meta.enabled,
        appId: typeof body.meta.appId === 'string' ? body.meta.appId.trim() : store.settings.meta.appId,
        configId:
          typeof body.meta.configId === 'string'
            ? body.meta.configId.trim()
            : store.settings.meta.configId,
        verifyToken:
          typeof body.meta.verifyToken === 'string'
            ? body.meta.verifyToken.trim()
            : store.settings.meta.verifyToken,
        phoneNumberId:
          typeof body.meta.phoneNumberId === 'string'
            ? body.meta.phoneNumberId.trim()
            : store.settings.meta.phoneNumberId,
        wabaId:
          typeof body.meta.wabaId === 'string' ? body.meta.wabaId.trim() : store.settings.meta.wabaId,
        apiVersion:
          typeof body.meta.apiVersion === 'string'
            ? body.meta.apiVersion.trim()
            : store.settings.meta.apiVersion,
      };

      const secretPatch: { metaAppSecret?: string; metaAccessToken?: string } = {};
      if (typeof body.meta.appSecret === 'string' && body.meta.appSecret.trim()) {
        secretPatch.metaAppSecret = body.meta.appSecret.trim();
      }
      if (typeof body.meta.accessToken === 'string' && body.meta.accessToken.trim()) {
        secretPatch.metaAccessToken = body.meta.accessToken.trim();
      }
      if (Object.keys(secretPatch).length > 0) {
        saveSecrets(secretPatch);
      }
    }

    if (Array.isArray(body.keywordReplies)) {
      store.settings.keywordReplies = body.keywordReplies;
    }

    storage.persistNow();
    res.json({
      success: true,
      settings: storage.getPublicSettings(),
    });
  });

  return router;
}
