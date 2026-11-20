import crypto from 'crypto';
import { loadSecrets, storage } from './storage';

export interface MetaInboundMessage {
  wamId: string;
  phone: string;
  customerName: string;
  body: string;
  timestamp: string;
}

export interface MetaEchoMessage {
  wamId: string;
  phone: string;
  body: string;
  timestamp: string;
}

export function verifyMetaSignature(rawBody: Buffer, signatureHeader: string | undefined): boolean {
  const secrets = loadSecrets();
  if (!secrets.metaAppSecret) {
    // Allow verification to pass only if App Secret hasn't been configured yet
    return true;
  }
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) {
    return false;
  }
  const expected =
    'sha256=' +
    crypto.createHmac('sha256', secrets.metaAppSecret).update(rawBody).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader));
  } catch {
    return false;
  }
}

export function extractMetaInboundMessages(payload: unknown): MetaInboundMessage[] {
  const extracted: MetaInboundMessage[] = [];
  if (!payload || typeof payload !== 'object') return extracted;
  const entries = (payload as { entry?: unknown[] }).entry;
  if (!Array.isArray(entries)) return extracted;

  for (const entry of entries) {
    const changes = (entry as { changes?: unknown[] }).changes;
    if (!Array.isArray(changes)) continue;
    for (const change of changes) {
      const value = (change as { value?: Record<string, unknown> }).value;
      if (!value || !Array.isArray(value.messages)) continue;

      const contacts = Array.isArray(value.contacts)
        ? (value.contacts as Array<{ wa_id?: string; profile?: { name?: string } }>)
        : [];

      for (const msg of value.messages as Array<Record<string, unknown>>) {
        if (msg.is_echo === true) continue;
        const from = String(msg.from || '');
        const wamId = String(msg.id || '');
        if (!from || !wamId) continue;

        let body = '';
        if (msg.type === 'text' && msg.text && typeof msg.text === 'object') {
          body = String((msg.text as { body?: string }).body || '');
        } else if (msg.type === 'interactive' && msg.interactive && typeof msg.interactive === 'object') {
          const inter = msg.interactive as {
            button_reply?: { title?: string };
            list_reply?: { title?: string };
          };
          body = inter.button_reply?.title || inter.list_reply?.title || '';
        } else if (msg.type === 'button' && msg.button && typeof msg.button === 'object') {
          body = String((msg.button as { text?: string }).text || '');
        }

        if (!body.trim()) continue;

        const matchedContact = contacts.find((c) => c.wa_id === from);
        const tsSeconds = Number(msg.timestamp || Date.now() / 1000);

        extracted.push({
          wamId,
          phone: storage.normalizePhone(from),
          customerName: matchedContact?.profile?.name || `+${from}`,
          body: body.trim(),
          timestamp: new Date(tsSeconds * 1000).toISOString(),
        });
      }
    }
  }
  return extracted;
}

export function extractMetaEchoMessages(payload: unknown): MetaEchoMessage[] {
  const echoes: MetaEchoMessage[] = [];
  if (!payload || typeof payload !== 'object') return echoes;
  const entries = (payload as { entry?: unknown[] }).entry;
  if (!Array.isArray(entries)) return echoes;

  for (const entry of entries) {
    const changes = (entry as { changes?: unknown[] }).changes;
    if (!Array.isArray(changes)) continue;
    for (const change of changes) {
      const value = (change as { value?: Record<string, unknown> }).value;
      if (!value) continue;

      const candidateLists: Array<Record<string, unknown>> = [];
      // Meta WhatsApp Business App Coexistence sends echoes under value.message_echoes
      if (Array.isArray(value.message_echoes)) {
        candidateLists.push(...(value.message_echoes as Array<Record<string, unknown>>));
      }
      // Also support standard messages flagged with is_echo === true
      if (Array.isArray(value.messages)) {
        for (const m of value.messages as Array<Record<string, unknown>>) {
          if (m.is_echo === true) {
            candidateLists.push(m);
          }
        }
      }

      for (const msg of candidateLists) {
        const to = String(msg.to || msg.recipient_id || '');
        const wamId = String(msg.id || '');
        if (!to || !wamId) continue;

        let body = '';
        if (msg.type === 'text' && msg.text && typeof msg.text === 'object') {
          body = String((msg.text as { body?: string }).body || '');
        } else if (typeof msg.body === 'string') {
          body = msg.body;
        }
        if (!body.trim()) continue;

        const tsSeconds = Number(msg.timestamp || Date.now() / 1000);
        echoes.push({
          wamId,
          phone: storage.normalizePhone(to),
          body: body.trim(),
          timestamp: new Date(tsSeconds * 1000).toISOString(),
        });
      }
    }
  }
  return echoes;
}

export async function sendMetaWhatsAppMessage(params: {
  phone: string;
  body: string;
  imageUrl?: string;
}): Promise<{ success: boolean; wamId?: string; error?: string }> {
  const metaCfg = storage.getStore().settings.meta;
  const secrets = loadSecrets();

  if (!metaCfg.phoneNumberId || !secrets.metaAccessToken) {
    return {
      success: false,
      error: 'Meta Cloud API Phone Number ID or Permanent Access Token is not configured.',
    };
  }

  const normalizedPhone = storage.normalizePhone(params.phone);
  const apiVersion = metaCfg.apiVersion || 'v21.0';
  const endpoint = `https://graph.facebook.com/${apiVersion}/${metaCfg.phoneNumberId}/messages`;

  const payload = params.imageUrl
    ? {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: normalizedPhone,
        type: 'image',
        image: {
          link: params.imageUrl,
          caption: params.body,
        },
      }
    : {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: normalizedPhone,
        type: 'text',
        text: {
          preview_url: true,
          body: params.body,
        },
      };

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secrets.metaAccessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = (await res.json()) as {
      messages?: Array<{ id?: string }>;
      error?: { message?: string };
    };

    if (!res.ok) {
      return {
        success: false,
        error: data.error?.message || `Meta Graph API returned HTTP ${res.status}`,
      };
    }

    const wamId = data.messages?.[0]?.id || `meta-${Date.now()}`;
    storage.recordBotSentMessageId(wamId);

    return {
      success: true,
      wamId,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to call Meta Graph API',
    };
  }
}
