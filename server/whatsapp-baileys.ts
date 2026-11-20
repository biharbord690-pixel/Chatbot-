import fs from 'fs';
import path from 'path';
import type { Boom } from '@hapi/boom';
import type { WAMessage, WASocket, proto } from '@whiskeysockets/baileys';
import pino from 'pino';
import QRCode from 'qrcode';
import type {
  BaileysConnectionStatus,
  BaileysStateSnapshot,
  ChatMessage,
  InboundMediaAttachment,
} from '../lib/types';
import { flushRemoteBackupNow, scheduleRemoteBackup } from './remote-backup';
import { BAILEYS_AUTH_DIR, MEDIA_DIR, storage } from './storage';

type BaileysModule = typeof import('@whiskeysockets/baileys');

let baileysModulePromise: Promise<BaileysModule> | null = null;
function loadBaileysModule(): Promise<BaileysModule> {
  if (!baileysModulePromise) {
    // Native ESM dynamic import ensures ESM-only sub-dependencies (whatsapp-rust-bridge) resolve cleanly
    baileysModulePromise = Function(
      'return import("@whiskeysockets/baileys")'
    )() as Promise<BaileysModule>;
  }
  return baileysModulePromise;
}

export interface BaileysInboundEvent {
  wamId: string;
  phone: string;
  rawJid: string;
  altJid?: string;
  customerName: string;
  body: string;
  messageType?: 'text' | 'image' | 'audio';
  media?: InboundMediaAttachment;
  timestamp: string;
}

export interface BaileysPhoneOutgoingEvent {
  wamId: string;
  phone: string;
  remoteJid: string;
  altJid?: string;
  body: string;
  timestamp: string;
  messageKey: proto.IMessageKey;
}

type StatusListener = (snapshot: BaileysStateSnapshot) => void;
type LogListener = (entry: ReturnType<typeof storage.addChannelLog>) => void;
type InboundListener = (event: BaileysInboundEvent) => Promise<void>;
type PhoneOutgoingListener = (event: BaileysPhoneOutgoingEvent) => Promise<void>;
type HistorySyncListener = (summary: { chatsImported: number; messagesImported: number }) => void;

class BaileysManager {
  private sock: WASocket | null = null;
  private status: BaileysConnectionStatus = 'DISCONNECTED';
  private qrDataUrl: string | null = null;
  private pairingCode: string | null = null;
  private connectedPhone: string | null = null;
  private connectedName: string | null = null;
  private lastConnectedAt: string | null = null;
  private lastError: string | null = null;
  private updatedAt: string = new Date().toISOString();
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private isConnecting = false;
  private intentionalDisconnect = false;
  private pairingModeActive = false;
  private cachedVersion: [number, number, number] | undefined;
  private seenWamIds: Set<string> = new Set();
  private contactNames: Map<string, string> = new Map();
  private lidToPhone: Map<string, string> = new Map();
  private avatarCache: Map<
    string,
    { buffer: Buffer | null; mimeType: string; fetchedAt: number }
  > = new Map();
  private avatarInFlight: Map<
    string,
    Promise<{ buffer: Buffer; mimeType: string } | null>
  > = new Map();

  private statusListeners: Set<StatusListener> = new Set();
  private logListeners: Set<LogListener> = new Set();
  private inboundListener: InboundListener | null = null;
  private phoneOutgoingListener: PhoneOutgoingListener | null = null;
  private historySyncListener: HistorySyncListener | null = null;

  public onStatusChange(fn: StatusListener): () => void {
    this.statusListeners.add(fn);
    return () => this.statusListeners.delete(fn);
  }

  public onLog(fn: LogListener): () => void {
    this.logListeners.add(fn);
    return () => this.logListeners.delete(fn);
  }

  public setInboundHandler(fn: InboundListener): void {
    this.inboundListener = fn;
  }

  public setPhoneOutgoingHandler(fn: PhoneOutgoingListener): void {
    this.phoneOutgoingListener = fn;
  }

  public setHistorySyncHandler(fn: HistorySyncListener): void {
    this.historySyncListener = fn;
  }

  public getSnapshot(): BaileysStateSnapshot {
    return {
      status: this.status,
      qrDataUrl: this.qrDataUrl,
      pairingCode: this.pairingCode,
      connectedPhone: this.connectedPhone,
      connectedName: this.connectedName,
      lastConnectedAt: this.lastConnectedAt,
      lastError: this.lastError,
      updatedAt: this.updatedAt,
      reconnectAttempts: this.reconnectAttempts,
    };
  }

  public hasSavedCredentials(): boolean {
    const credsPath = path.join(BAILEYS_AUTH_DIR, 'creds.json');
    return fs.existsSync(credsPath);
  }

  private emitStatus(): void {
    this.updatedAt = new Date().toISOString();
    const snap = this.getSnapshot();
    for (const listener of this.statusListeners) {
      try {
        listener(snap);
      } catch {
        // ignore listener errors
      }
    }
  }

  private log(level: 'info' | 'warn' | 'error' | 'success', message: string): void {
    const entry = storage.addChannelLog('baileys', level, message);
    for (const listener of this.logListeners) {
      try {
        listener(entry);
      } catch {
        // ignore
      }
    }
  }

  private waitForCondition(check: () => boolean, timeoutMs: number): Promise<boolean> {
    if (check()) return Promise.resolve(true);
    return new Promise((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          unsub();
          resolve(check());
        }
      }, timeoutMs);

