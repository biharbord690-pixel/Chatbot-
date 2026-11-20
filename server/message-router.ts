import type { proto } from '@whiskeysockets/baileys';
import type { Server as SocketIOServer } from 'socket.io';
import type { ChannelType, ChatMessage, StoreOrder, StoreProduct } from '../lib/types';
import { formatOrderStageNotification } from './ecommerce';
import { generateAiReply } from './gemini-engine';
import { storage } from './storage';
import { baileysManager } from './whatsapp-baileys';
import { sendMetaWhatsAppMessage } from './whatsapp-meta';

class MessageRouter {
  private io: SocketIOServer | null = null;

  public attachSocketServer(io: SocketIOServer): void {
    this.io = io;

    baileysManager.onStatusChange((snapshot) => {
      this.io?.emit('wa:status', snapshot);
    });

    baileysManager.onLog((entry) => {
      this.io?.emit('wa:log', entry);
    });

    baileysManager.setInboundHandler(async (event) => {
      await this.handleInboundMessage({
        channel: 'baileys',
        wamId: event.wamId,
        phone: event.phone,
        rawJid: event.rawJid,
        altJid: event.altJid,
        customerName: event.customerName,
        body: event.body,
        timestamp: event.timestamp,
      });
    });

    baileysManager.setPhoneOutgoingHandler(async (event) => {
      await this.handlePhoneOutgoingMessage({
        channel: 'baileys',
        wamId: event.wamId,
        phone: event.phone,
        remoteJid: event.remoteJid,
        altJid: event.altJid,
        body: event.body,
        timestamp: event.timestamp,
        messageKey: event.messageKey,
      });
    });
  }

  public emit(event: string, payload: unknown): void {
    this.io?.emit(event, payload);
  }

  public async handleInboundMessage(params: {
    channel: ChannelType;
    wamId: string;
    phone: string;
    rawJid?: string;
    altJid?: string;
    customerName: string;
    body: string;
    timestamp?: string;
  }): Promise<ChatMessage> {
    const phone = storage.normalizePhone(params.phone);
    const createdAt = params.timestamp || new Date().toISOString();

    if (storage.hasMessageWithWamId(params.wamId)) {
      const existing = storage.getStore().messages.find((m) => m.wamId === params.wamId);
      if (existing) return existing;
    }

    const session = storage.upsertSession(phone, {
      name: params.customerName,
      channel: params.channel,
      ...(params.rawJid ? { rawJid: params.rawJid } : {}),
      ...(params.altJid ? { altJid: params.altJid } : {}),
    });

    const inboundMsg: ChatMessage = storage.addMessage({
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      wamId: params.wamId,
      phone,
      direction: 'INBOUND',
      senderType: 'CUSTOMER',
      messageType: 'text',
      body: params.body,
      channel: params.channel,
      status: 'RECEIVED',
      createdAt,
    });

    this.io?.emit('chat:message', {
      message: inboundMsg,
      session: storage.getStore().sessions[phone] || session,
    });

    // Run Gemini AI auto-reply asynchronously without blocking webhook ACK
    this.triggerAiAutoReply({
      phone,
      rawJid: params.rawJid || session.rawJid,
      altJid: params.altJid || session.altJid,
      customerName: params.customerName,
      messageText: params.body,
      preferredChannel: params.channel,
    }).catch((err) => {
      const fullErr =
        err instanceof Error ? err.message : typeof err === 'string' ? err : JSON.stringify(err);
      const logEntry = storage.addChannelLog(
        params.channel,
        'error',
        `AI auto-reply error for +${phone}: ${fullErr}`
      );
      this.io?.emit('wa:log', logEntry);
    });

    return inboundMsg;
  }

