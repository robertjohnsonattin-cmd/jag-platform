import { logger } from './logger';

const BASE_URL = 'https://graph.facebook.com/v19.0';

export interface WaTextMessage {
  to: string;
  body: string;
}

export interface WaTemplateMessage {
  to: string;
  templateName: string;
  languageCode?: string;
  components?: unknown[];
}

export interface WaInteractiveMessage {
  to: string;
  body: string;
  buttons: Array<{ id: string; title: string }>;
}

async function callMeta(endpoint: string, payload: unknown): Promise<unknown> {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneId) {
    logger.warn({ entity: 'WHATSAPP', action: 'SEND_SKIP', reason: 'env vars not configured' });
    return null;
  }
  const res = await fetch(`${BASE_URL}/${phoneId}/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.text();
    logger.error({ entity: 'WHATSAPP', action: 'SEND_ERROR', status: res.status, body });
    throw new Error(`WhatsApp API error ${res.status}: ${body}`);
  }
  return res.json();
}

export async function sendText({ to, body }: WaTextMessage): Promise<unknown> {
  return callMeta('messages', {
    messaging_product: 'whatsapp',
    to,
    type: 'text',
    text: { body },
  });
}

export async function sendTemplate({ to, templateName, languageCode = 'en_US', components = [] }: WaTemplateMessage): Promise<unknown> {
  return callMeta('messages', {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: { name: templateName, language: { code: languageCode }, components },
  });
}

export async function sendInteractive({ to, body, buttons }: WaInteractiveMessage): Promise<unknown> {
  return callMeta('messages', {
    messaging_product: 'whatsapp',
    to,
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: body },
      action: {
        buttons: buttons.map(b => ({ type: 'reply', reply: { id: b.id, title: b.title } })),
      },
    },
  });
}

export function verifyWebhookSignature(rawBody: Buffer, signatureHeader: string): boolean {
  const secret = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!secret) return false;
  const crypto = require('crypto') as typeof import('crypto');
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader));
  } catch {
    return false;
  }
}