      const unsub = this.onStatusChange(() => {
        if (!settled && check()) {
          settled = true;
          clearTimeout(timer);
          unsub();
          resolve(true);
        }
      });
    });
  }

  public async connect(options?: {
    forceFresh?: boolean;
    forPairingCode?: boolean;
    waitForQrMs?: number;
  }): Promise<BaileysStateSnapshot> {
    if (options?.forceFresh) {
      await this.disconnect(true);
    }

    if (this.status === 'CONNECTED' && !options?.forceFresh) {
      return this.getSnapshot();
    }

    if (this.isConnecting) {
      if (options?.waitForQrMs) {
        await this.waitForCondition(
          () => Boolean(this.qrDataUrl) || this.status === 'CONNECTED' || Boolean(this.lastError),
          options.waitForQrMs
        );
      }
      return this.getSnapshot();
    }

    // If an old non-connected socket exists, close it cleanly before starting a fresh one
    if (this.sock && this.status !== 'CONNECTED') {
      try {
        this.sock.end(new Error('Restarting WhatsApp socket'));
      } catch {
        // ignore
      }
      this.sock = null;
    }

    this.isConnecting = true;
    this.intentionalDisconnect = false;
    this.pairingModeActive = Boolean(options?.forPairingCode);
    this.lastError = null;
    if (!this.pairingModeActive) {
      this.pairingCode = null;
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.status = 'CONNECTING';
    this.qrDataUrl = null;
    this.emitStatus();
    this.log(
      'info',
      this.pairingModeActive
        ? 'Starting Baileys socket for 8-digit phone pairing code...'
        : 'Initializing Baileys WhatsApp WebSocket session...'
    );

    try {
      if (!fs.existsSync(BAILEYS_AUTH_DIR)) {
        fs.mkdirSync(BAILEYS_AUTH_DIR, { recursive: true });
      }

      const baileys = await loadBaileysModule();
      const makeWASocket = baileys.default;
      const {
        Browsers,
        DisconnectReason,
        fetchLatestBaileysVersion,
        useMultiFileAuthState: loadAuthState,
      } = baileys;

      const { state, saveCreds } = await loadAuthState(BAILEYS_AUTH_DIR);
      const origKeysSet = state.keys.set.bind(state.keys);
      state.keys.set = async (data) => {
        await origKeysSet(data);
        scheduleRemoteBackup('baileys_auth');
      };

      let version = this.cachedVersion;
      if (!version) {
        try {
          const latest = await fetchLatestBaileysVersion();
          version = latest.version;
          this.cachedVersion = version;
        } catch {
          // fallback to bundled WhatsApp Web version
        }
      }

      const sock = makeWASocket({
        auth: state,
        version,
        logger: pino({ level: 'silent' }),
        browser: Browsers.macOS('Chrome'),
        markOnlineOnConnect: true,
        syncFullHistory: false,
        shouldSyncHistoryMessage: () => true,
        connectTimeoutMs: 60_000,
        defaultQueryTimeoutMs: 60_000,
        keepAliveIntervalMs: 25_000,
      });

      this.sock = sock;
      this.isConnecting = false;

      sock.ev.on('creds.update', async () => {
        await saveCreds();
        scheduleRemoteBackup('baileys_auth');
      });

      sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          try {
            this.qrDataUrl = await QRCode.toDataURL(qr, {
              width: 320,
              margin: 2,
              color: {
                dark: '#0F172A',
                light: '#FFFFFF',
              },
            });
            this.status = 'QR_READY';
            this.lastError = null;
            this.emitStatus();
            if (!this.pairingModeActive) {
              this.log('info', 'Live QR code ready. Scan from WhatsApp -> Linked Devices.');
            }
          } catch (err) {
            this.lastError =
              err instanceof Error ? err.message : 'Failed to render QR code image';
            this.emitStatus();
            this.log('error', `Failed to encode QR image: ${this.lastError}`);
          }
        }

        if (connection === 'open') {
          this.status = 'CONNECTED';
          this.qrDataUrl = null;
          this.pairingCode = null;
          this.pairingModeActive = false;
          this.lastError = null;
          this.reconnectAttempts = 0;
          this.lastConnectedAt = new Date().toISOString();
          const rawId = sock.user?.id || '';
          const phoneDigits = rawId.split(':')[0].split('@')[0].replace(/[^0-9]/g, '');
          this.connectedPhone = phoneDigits || null;
          this.connectedName = sock.user?.name || 'WhatsApp Business';
          this.emitStatus();
          this.log(
            'success',
            `Connected to WhatsApp as ${this.connectedName}${this.connectedPhone ? ` (+${this.connectedPhone})` : ''}.`
          );
          this.hydrateLidMappingsFromStore();
          // Immediately back up freshly linked session to remote vault (e.g. MilesWeb)
          void flushRemoteBackupNow('whatsapp_connected');
        }

        if (connection === 'close') {
          const boomErr = lastDisconnect?.error as Boom | undefined;
          const statusCode = boomErr?.output?.statusCode;
          const errMessage = boomErr?.message || '';
          const loggedOut = statusCode === DisconnectReason.loggedOut;
          const restartRequired = statusCode === DisconnectReason.restartRequired;

          if (this.sock === sock) {
            this.sock = null;
          }
          this.qrDataUrl = null;

          if (loggedOut) {
            this.status = 'LOGGED_OUT';
            this.connectedPhone = null;
            this.connectedName = null;
            this.pairingCode = null;
            this.pairingModeActive = false;
            this.lastError = 'Device logged out from WhatsApp. Generate a fresh QR to re-link.';
            this.clearAuthFolder();
            this.emitStatus();
            this.log(
              'warn',
              'WhatsApp device was logged out. Auth session wiped; ready for fresh QR.'
            );
            return;
          }

          if (this.intentionalDisconnect) {
            this.status = 'DISCONNECTED';
            this.connectedPhone = null;
            this.connectedName = null;
            this.pairingCode = null;
            this.pairingModeActive = false;
            this.emitStatus();
            this.log('info', 'Disconnected from WhatsApp by admin.');
            return;
          }

          // WhatsApp sends 515 (restartRequired) immediately after QR/8-digit pairing succeeds.
          // Reconnect immediately (250ms) so mobile WhatsApp never times out during handshake!
          if (restartRequired) {
            this.status = 'CONNECTING';
            this.lastError = null;
            this.emitStatus();
            this.log('info', 'WhatsApp requested fast handshake restart (515) — reconnecting immediately...');
            this.reconnectTimer = setTimeout(() => {
              this.connect().catch(() => {});
            }, 250);
            return;
          }

          this.status = 'DISCONNECTED';
          this.lastError = errMessage
            ? `Connection closed (${statusCode ?? 'socket'}): ${errMessage}`
            : `Connection closed (code ${statusCode ?? 'unknown'})`;
          this.emitStatus();

          if (this.reconnectAttempts < 6) {
            this.reconnectAttempts += 1;
            const delayMs = Math.min(20000, this.reconnectAttempts * 3000);
            this.log(
              'warn',
              `Connection closed (code ${statusCode ?? 'unknown'}). Auto-reconnecting in ${Math.round(delayMs / 1000)}s (attempt ${this.reconnectAttempts}/6)...`
            );
            this.reconnectTimer = setTimeout(() => {
              this.connect().catch(() => {});
            }, delayMs);
          } else {
            this.log('error', 'Max reconnect attempts reached. Click Generate / Refresh QR.');
          }
        }
      });

      // Sync all connected WhatsApp contacts, chats & recent message history into the CRM Inbox (NEVER triggers AI)
      sock.ev.on('contacts.upsert', (contacts) => {
        this.importContactsBatch(contacts);
      });

      sock.ev.on('contacts.update', (contacts) => {
        this.importContactsBatch(contacts);
      });

      sock.ev.on('chats.upsert', (chats) => {
        this.importChatsBatch(chats);
      });

      sock.ev.on('chats.update', (chats) => {
        this.importChatsBatch(chats);
      });

      sock.ev.on('messaging-history.set', (history) => {
        try {
          if (history.contacts && history.contacts.length > 0) {
            this.importContactsBatch(history.contacts);
          }
          const chatItems = (history.chats || [])
            .map((c) => this.mapChatRecord(c))
            .filter((x): x is NonNullable<typeof x> => Boolean(x));
          const msgItems = (history.messages || [])
            .map((m) => this.mapHistoricalMessage(m))
            .filter((x): x is ChatMessage => Boolean(x));

          const summary = storage.importWhatsAppHistory({
            chats: chatItems,
            messages: msgItems,
          });
          if (summary.chatsImported > 0 || summary.messagesImported > 0) {
            this.log(
              'success',
              `Synced connected WhatsApp chats into Live Inbox: ${summary.chatsImported} chats, ${summary.messagesImported} messages.`
            );
            this.historySyncListener?.(summary);
          }
        } catch {
          // keep history sync resilient
        }
      });

      sock.ev.on('messages.upsert', (event) => {
        if (event.type === 'append') {
          // Historical/synced messages pushed by WhatsApp -> display in CRM Inbox silently (NEVER trigger AI)
          const historical = event.messages
            .map((m) => this.mapHistoricalMessage(m))
            .filter((x): x is ChatMessage => Boolean(x));
          if (historical.length > 0) {
            const summary = storage.importWhatsAppHistory({ messages: historical });
            if (summary.chatsImported > 0 || summary.messagesImported > 0) {
              this.historySyncListener?.(summary);
            }
          }
          return;
        }
        if (event.type !== 'notify') return;
        // Process real-time incoming messages from multiple numbers concurrently (never block Phone B behind Phone A)
        void Promise.allSettled(
          event.messages.map((msg) => this.handleIncomingMessage(msg))
        );
      });

      if (options?.waitForQrMs) {
        await this.waitForCondition(
          () => Boolean(this.qrDataUrl) || this.status === 'CONNECTED' || Boolean(this.lastError),
          options.waitForQrMs
        );
      }

      return this.getSnapshot();
    } catch (err) {
      this.isConnecting = false;
      this.status = 'DISCONNECTED';
      this.lastError = err instanceof Error ? err.message : 'Failed to start Baileys socket';
      this.emitStatus();
      this.log('error', `Failed to start Baileys socket: ${this.lastError}`);
      return this.getSnapshot();
    }
  }

  public async requestPairingCode(rawPhone: string): Promise<{
    ok: boolean;
    pairingCode?: string;
    formattedCode?: string;
    phoneNumber?: string;
    status: BaileysConnectionStatus;
    error?: string;
  }> {
    let digits = rawPhone.replace(/[^0-9]/g, '');
    if (digits.length === 10) {
      digits = `91${digits}`;
    }
    if (digits.length < 10 || digits.length > 15) {
      return {
        ok: false,
        status: this.status,
        error: 'Enter a valid WhatsApp phone number with country code (e.g., 919472258022).',
      };
    }

    try {
      // Pairing code requires a clean unregistered auth state
      await this.disconnect(true);
      await this.connect({ forPairingCode: true });

      // Wait briefly for Baileys WebSocket handshake / QR readiness before requesting pairing code
      await this.waitForCondition(
        () => Boolean(this.sock) && (this.status === 'QR_READY' || Boolean(this.lastError)),
        8000
      );

      if (!this.sock) {
        return {
          ok: false,
          status: this.status,
          error: this.lastError || 'WhatsApp socket failed to initialize. Please try again.',
        };
      }

      const rawCode = await this.sock.requestPairingCode(digits);
      const cleanCode = String(rawCode || '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
      const formattedCode =
        cleanCode.length === 8
          ? `${cleanCode.slice(0, 4)}-${cleanCode.slice(4)}`
          : cleanCode;

      this.pairingCode = formattedCode;
      this.status = 'QR_READY';
      this.lastError = null;
      this.emitStatus();
      this.log(
        'success',
        `8-digit WhatsApp linking code generated for +${digits}: ${formattedCode}`
      );

      return {
        ok: true,
        pairingCode: cleanCode,
        formattedCode,
        phoneNumber: digits,
        status: this.status,
      };
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Unable to request 8-digit pairing code from WhatsApp';
      this.lastError = msg;
      this.emitStatus();
      this.log('error', `Pairing code error for +${digits}: ${msg}`);
      return {
        ok: false,
        status: this.status,
        error: msg,
      };
    }
  }

  private unwrapMessage(
    message: proto.IMessage | null | undefined
  ): proto.IMessage | null | undefined {
    let cur = message;
    for (let depth = 0; depth < 4 && cur; depth += 1) {
      if (cur.ephemeralMessage?.message) {
        cur = cur.ephemeralMessage.message;
      } else if (cur.viewOnceMessage?.message) {
        cur = cur.viewOnceMessage.message;
      } else if (cur.viewOnceMessageV2?.message) {
        cur = cur.viewOnceMessageV2.message;
      } else if (cur.viewOnceMessageV2Extension?.message) {
        cur = cur.viewOnceMessageV2Extension.message;
      } else if (cur.documentWithCaptionMessage?.message) {
        cur = cur.documentWithCaptionMessage.message;
      } else {
        break;
      }
    }
    return cur;
  }

  private extractMessageContent(message: proto.IMessage | null | undefined): {
    body: string;
    mediaKind?: 'image' | 'audio';
    mimeType?: string;
  } {
    const unwrapped = this.unwrapMessage(message);
    if (!unwrapped) return { body: '' };

    if (unwrapped.conversation) return { body: unwrapped.conversation.trim() };
    if (unwrapped.extendedTextMessage?.text) {
      return { body: unwrapped.extendedTextMessage.text.trim() };
    }
    if (unwrapped.imageMessage) {
      const caption = (unwrapped.imageMessage.caption || '').trim();
      const mimeType = (unwrapped.imageMessage.mimetype || 'image/jpeg').split(';')[0].trim();
      return {
        body: caption || '[Photo bheja gaya]',
        mediaKind: 'image',
        mimeType,
      };
    }
    if (unwrapped.audioMessage) {
      const mimeType = (unwrapped.audioMessage.mimetype || 'audio/ogg').split(';')[0].trim();
      return {
        body: '[Voice message bheja gaya]',
        mediaKind: 'audio',
        mimeType,
      };
    }
    if (unwrapped.videoMessage) {
      const caption = (unwrapped.videoMessage.caption || '').trim();
      return { body: caption ? `[Video] ${caption}` : '[Video bheja gaya]' };
    }
    if (unwrapped.documentMessage) {
      const title = unwrapped.documentMessage.caption || unwrapped.documentMessage.fileName || 'Document';
      return { body: `[Document] ${title}` };
    }
    if (unwrapped.buttonsResponseMessage?.selectedDisplayText) {
      return { body: unwrapped.buttonsResponseMessage.selectedDisplayText.trim() };
    }
    if (unwrapped.listResponseMessage?.title) {
      return { body: unwrapped.listResponseMessage.title.trim() };
    }
    return { body: '' };
  }

  private parseMessageTimestampSec(rawTs: unknown): number {
    const parsedTs =
      typeof rawTs === 'number'
        ? rawTs
        : typeof rawTs === 'object' &&
          rawTs !== null &&
          'toNumber' in rawTs &&
          typeof (rawTs as { toNumber: () => number }).toNumber === 'function'
        ? (rawTs as { toNumber: () => number }).toNumber()
        : Number(rawTs);
    return Number.isFinite(parsedTs) && parsedTs > 0 ? parsedTs : Math.floor(Date.now() / 1000);
  }

  private hydrateLidMappingsFromStore(): void {
    const sessions = Object.values(storage.getStore().sessions);
    let mergedAny = false;
    for (const s of sessions) {
      const raw = s.rawJid || '';
      const alt = s.altJid || '';
      if (raw.endsWith('@lid') && alt.endsWith('@s.whatsapp.net')) {
        const lidDigits = raw.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
        const pnDigits = storage.normalizePhone(alt.split('@')[0].split(':')[0]);
        if (lidDigits && pnDigits && lidDigits !== pnDigits) {
          this.lidToPhone.set(lidDigits, pnDigits);
          if (storage.mergeLidSessionIntoPhone(lidDigits, pnDigits)) {
            mergedAny = true;
          }
        }
      } else if (alt.endsWith('@lid') && raw.endsWith('@s.whatsapp.net')) {
        const lidDigits = alt.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
        const pnDigits = storage.normalizePhone(raw.split('@')[0].split(':')[0]);
        if (lidDigits && pnDigits && lidDigits !== pnDigits) {
          this.lidToPhone.set(lidDigits, pnDigits);
          if (storage.mergeLidSessionIntoPhone(lidDigits, pnDigits)) {
            mergedAny = true;
          }
        }
      }
    }
    if (mergedAny) {
      this.historySyncListener?.({ chatsImported: 1, messagesImported: 0 });
    }
  }

  private rememberLidPair(jidA?: string | null, jidB?: string | null): void {
    const a = jidA || '';
    const b = jidB || '';
    const extract = (j: string) => j.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');

    let lidDigits = '';
    let pnDigits = '';
    if (a.endsWith('@lid') && b.endsWith('@s.whatsapp.net')) {
      lidDigits = extract(a);
      pnDigits = storage.normalizePhone(extract(b));
    } else if (b.endsWith('@lid') && a.endsWith('@s.whatsapp.net')) {
      lidDigits = extract(b);
      pnDigits = storage.normalizePhone(extract(a));
    } else if (a.endsWith('@lid') && b && !b.includes('@')) {
      lidDigits = extract(a);
      pnDigits = storage.normalizePhone(b);
    }

    if (lidDigits && pnDigits && lidDigits !== pnDigits && pnDigits.length >= 10) {
      this.lidToPhone.set(lidDigits, pnDigits);
      storage.mergeLidSessionIntoPhone(lidDigits, pnDigits);
    }
  }

  private resolveJidToPhone(
    rawJid: string | undefined | null,
    altJid?: string | undefined | null
  ): { rawJid: string; altJid?: string; phone: string } | null {
    const cleanRaw = rawJid || '';
    if (
      !cleanRaw ||
      cleanRaw === 'status@broadcast' ||
      cleanRaw.endsWith('@g.us') ||
      cleanRaw.endsWith('@broadcast') ||
      cleanRaw.endsWith('@newsletter')
    ) {
      return null;
    }

    const cleanAlt = altJid && altJid.includes('@') ? altJid : undefined;
    this.rememberLidPair(cleanRaw, cleanAlt || altJid);

    const extractDigits = (jid: string) =>
      jid.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');

    let phone = '';
    let resolvedAlt = cleanAlt;

    if (cleanRaw.endsWith('@s.whatsapp.net')) {
      const digits = extractDigits(cleanRaw);
      if (digits.length >= 8) {
        phone = storage.normalizePhone(digits);
      }
    } else if (cleanAlt && cleanAlt.endsWith('@s.whatsapp.net')) {
      const altDigits = extractDigits(cleanAlt);
      if (altDigits.length >= 8) {
        phone = storage.normalizePhone(altDigits);
      }
    } else if (cleanRaw.endsWith('@lid')) {
      const lidDigits = extractDigits(cleanRaw);
      const mapped = this.lidToPhone.get(lidDigits);
      if (mapped) {
        phone = mapped;
        if (!resolvedAlt) resolvedAlt = `${mapped}@s.whatsapp.net`;
      }
    }

    if (!phone) {
      const rawDigits = extractDigits(cleanRaw);
      if (rawDigits.length < 8) return null;
      phone = cleanRaw.endsWith('@lid') ? rawDigits : storage.normalizePhone(rawDigits);
    }

    return { rawJid: cleanRaw, altJid: resolvedAlt, phone };
  }

  private importContactsBatch(
    contacts: Array<{
      id?: string;
      lid?: string;
      phoneNumber?: string;
      name?: string | null;
      notify?: string | null;
      verifiedName?: string | null;
    }>
  ): void {
    const mapped: Array<{ phone: string; rawJid?: string; altJid?: string; name?: string }> = [];
    for (const c of contacts) {
      const pnCandidate = c.phoneNumber
        ? c.phoneNumber.includes('@')
          ? c.phoneNumber
          : `${c.phoneNumber.replace(/[^0-9]/g, '')}@s.whatsapp.net`
        : undefined;
      if (c.lid && pnCandidate) {
        this.rememberLidPair(c.lid, pnCandidate);
      }
      if (c.id && c.lid) {
        this.rememberLidPair(c.id, c.lid);
      }
      if (c.id && pnCandidate) {
        this.rememberLidPair(c.id, pnCandidate);
      }

      const addressed = this.resolveJidToPhone(c.id || pnCandidate, pnCandidate || c.lid);
      if (!addressed) continue;
      // Prefer saved phonebook name -> verified business name -> WhatsApp push name
      const bestName = (c.name || c.verifiedName || c.notify || '').trim();
      if (bestName) {
        this.contactNames.set(addressed.phone, bestName);
        mapped.push({
          phone: addressed.phone,
          rawJid: addressed.rawJid,
          altJid: addressed.altJid,
          name: bestName,
        });
      }
    }
    if (mapped.length > 0) {
      const summary = storage.importWhatsAppHistory({ contacts: mapped });
      if (summary.chatsImported > 0) {
        this.historySyncListener?.(summary);
      }
    }
  }

  private mapChatRecord(chat: {
    id?: string | null;
    lidJid?: string | null;
    pnJid?: string | null;
    name?: string | null;
    conversationTimestamp?: unknown;
    unreadCount?: number | null;
  }): {
    phone: string;
    rawJid?: string;
    altJid?: string;
    name?: string;
    lastMessageAt?: string;
    unreadCount?: number;
  } | null {
    if (chat.id && chat.pnJid) this.rememberLidPair(chat.id, chat.pnJid);
    if (chat.lidJid && chat.pnJid) this.rememberLidPair(chat.lidJid, chat.pnJid);
    if (chat.lidJid && chat.id) this.rememberLidPair(chat.lidJid, chat.id);

    const addressed = this.resolveJidToPhone(chat.id, chat.pnJid || chat.lidJid);
    if (!addressed) return null;

    const bestName = (chat.name || this.contactNames.get(addressed.phone) || '').trim();
    if (bestName) {
      this.contactNames.set(addressed.phone, bestName);
    }
    const tsSec = chat.conversationTimestamp
      ? this.parseMessageTimestampSec(chat.conversationTimestamp)
      : 0;

    // Skip empty anonymous @lid ghost chats that have no real phone, no name, and no timestamp
    const isUnresolvedLid =
      addressed.rawJid.endsWith('@lid') &&
      !addressed.altJid?.endsWith('@s.whatsapp.net') &&
      addressed.phone.length >= 14;
    if (isUnresolvedLid && !bestName && tsSec === 0) {
      return null;
    }

    return {
      phone: addressed.phone,
      rawJid: addressed.rawJid,
      altJid: addressed.altJid,
      name: bestName || undefined,
      lastMessageAt: tsSec > 0 ? new Date(tsSec * 1000).toISOString() : undefined,
      unreadCount: typeof chat.unreadCount === 'number' && chat.unreadCount > 0 ? chat.unreadCount : 0,
    };
  }

  private importChatsBatch(
    chats: Array<{
      id?: string | null;
      lidJid?: string | null;
      pnJid?: string | null;
      name?: string | null;
      conversationTimestamp?: unknown;
      unreadCount?: number | null;
    }>
  ): void {
    const mapped = chats
      .map((c) => this.mapChatRecord(c))
      .filter((x): x is NonNullable<typeof x> => Boolean(x));
    if (mapped.length > 0) {
      const summary = storage.importWhatsAppHistory({ chats: mapped });
      if (summary.chatsImported > 0) {
        this.historySyncListener?.(summary);
      }
    }
  }

  /**
   * Fetches & caches a contact's real WhatsApp profile picture (DP) for display in the CRM Live Inbox.
   */
  public async fetchProfilePicture(
    rawPhone: string
  ): Promise<{ buffer: Buffer; mimeType: string } | null> {
    const phone = storage.normalizePhone(rawPhone);
    if (!phone) return null;

    const now = Date.now();
    const cached = this.avatarCache.get(phone);
    if (cached) {
      const ttl = cached.buffer ? 60 * 60 * 1000 : 15 * 60 * 1000;
      if (now - cached.fetchedAt < ttl) {
        return cached.buffer ? { buffer: cached.buffer, mimeType: cached.mimeType } : null;
      }
    }

    const diskPath = path.join(MEDIA_DIR, `avatar-${phone}.jpg`);
    if (fs.existsSync(diskPath)) {
      try {
        const stat = fs.statSync(diskPath);
        if (now - stat.mtimeMs < 24 * 60 * 60 * 1000 && stat.size > 0) {
          const buf = fs.readFileSync(diskPath);
          this.rememberAvatarCache(phone, buf, 'image/jpeg');
          return { buffer: buf, mimeType: 'image/jpeg' };
        }
      } catch {
        // continue to live fetch
      }
    }

    if (!this.sock || this.status !== 'CONNECTED') {
      return null;
    }

    const existingPromise = this.avatarInFlight.get(phone);
    if (existingPromise) return existingPromise;

    const task = (async (): Promise<{ buffer: Buffer; mimeType: string } | null> => {
      try {
        const session = storage.getStore().sessions[phone];
        const candidateJids = Array.from(
          new Set(
            [
              session?.altJid?.endsWith('@s.whatsapp.net') ? session.altJid : '',
              session?.rawJid?.includes('@') ? session.rawJid : '',
              phone.length <= 13 ? `${phone}@s.whatsapp.net` : `${phone}@lid`,
            ].filter(Boolean)
          )
        );

        let picUrl: string | undefined;
        for (const jid of candidateJids) {
          if (!this.sock) break;
          try {
            picUrl = await Promise.race<string | undefined>([
              this.sock.profilePictureUrl(jid, 'preview').catch(() =>
                this.sock ? this.sock.profilePictureUrl(jid, 'image') : undefined
              ),
              new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 4000)),
            ]);
            if (picUrl) break;
          } catch {
            // privacy restricted or not found on this JID
          }
        }

        if (!picUrl) {
          this.rememberAvatarCache(phone, null, 'image/jpeg');
          return null;
        }

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 4500);
        const resp = await fetch(picUrl, {
          signal: controller.signal,
          headers: { 'User-Agent': 'BGB-WhatsApp-CRM/1.0' },
        });
        clearTimeout(timer);

        if (!resp.ok) {
          this.rememberAvatarCache(phone, null, 'image/jpeg');
          return null;
        }

        const arr = await resp.arrayBuffer();
        if (arr.byteLength === 0 || arr.byteLength > 2 * 1024 * 1024) {
          this.rememberAvatarCache(phone, null, 'image/jpeg');
          return null;
        }

        const buffer = Buffer.from(arr);
        const mimeType = (resp.headers.get('content-type') || 'image/jpeg').split(';')[0].trim();
        this.rememberAvatarCache(phone, buffer, mimeType);

        try {
          if (!fs.existsSync(MEDIA_DIR)) {
            fs.mkdirSync(MEDIA_DIR, { recursive: true });
          }
          fs.writeFileSync(diskPath, buffer);
        } catch {
          // ignore disk cache write errors
        }

        return { buffer, mimeType };
      } catch {
        this.rememberAvatarCache(phone, null, 'image/jpeg');
        return null;
      } finally {
        this.avatarInFlight.delete(phone);
      }
    })();

    this.avatarInFlight.set(phone, task);
    return task;
  }

  private rememberAvatarCache(phone: string, buffer: Buffer | null, mimeType: string): void {
    this.avatarCache.set(phone, { buffer, mimeType, fetchedAt: Date.now() });
    if (this.avatarCache.size > 120) {
      const oldestKey = this.avatarCache.keys().next().value;
      if (oldestKey) this.avatarCache.delete(oldestKey);
    }
  }

  private mapHistoricalMessage(msg: proto.IWebMessageInfo): ChatMessage | null {
    const key = msg.key;
    if (!key) return null;
    const addressed = this.resolveAddressing(key);
    if (!addressed) return null;

    const extracted = this.extractMessageContent(msg.message);
    if (!extracted.body) return null;

    if (msg.pushName && !key.fromMe) {
      this.contactNames.set(addressed.phone, msg.pushName);
    }

    const wamId = key.id || `hist-${addressed.phone}-${this.parseMessageTimestampSec(msg.messageTimestamp)}`;
    const tsSec = this.parseMessageTimestampSec(msg.messageTimestamp);
    const fromMe = Boolean(key.fromMe);

    return {
      id: `msg-hist-${wamId}`,
      wamId,
      phone: addressed.phone,
      direction: fromMe ? 'OUTBOUND' : 'INBOUND',
      senderType: fromMe
        ? storage.isBotSentMessageId(wamId)
          ? 'AI'
          : 'HUMAN'
        : 'CUSTOMER',
      origin: fromMe
        ? storage.isBotSentMessageId(wamId)
          ? 'ai'
          : 'phone'
        : undefined,
      messageType: extracted.mediaKind || 'text',
      body: extracted.body,
      channel: 'baileys',
      mediaMimeType: extracted.mimeType,
      status: fromMe ? 'SENT' : 'RECEIVED',
      createdAt: new Date(tsSec * 1000).toISOString(),
    };
  }

  private resolveAddressing(key: proto.IMessageKey): {
    rawJid: string;
    altJid?: string;
    phone: string;
  } | null {
    const keyExt = key as proto.IMessageKey & {
      remoteJidAlt?: string;
      senderPn?: string;
      participantAlt?: string;
    };
    const altCandidate = keyExt.remoteJidAlt || keyExt.senderPn || keyExt.participantAlt || '';
    return this.resolveJidToPhone(key.remoteJid, altCandidate);
  }

  private async downloadInboundMedia(
    msg: proto.IWebMessageInfo,
    kind: 'image' | 'audio',
    mimeType: string
  ): Promise<InboundMediaAttachment | undefined> {
    if (!this.sock) return undefined;
    try {
      const baileys = await loadBaileysModule();
      const rawBuffer = await Promise.race<Buffer | null>([
        baileys.downloadMediaMessage(
          msg as WAMessage,
          'buffer',
          {},
          {
            logger: pino({ level: 'silent' }),
            reuploadRequest: this.sock.updateMediaMessage,
          }
        ) as Promise<Buffer>,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 8500)),
      ]);

      if (!rawBuffer || !Buffer.isBuffer(rawBuffer) || rawBuffer.length === 0) {
        return undefined;
      }
      if (rawBuffer.length > 5 * 1024 * 1024) {
        this.log('warn', `Skipped oversized ${kind} (${Math.round(rawBuffer.length / 1024)} KB)`);
        return undefined;
      }

      const cleanMime = (mimeType || (kind === 'image' ? 'image/jpeg' : 'audio/ogg'))
        .split(';')[0]
        .trim();
      const mediaUrl = storage.saveInboundMedia(rawBuffer, cleanMime, kind);

      return {
        kind,
        mimeType: cleanMime,
        base64: rawBuffer.toString('base64'),
        mediaUrl,
      };
    } catch (err) {
      this.log(
        'warn',
        `Could not download incoming ${kind}: ${err instanceof Error ? err.message : 'media error'}`
      );
      return undefined;
    }
  }

  private async handleIncomingMessage(msg: proto.IWebMessageInfo): Promise<void> {
    const key = msg.key;
    if (!key) return;

    const addressed = this.resolveAddressing(key);
    if (!addressed) return;

    const { rawJid, altJid, phone } = addressed;
    const wamId = key.id || `baileys-${Date.now()}`;

    // Instant O(1) in-memory dedup before any async work to block rapid duplicate upsert events
    if (this.seenWamIds.has(wamId)) return;
    this.seenWamIds.add(wamId);
    if (this.seenWamIds.size > 5000) {
      const oldest = this.seenWamIds.values().next().value;
      if (oldest) this.seenWamIds.delete(oldest);
    }

    const extracted = this.extractMessageContent(msg.message);
    const body = extracted.body.trim();
    if (!body) return;

    const tsSec = this.parseMessageTimestampSec(msg.messageTimestamp);

    // PHONE REPLY DETECTION (fromMe === true):
    // If outgoing message ID was NOT sent by our AI bot / Dashboard server,
    // the owner typed it manually on their physical phone WhatsApp!
    if (key.fromMe) {
      if (storage.isBotSentMessageId(wamId) || storage.hasMessageWithWamId(wamId)) {
        return;
      }
      if (this.phoneOutgoingListener) {
        await this.phoneOutgoingListener({
          wamId,
          phone,
          remoteJid: rawJid,
          altJid,
          body,
          timestamp: new Date(tsSec * 1000).toISOString(),
          messageKey: key,
        });
      }
      return;
    }

    if (storage.hasMessageWithWamId(wamId)) return;

    const customerName =
      (msg.pushName || this.contactNames.get(phone) || '').trim() || `+${phone}`;
    if (msg.pushName) {
      this.contactNames.set(phone, msg.pushName);
    }

    // For stale/offline buffered messages (> 2 min old): still save silently into Live Inbox
    // so all WhatsApp chats are visible on the website, but DO NOT trigger surprise AI replies!
    const msgAgeMs = Date.now() - tsSec * 1000;
    if (Number.isFinite(msgAgeMs) && msgAgeMs > 120_000) {
      const histMsg = this.mapHistoricalMessage(msg);
      if (histMsg) {
        const summary = storage.importWhatsAppHistory({
          chats: [{ phone, rawJid, altJid, name: customerName, lastMessageAt: histMsg.createdAt }],
          messages: [histMsg],
        });
        if (summary.chatsImported > 0 || summary.messagesImported > 0) {
          this.historySyncListener?.(summary);
        }
      }
      return;
    }

    // Download incoming Photo or Voice Message so Gemini can see/hear it & Inbox can display/play it!
    let media: InboundMediaAttachment | undefined;
    if (extracted.mediaKind) {
      media = await this.downloadInboundMedia(
        msg,
        extracted.mediaKind,
        extracted.mimeType || (extracted.mediaKind === 'image' ? 'image/jpeg' : 'audio/ogg')
      );
    }

    this.log(
      'info',
      `Incoming WhatsApp ${extracted.mediaKind ? `[${extracted.mediaKind.toUpperCase()}] ` : ''}from ${customerName} (${rawJid}${altJid ? ` -> +${phone}` : ''}): "${body.slice(0, 80)}"`
    );

    if (this.inboundListener) {
      await this.inboundListener({
        wamId,
        phone,
        rawJid,
        altJid,
        customerName,
        body,
        messageType: extracted.mediaKind || 'text',
        media,
        timestamp: new Date(tsSec * 1000).toISOString(),
      });
    }
  }

  public async deleteMessageForEveryone(
    remoteJid: string,
    messageKey: proto.IMessageKey
  ): Promise<boolean> {
    if (!this.sock || this.status !== 'CONNECTED') return false;
    try {
      await this.sock.sendMessage(remoteJid, { delete: messageKey });
      return true;
    } catch {
      return false;
    }
  }

  public async sendTypingIndicator(
    targetJid: string | undefined,
    composing: boolean
  ): Promise<void> {
    if (!this.sock || this.status !== 'CONNECTED' || !targetJid || !targetJid.includes('@')) {
      return;
    }
    try {
      await this.sock.sendPresenceUpdate(composing ? 'composing' : 'paused', targetJid);
    } catch {
      // presence updates are best-effort only
    }
  }

  public async sendMessage(params: {
    phone: string;
    targetJid?: string;
    altJid?: string;
    body: string;
    imageUrl?: string;
  }): Promise<{ success: boolean; wamId?: string; sentToJid?: string; error?: string }> {
    if (!this.sock || this.status !== 'CONNECTED') {
      return {
        success: false,
        error: 'WhatsApp is not connected. Pair via QR or 8-digit code in QR & Channels.',
      };
    }

    const digits = storage.normalizePhone(params.phone);
    const session = storage.getStore().sessions[digits] || storage.getStore().sessions[params.phone];

    // Prefer exact rawJid (works natively for both @lid and @s.whatsapp.net in Baileys v7)
    const primaryJid =
      (params.targetJid && params.targetJid.includes('@') ? params.targetJid : '') ||
      (session?.rawJid && session.rawJid.includes('@') ? session.rawJid : '') ||
      (params.altJid && params.altJid.includes('@') ? params.altJid : '') ||
      (session?.altJid && session.altJid.includes('@') ? session.altJid : '') ||
      (digits.length >= 14 ? `${digits}@lid` : `${digits}@s.whatsapp.net`);

    const candidateAlt =
      (params.altJid && params.altJid.includes('@') ? params.altJid : '') ||
      (session?.altJid && session.altJid.includes('@') ? session.altJid : '');
    const fallbackJid =
      candidateAlt && candidateAlt !== primaryJid ? candidateAlt : undefined;

    const fetchImageBufferFast = async (url: string): Promise<Buffer | null> => {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 3500);
        const resp = await fetch(url, {
          signal: controller.signal,
          headers: { 'User-Agent': 'BGB-WhatsApp-CRM/1.0' },
        });
        clearTimeout(timer);
        if (!resp.ok) return null;
        const arr = await resp.arrayBuffer();
        if (arr.byteLength === 0 || arr.byteLength > 5 * 1024 * 1024) return null;
        return Buffer.from(arr);
      } catch {
        return null;
      }
    };

    const sendToJid = async (jid: string): Promise<WAMessage | undefined> => {
      if (!this.sock) throw new Error('WhatsApp socket disconnected');
      if (params.imageUrl) {
        const imgBuf = await fetchImageBufferFast(params.imageUrl);
        if (imgBuf) {
          try {
            return await this.sock.sendMessage(jid, {
              image: imgBuf,
              caption: params.body,
            });
          } catch {
            // Fall through to fast text delivery
          }
        }
      }
      return await this.sock.sendMessage(jid, {
        text: params.body,
      });
    };

    try {
      let sent: WAMessage | undefined;
      let usedJid = primaryJid;
      try {
        sent = await sendToJid(primaryJid);
      } catch (primaryErr) {
        if (fallbackJid) {
          usedJid = fallbackJid;
          sent = await sendToJid(fallbackJid);
        } else {
          throw primaryErr;
        }
      }

      const wamId = sent?.key?.id || `wa-out-${Date.now()}`;
      // Record AI/dashboard message ID immediately BEFORE returning to prevent fromMe handover loops
      storage.recordBotSentMessageId(wamId);

      return {
        success: true,
        wamId,
        sentToJid: usedJid,
      };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Failed to dispatch message over Baileys';
      this.log('error', `Baileys sendMessage failed for ${primaryJid}: ${errMsg}`);
      return {
        success: false,
        error: errMsg,
      };
    }
  }

  private clearAuthFolder(): void {
    try {
      if (fs.existsSync(BAILEYS_AUTH_DIR)) {
        fs.rmSync(BAILEYS_AUTH_DIR, { recursive: true, force: true });
      }
      fs.mkdirSync(BAILEYS_AUTH_DIR, { recursive: true });
      scheduleRemoteBackup('baileys_auth_cleared');
    } catch {
      // ignore cleanup errors
    }
  }

  public async disconnect(logout = true): Promise<BaileysStateSnapshot> {
    this.intentionalDisconnect = true;
    this.isConnecting = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.sock) {
      const activeSock = this.sock;
      this.sock = null;
      try {
        if (logout && this.status === 'CONNECTED') {
          await activeSock.logout();
        } else {
          activeSock.end(new Error('Admin requested disconnect'));
        }
      } catch {
        // ignore close/logout errors on already-closed sockets
      }
    }
    if (logout) {
      this.clearAuthFolder();
    }
    this.status = 'DISCONNECTED';
    this.qrDataUrl = null;
    this.pairingCode = null;
    this.connectedPhone = null;
    this.connectedName = null;
    this.lastError = null;
    this.reconnectAttempts = 0;
    this.emitStatus();
    this.log(
      'info',
      logout
        ? 'Logged out and cleared persisted WhatsApp session. Ready to link a new number.'
        : 'WhatsApp session disconnected.'
    );
    return this.getSnapshot();
  }

  public async repairQr(): Promise<BaileysStateSnapshot> {
    return this.connect({ forceFresh: true, waitForQrMs: 6000 });
  }

  public async exportSessionBundle(handover = true): Promise<{
    ok: boolean;
    bundle?: {
      version: number;
      exportedAt: string;
      connectedPhone: string | null;
      connectedName: string | null;
      files: Record<string, string>;
    };
    error?: string;
  }> {
    if (!this.hasSavedCredentials()) {
      return {
        ok: false,
        error: 'No linked WhatsApp session found on this server. Connect WhatsApp first.',
      };
    }

    const files: Record<string, string> = {};
    const collectDir = (dir: string, prefix: string) => {
      if (!fs.existsSync(dir)) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.endsWith('.tmp') || entry.name === '.DS_Store') continue;
        const full = path.join(dir, entry.name);
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          collectDir(full, rel);
        } else if (entry.isFile()) {
          files[rel] = fs.readFileSync(full).toString('base64');
        }
      }
    };

    try {
      collectDir(BAILEYS_AUTH_DIR, '');
      if (!files['creds.json']) {
        return { ok: false, error: 'WhatsApp credentials file (creds.json) is missing.' };
      }

      const bundle = {
        version: 1,
        exportedAt: new Date().toISOString(),
        connectedPhone: this.connectedPhone,
        connectedName: this.connectedName,
        files,
      };

      // Handover mode cleanly closes local socket WITHOUT logging out so Render can connect
      // without WhatsApp throwing a 440 conflict error.
      if (handover && this.sock) {
        await this.disconnect(false);
        this.log(
          'info',
          'Exported WhatsApp session bundle and paused local socket cleanly for server handover.'
        );
      }

      return { ok: true, bundle };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'Failed to export WhatsApp session.',
      };
    }
  }

  public async importSessionBundle(rawFiles: Record<string, string>): Promise<{
    ok: boolean;
    fileCount: number;
    snapshot: BaileysStateSnapshot;
    error?: string;
  }> {
    if (!rawFiles || typeof rawFiles !== 'object' || typeof rawFiles['creds.json'] !== 'string') {
      return {
        ok: false,
        fileCount: 0,
        snapshot: this.getSnapshot(),
        error: 'Invalid session file. Make sure you upload a valid bgb-whatsapp-session.json file.',
      };
    }

    try {
      // Close any existing socket without logging out
      await this.disconnect(false);

      if (fs.existsSync(BAILEYS_AUTH_DIR)) {
        fs.rmSync(BAILEYS_AUTH_DIR, { recursive: true, force: true });
      }
      fs.mkdirSync(BAILEYS_AUTH_DIR, { recursive: true });

      const resolvedRoot = path.resolve(BAILEYS_AUTH_DIR);
      let written = 0;

      for (const [relPath, b64] of Object.entries(rawFiles)) {
        if (typeof b64 !== 'string' || !relPath || relPath.includes('..') || path.isAbsolute(relPath)) {
          continue;
        }
        const target = path.resolve(BAILEYS_AUTH_DIR, relPath);
        if (!target.startsWith(resolvedRoot + path.sep)) {
          continue;
        }
        const parent = path.dirname(target);
        if (!fs.existsSync(parent)) {
          fs.mkdirSync(parent, { recursive: true });
        }
        fs.writeFileSync(target, Buffer.from(b64, 'base64'));
        written += 1;
      }

      if (written === 0 || !this.hasSavedCredentials()) {
        return {
          ok: false,
          fileCount: 0,
          snapshot: this.getSnapshot(),
          error: 'Session import failed: creds.json could not be restored.',
        };
      }

      this.log('success', `Imported ${written} WhatsApp session files. Connecting & syncing to vault...`);
      void flushRemoteBackupNow('session_import');

      const snap = await this.connect();
      await this.waitForCondition(
        () => this.status === 'CONNECTED' || Boolean(this.lastError),
        7000
      );

      return {
        ok: true,
        fileCount: written,
        snapshot: this.getSnapshot() || snap,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to import WhatsApp session.';
      this.log('error', `Session import error: ${msg}`);
      return {
        ok: false,
        fileCount: 0,
        snapshot: this.getSnapshot(),
        error: msg,
      };
    }
  }
}

const globalForBaileys = globalThis as unknown as {
  __bgbBaileysManager?: BaileysManager;
};

export const baileysManager =
  globalForBaileys.__bgbBaileysManager ?? new BaileysManager();

if (!globalForBaileys.__bgbBaileysManager) {
  globalForBaileys.__bgbBaileysManager = baileysManager;
}