  /**
   * Smart Human + AI Hybrid Handover:
   * Handles outgoing messages detected via Baileys `fromMe` or Meta `is_echo`
   * that were NOT sent by our bot/server (i.e., sent manually from the owner's phone).
   */
  public async handlePhoneOutgoingMessage(params: {
    channel: ChannelType;
    wamId: string;
    phone: string;
    body: string;
    timestamp?: string;
    remoteJid?: string;
    altJid?: string;
    messageKey?: proto.IMessageKey;
  }): Promise<void> {
    if (storage.isBotSentMessageId(params.wamId) || storage.hasMessageWithWamId(params.wamId)) {
      return;
    }

    const phone = storage.normalizePhone(params.phone);
    const createdAt = params.timestamp || new Date().toISOString();
    const trimmed = params.body.trim();
    const cmd = trimmed.toLowerCase();

    // 1. Phone Remote Control Commands: #manual / #stop -> Pause AI indefinitely
    if (cmd === '#manual' || cmd === '#stop') {
      if (params.channel === 'baileys' && params.remoteJid && params.messageKey) {
        await baileysManager.deleteMessageForEveryone(params.remoteJid, params.messageKey);
      }

      const updatedSession = storage.upsertSession(phone, {
        channel: params.channel,
        aiEnabled: false,
        aiPausedIndefinitely: true,
        aiPausedUntil: null,
        handoverSource: 'command',
      });

      const sysMsg = storage.addMessage({
        id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        wamId: `cmd-${params.wamId}`,
        phone,
        direction: 'OUTBOUND',
        senderType: 'SYSTEM',
        origin: 'phone',
        messageType: 'text',
        body: `Phone command ${cmd} detected — AI paused indefinitely for this chat until resumed.`,
        channel: params.channel,
        status: 'SENT',
        createdAt,
      });

      const logEntry = storage.addChannelLog(
        params.channel,
        'warn',
        `Phone command ${cmd} on +${phone}: AI paused indefinitely.`
      );
      this.io?.emit('wa:log', logEntry);
      this.io?.emit('chat:session', updatedSession);
      this.io?.emit('chat:message', { message: sysMsg, session: updatedSession });
      return;
    }

    // 2. Phone Remote Control Commands: #ai / #start -> Immediately resume AI
    if (cmd === '#ai' || cmd === '#start') {
      if (params.channel === 'baileys' && params.remoteJid && params.messageKey) {
        await baileysManager.deleteMessageForEveryone(params.remoteJid, params.messageKey);
      }

      const updatedSession = storage.upsertSession(phone, {
        channel: params.channel,
        aiEnabled: true,
        aiPausedIndefinitely: false,
        aiPausedUntil: null,
        handoverSource: null,
      });

      const sysMsg = storage.addMessage({
        id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        wamId: `cmd-${params.wamId}`,
        phone,
        direction: 'OUTBOUND',
        senderType: 'SYSTEM',
        origin: 'phone',
        messageType: 'text',
        body: `Phone command ${cmd} detected — Gemini AI resumed and active for this chat.`,
        channel: params.channel,
        status: 'SENT',
        createdAt,
      });

      const logEntry = storage.addChannelLog(
        params.channel,
        'success',
        `Phone command ${cmd} on +${phone}: Gemini AI resumed.`
      );
      this.io?.emit('wa:log', logEntry);
      this.io?.emit('chat:session', updatedSession);
      this.io?.emit('chat:message', { message: sysMsg, session: updatedSession });
      return;
    }

    // 3. Regular manual phone reply -> DO NOT trigger AI; auto-pause AI for configured cooldown (default 30 mins)
    const cooldownMins = Math.max(1, storage.getStore().settings.ai.handoverCooldownMinutes || 30);
    const pausedUntil = new Date(Date.now() + cooldownMins * 60 * 1000).toISOString();

    storage.upsertSession(phone, {
      channel: params.channel,
      ...(params.remoteJid ? { rawJid: params.remoteJid } : {}),
      ...(params.altJid ? { altJid: params.altJid } : {}),
      aiPausedUntil: pausedUntil,
      aiPausedIndefinitely: false,
      handoverSource: 'phone',
      unreadCount: 0,
    });

    const savedMsg = storage.addMessage({
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      wamId: params.wamId,
      phone,
      direction: 'OUTBOUND',
      senderType: 'HUMAN',
      origin: 'phone',
      messageType: 'text',
      body: trimmed,
      channel: params.channel,
      status: 'SENT',
      createdAt,
    });

    const latestSession = storage.getStore().sessions[phone];
    const logEntry = storage.addChannelLog(
      params.channel,
      'info',
      `Manual phone reply detected on +${phone} — AI auto-paused for ${cooldownMins} min.`
    );
    this.io?.emit('wa:log', logEntry);
    this.io?.emit('chat:session', latestSession);
    this.io?.emit('chat:message', { message: savedMsg, session: latestSession });
  }

