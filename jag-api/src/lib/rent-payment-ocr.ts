import { logger } from './logger';

export interface PaymentSlipExtract {
  looksLikePaymentSlip: boolean;
  amount: number | null;
  date: string | null; // YYYY-MM-DD
  reference: string | null;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
}

// Gemini's inline-image API only accepts a handful of MIME types — anything
// else (e.g. a tenant sending a PDF bank confirmation instead of a photo) is
// skipped rather than sent and rejected outright.
const SUPPORTED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);

const PROMPT = `This image is a photo or screenshot sent by a residential tenant in Trinidad & Tobago as proof of a rent payment (a bank transfer confirmation, deposit slip, or online banking screenshot). Read the image and extract:
- amount_ttd: the TTD amount transferred, as a plain number (no currency symbol, no commas). null if you cannot read it.
- payment_date: the date the payment/transfer was made, formatted YYYY-MM-DD. null if you cannot read it.
- reference: any transaction/confirmation/reference number visible on the slip. null if there isn't one.
- is_payment_slip: true only if this genuinely looks like a bank transfer, deposit slip, or payment confirmation — false for an unrelated photo.
- confidence: "HIGH" if the amount and date are both clearly legible, "MEDIUM" if one of them is uncertain, "LOW" if the image is blurry, cropped, or ambiguous.`;

// Reads a tenant's WhatsApp payment-slip photo and extracts the fields needed
// to match it against prop_rent_schedule. Returns null on any failure (missing
// key, unsupported mime, upstream error, unparsable response) — callers treat
// null the same as a LOW-confidence read: never auto-post, always fall back to
// owner review.
export async function extractPaymentSlip(buffer: Buffer, mimeType: string): Promise<PaymentSlipExtract | null> {
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) {
    logger.warn({ entity: 'RENT_OCR', action: 'SKIP', reason: 'GEMINI_API_KEY not configured' });
    return null;
  }
  const base = (mimeType.split(';')[0] ?? mimeType).toLowerCase();
  if (!SUPPORTED_MIME.has(base)) {
    logger.info({ entity: 'RENT_OCR', action: 'SKIP', reason: 'unsupported mime', mime: base });
    return null;
  }

  const geminiModel = process.env.GEMINI_MODEL ?? 'gemini-2.0-flash';
  let geminiRes: Response;
  try {
    geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${geminiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [
            { text: PROMPT },
            { inlineData: { mimeType: base, data: buffer.toString('base64') } },
          ] }],
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: 'OBJECT',
              properties: {
                amount_ttd:      { type: 'NUMBER', nullable: true },
                payment_date:    { type: 'STRING', nullable: true },
                reference:       { type: 'STRING', nullable: true },
                is_payment_slip: { type: 'BOOLEAN' },
                confidence:      { type: 'STRING', enum: ['HIGH', 'MEDIUM', 'LOW'] },
              },
              required: ['is_payment_slip', 'confidence'],
            },
          },
        }),
      },
    );
  } catch (e) {
    logger.error({ entity: 'RENT_OCR', action: 'GEMINI_FETCH_FAILED', error_message: (e as Error).message });
    return null;
  }

  if (!geminiRes.ok) {
    logger.error({ entity: 'RENT_OCR', action: 'GEMINI_ERROR', status: geminiRes.status, body: await geminiRes.text() });
    return null;
  }

  type GeminiResp = { candidates?: Array<{ content: { parts: Array<{ text: string }> } }> };
  const data = (await geminiRes.json()) as GeminiResp;
  const raw = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

  try {
    const parsed = JSON.parse(raw) as {
      amount_ttd?: number | null; payment_date?: string | null; reference?: string | null;
      is_payment_slip?: boolean; confidence?: 'HIGH' | 'MEDIUM' | 'LOW';
    };
    // Reject anything not matching YYYY-MM-DD before it can reach a DATE column (STD-10).
    const date = parsed.payment_date && /^\d{4}-\d{2}-\d{2}$/.test(parsed.payment_date) ? parsed.payment_date : null;
    return {
      looksLikePaymentSlip: parsed.is_payment_slip ?? false,
      amount: typeof parsed.amount_ttd === 'number' && Number.isFinite(parsed.amount_ttd) ? parsed.amount_ttd : null,
      date,
      reference: parsed.reference?.trim() || null,
      confidence: parsed.confidence ?? 'LOW',
    };
  } catch {
    logger.warn({ entity: 'RENT_OCR', action: 'PARSE_FAILED', raw: raw.slice(0, 300) });
    return null;
  }
}
