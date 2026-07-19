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

export interface WaListMessage {
  to: string;
  body: string;
  buttonText: string;
  rows: Array<{ id: string; title: string; description?: string }>;
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
  const json = await res.json();
  // Meta accepting the request only confirms it queued the message — not that
  // WhatsApp delivered it to the device. Logged so a "message didn't arrive"
  // report can be checked against whether we even got this far, since prior to
  // this there was no success log at all for WhatsApp sends.
  logger.info({ entity: 'WHATSAPP', action: 'SEND_ACCEPTED', message_id: (json as { messages?: Array<{ id?: string }> })?.messages?.[0]?.id });
  return json;
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

// WhatsApp list messages support up to 10 rows in a single section — used when
// more units are LISTED simultaneously than the 3-button interactive limit allows.
export async function sendList({ to, body, buttonText, rows }: WaListMessage): Promise<unknown> {
  return callMeta('messages', {
    messaging_product: 'whatsapp',
    to,
    type: 'interactive',
    interactive: {
      type: 'list',
      body: { text: body },
      action: {
        button: buttonText,
        sections: [{ title: 'Available Units', rows }],
      },
    },
  });
}

export function verifyWebhookSignature(rawBody: Buffer, signatureHeader: string): boolean {
  // Meta signs the X-Hub-Signature-256 header with the app's App Secret
  // (App Dashboard → Settings → Basic → "App secret"), NOT the access token.
  // Using WHATSAPP_ACCESS_TOKEN here made every inbound webhook fail signature
  // verification (SIG_INVALID → 403), so no inbound message was ever processed.
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret) return false;
  const crypto = require('crypto') as typeof import('crypto');
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader));
  } catch {
    return false;
  }
}