  private async triggerAiAutoReply(params: {
    phone: string;
    rawJid?: string;
    altJid?: string;
    customerName: string;
    messageText: string;
    preferredChannel: ChannelType;
  }): Promise<void> {
    const aiResult = await generateAiReply({
      phone: params.phone,
      customerName: params.customerName,
      messageText: params.messageText,
    });

    if (aiResult.skipped || !aiResult.reply) {
      if (aiResult.skipReason) {
        const logEntry = storage.addChannelLog(
          params.preferredChannel,
          'info',
          `AI skipped reply for +${params.phone}: ${aiResult.skipReason}`
        );
        this.io?.emit('wa:log', logEntry);
      }
      return;
    }

    if (aiResult.fallbackUsed && aiResult.errorDetail) {
      const warnLog = storage.addChannelLog(
        params.preferredChannel,
        'warn',
        `Gemini error for +${params.phone} (sent Hindi fallback): ${aiResult.errorDetail}`
      );
      this.io?.emit('wa:log', warnLog);
    }

    const dispatched = await this.dispatchOutboundMessage({
      phone: params.phone,
      targetJid: params.rawJid,
      altJid: params.altJid,
      body: aiResult.reply,
      senderType: 'AI',
      messageType: aiResult.matchedProductCard ? 'product_card' : 'text',
      preferredChannel: params.preferredChannel,
      imageUrl: aiResult.matchedProductCard?.image,
      productCard: aiResult.matchedProductCard,
      toolCalls: aiResult.toolCalls,
      pauseAiOnSend: false,
    });

    const deliveryLog = storage.addChannelLog(
      params.preferredChannel,
      dispatched.deliveredVia === 'local_only' ? 'error' : 'success',
      dispatched.deliveredVia === 'local_only'
        ? `AI reply generated for +${params.phone} but delivery failed: ${dispatched.deliveryError || 'channel offline'}`
        : `AI reply delivered to +${params.phone}${params.rawJid ? ` (${params.rawJid})` : ''} via ${dispatched.deliveredVia}`
    );
    this.io?.emit('wa:log', deliveryLog);
  }

