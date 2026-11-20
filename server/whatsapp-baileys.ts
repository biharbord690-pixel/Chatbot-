import fs from 'fs';
import path from 'path';
import type { Boom } from '@hapi/boom';
import type { WAMessage, WASocket, proto } from '@whiskeysockets/baileys';
import pino from 'pino';
import QRCode from 'qrcode';
import type { BaileysConnectionStatus, BaileysStateSnapshot } from '../lib/types';
import { flushRemoteBackupNow, scheduleRemoteBackup } from './remote-backup';
import { BAILEYS_AUTH_DIR, storage } from './storage';

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

  private statusListeners: Set<StatusListener> = new Set();
  private logListeners: Set<LogListener> = new Set();
  private inboundListener: InboundListener | null = null;
  private phoneOutgoingListener: PhoneOutgoingListener | null = null;

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
        shouldSyncHistoryMessage: () => false,
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

      sock.ev.on('messages.upsert', async (event) => {
        if (event.type !== 'notify') return;
        for (const msg of event.messages) {
          await this.handleIncomingMessage(msg);
        }
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

  private extractTextBody(message: proto.IMessage | null | undefined): string {
    if (!message) return '';
    if (message.conversation) return message.conversation;
    if (message.extendedTextMessage?.text) return message.extendedTextMessage.text;
    if (message.imageMessage?.caption) return message.imageMessage.caption;
    if (message.videoMessage?.caption) return message.videoMessage.caption;
    if (message.buttonsResponseMessage?.selectedDisplayText) {
      return message.buttonsResponseMessage.selectedDisplayText;
    }
    if (message.listResponseMessage?.title) {
      return message.listResponseMessage.title;
    }
    return '';
  }

  private resolveAddressing(key: proto.IMessageKey): {
    rawJid: string;
    altJid?: string;
    phone: string;
  } | null {
    const rawJid = key.remoteJid || '';
    if (
      !rawJid ||
      rawJid === 'status@broadcast' ||
      rawJid.endsWith('@g.us') ||
      rawJid.endsWith('@broadcast') ||
      rawJid.endsWith('@newsletter')
    ) {
      return null;
    }

    const keyExt = key as proto.IMessageKey & {
      remoteJidAlt?: string;
      senderPn?: string;
      participantAlt?: string;
    };
    const altCandidate = keyExt.remoteJidAlt || keyExt.senderPn || keyExt.participantAlt || '';
    const altJid = altCandidate && altCandidate.includes('@') ? altCandidate : undefined;

    const extractDigits = (jid: string) =>
      jid.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');

    let phone = '';
    if (rawJid.endsWith('@s.whatsapp.net')) {
      const digits = extractDigits(rawJid);
      if (digits.length >= 8) {
        phone = storage.normalizePhone(digits);
      }
    } else if (altJid && altJid.endsWith('@s.whatsapp.net')) {
      const altDigits = extractDigits(altJid);
      if (altDigits.length >= 8) {
        phone = storage.normalizePhone(altDigits);
      }
    }

    if (!phone) {
      const rawDigits = extractDigits(rawJid);
      if (rawDigits.length < 8) return null;
      // Preserve raw LID digits without prepending 91 when remoteJid is @lid
      phone = rawJid.endsWith('@lid') ? rawDigits : storage.normalizePhone(rawDigits);
    }

    return { rawJid, altJid, phone };
  }

  private async handleIncomingMessage(msg: proto.IWebMessageInfo): Promise<void> {
    const key = msg.key;
    if (!key) return;

    const addressed = this.resolveAddressing(key);
    if (!addressed) return;

    const { rawJid, altJid, phone } = addressed;
    const wamId = key.id || `baileys-${Date.now()}`;
    const body = this.extractTextBody(msg.message).trim();
    if (!body) return;

    const tsSec = Number(msg.messageTimestamp || Math.floor(Date.now() / 1000));

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

    this.log(
      'info',
      `Incoming WhatsApp from ${msg.pushName || `+${phone}`} (${rawJid}${altJid ? ` -> +${phone}` : ''}): "${body.slice(0, 80)}"`
    );

    if (this.inboundListener) {
      await this.inboundListener({
        wamId,
        phone,
        rawJid,
        altJid,
        customerName: msg.pushName || `+${phone}`,
        body,
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

    const sendToJid = async (jid: string): Promise<WAMessage | undefined> => {
      if (!this.sock) throw new Error('WhatsApp socket disconnected');
      if (params.imageUrl) {
        try {
          return await this.sock.sendMessage(jid, {
            image: { url: params.imageUrl },
            caption: params.body,
          });
        } catch {
          // If external image fetch fails, always fall back to delivering the text reply
          return await this.sock.sendMessage(jid, {
            text: params.body,
          });
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