  public async dispatchOutboundMessage(params: {
    phone: string;
    targetJid?: string;
    altJid?: string;
    body: string;
    senderType: 'AI' | 'HUMAN' | 'SYSTEM';
    messageType?: 'text' | 'product_card' | 'order_update';
    preferredChannel?: ChannelType;
    imageUrl?: string;
    productCard?: ChatMessage['productCard'];
    toolCalls?: ChatMessage['toolCalls'];
    pauseAiOnSend?: boolean;
  }): Promise<{
    message: ChatMessage;
    deliveredVia: ChannelType | 'local_only';
    deliveryError?: string;
  }> {
    const phone = storage.normalizePhone(params.phone);
    const store = storage.getStore();
    const existingSession = store.sessions[phone];
    const preferred = params.preferredChannel || existingSession?.channel || 'baileys';

    let deliveredVia: ChannelType | 'local_only' = 'local_only';
    let wamId = `out-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    let deliveryError: string | undefined;

    const tryBaileys = async () => {
      const res = await baileysManager.sendMessage({
        phone,
        targetJid: params.targetJid || existingSession?.rawJid,
        altJid: params.altJid || existingSession?.altJid,
        body: params.body,
        imageUrl: params.imageUrl,
      });
      if (res.success && res.wamId) {
        deliveredVia = 'baileys';
        wamId = res.wamId;
        return true;
      }
      deliveryError = res.error;
      return false;
    };

    const tryMeta = async () => {
      if (!store.settings.meta.enabled) return false;
      const res = await sendMetaWhatsAppMessage({
        phone,
        body: params.body,
        imageUrl: params.imageUrl,
      });
      if (res.success && res.wamId) {
        deliveredVia = 'meta';
        wamId = res.wamId;
        return true;
      }
      deliveryError = res.error;
      return false;
    };

    if (preferred === 'meta') {
      const ok = await tryMeta();
      if (!ok && baileysManager.getSnapshot().status === 'CONNECTED') {
        await tryBaileys();
      }
    } else {
      const ok = await tryBaileys();
      if (!ok && store.settings.meta.enabled) {
        await tryMeta();
      }
    }

    // Human Handover: pause AI automatically for configured cooldown whenever admin replies manually in Dashboard
    if (params.pauseAiOnSend && params.senderType === 'HUMAN') {
      const cooldownMins = Math.max(1, store.settings.ai.handoverCooldownMinutes || 30);
      const pausedUntil = new Date(Date.now() + cooldownMins * 60 * 1000).toISOString();
      storage.upsertSession(phone, {
        aiPausedUntil: pausedUntil,
        aiPausedIndefinitely: false,
        handoverSource: 'dashboard',
        unreadCount: 0,
      });
    }

    storage.recordBotSentMessageId(wamId);

    const savedMessage = storage.addMessage({
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      wamId,
      phone,
      direction: 'OUTBOUND',
      senderType: params.senderType,
      origin:
        params.senderType === 'AI'
          ? 'ai'
          : params.senderType === 'HUMAN'
          ? 'dashboard'
          : 'system',
      messageType: params.messageType || 'text',
      body: params.body,
      channel: deliveredVia === 'local_only' ? preferred : deliveredVia,
      mediaUrl: params.imageUrl,
      productCard: params.productCard,
      toolCalls: params.toolCalls,
      status: deliveredVia === 'local_only' ? 'FAILED' : 'SENT',
      createdAt: new Date().toISOString(),
    });

    const updatedSession = storage.getStore().sessions[phone];
    this.io?.emit('chat:message', {
      message: savedMessage,
      session: updatedSession,
    });

    return {
      message: savedMessage,
      deliveredVia,
      deliveryError: deliveredVia === 'local_only' ? deliveryError : undefined,
    };
  }

  public async sendProductCardToCustomer(
    phone: string,
    product: StoreProduct,
    customNote?: string
  ) {
    const storeUrl = storage.getStore().settings.store.websiteUrl.replace(/\/$/, '');
    const productUrl = product.slug ? `${storeUrl}/product/${product.slug}` : storeUrl;
    const discountLine =
      product.discountPercent > 0
        ? ` (~₹${product.originalPrice}~ · *${product.discountPercent}% छूट*)`
        : '';

    const caption = [
      customNote?.trim() ? `${customNote.trim()}\n` : '',
      `*${product.name}*`,
      product.hindiName && product.hindiName !== product.name ? product.hindiName : '',
      `• *कीमत:* ₹${product.price}${discountLine}`,
      `• *स्टॉक:* ${product.inStock ? `उपलब्ध (${product.stockCount})` : 'अभी आउट ऑफ स्टॉक'}`,
      `• *डिलीवरी:* बिहार के सभी 38 ज़िलों में COD उपलब्ध (₹499+ पर फ्री डिलीवरी)`,
      `• *लिंक:* ${productUrl}`,
      `\nऑर्डर करने के लिए बस "हाँ ऑर्डर करना है" लिखकर भेजें!`,
    ]
      .filter(Boolean)
      .join('\n');

    return this.dispatchOutboundMessage({
      phone,
      body: caption,
      senderType: 'HUMAN',
      messageType: 'product_card',
      imageUrl: product.image || undefined,
      productCard: {
        id: product.id,
        name: product.name,
        hindiName: product.hindiName,
        price: product.price,
        originalPrice: product.originalPrice,
        image: product.image,
        inStock: product.inStock,
        url: productUrl,
      },
      pauseAiOnSend: false,
    });
  }

  public async sendOrderStageNotification(order: StoreOrder) {
    const body = formatOrderStageNotification(order);
    const res = await this.dispatchOutboundMessage({
      phone: order.phone,
      body,
      senderType: 'SYSTEM',
      messageType: 'order_update',
      pauseAiOnSend: false,
    });
    const logEntry = storage.addChannelLog(
      'system',
      res.deliveredVia === 'local_only' ? 'warn' : 'success',
      `Order ${order.id} (${order.deliveryStage}) notification for ${order.customerName}: ${
        res.deliveredVia === 'local_only'
          ? `logged in inbox (${res.deliveryError || 'no active channel'})`
          : `sent via ${res.deliveredVia}`
      }`
    );
    this.io?.emit('wa:log', logEntry);
    return res;
  }
}

export const messageRouter = new MessageRouter();
