// POST   /api/v1/properties/units/:id/list
// POST   /api/v1/properties/units/:id/suggest-price
// POST   /api/v1/properties/units/:id/sms-broadcast
// POST   /api/v1/properties/units/:id/unlist

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { withOwnerRLS } from '../../middleware/rls';
import { propertiesPool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';

export const listingRouter = Router({ mergeParams: true });

const IdParam = z.object({ id: z.string().uuid() });

const SmsSchema = z.object({
  contacts: z.array(z.string().min(7).max(30)).min(1),
}).strict();

async function postToFacebook(unit: Record<string, unknown>, photos: string[]): Promise<string | null> {
  const pageId = process.env.FACEBOOK_PAGE_ID;
  const token  = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
  if (!pageId || !token) {
    logger.warn({ entity: 'PROPERTIES', action: 'FB_LIST_SKIP', reason: 'env vars not configured' });
    return null;
  }
  const beds = unit['bedrooms'] ?? '?';
  const baths = unit['bathrooms'] ?? '?';
  const rent = unit['suggested_rent_recommended_ttd'] ?? unit['rent_amount'] ?? '—';
  const payload = {
    name: `${beds}-Bedroom ${unit['unit_type'] ?? 'Unit'} — ${unit['city'] ?? 'Trinidad'}`,
    description: `${beds} bed / ${baths} bath. Rent: TTD $${rent}/month. ${unit['wasa_included'] ? 'WASA included.' : ''} Available now.`,
    price: { amount: Math.round(parseFloat(String(rent)) * 100), currency: 'TTD' },
    availability: 'AVAILABLE',
    images: photos.slice(0, 10).map(url => ({ url })),
    location: { address: String(unit['address_line1'] ?? ''), city: String(unit['city'] ?? 'Port of Spain'), country: 'TT' },
    category_specific_fields: {
      property_type: 'APARTMENT',
      num_beds: Number(beds),
      num_baths: Number(baths),
    },
  };
  const res = await fetch(`https://graph.facebook.com/v19.0/${pageId}/listings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.text();
    logger.error({ entity: 'PROPERTIES', action: 'FB_LIST_ERROR', status: res.status, body });
    return null;
  }
  const data = (await res.json()) as { id: string };
  return data.id;
}

async function deleteFromFacebook(listingId: string): Promise<void> {
  const token = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
  if (!token) return;
  await fetch(`https://graph.facebook.com/v19.0/${listingId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  }).catch(() => { /* best effort */ });
}

async function sendSmsViaTwilio(to: string, message: string): Promise<void> {
  const sid  = process.env.TWILIO_ACCOUNT_SID;
  const auth = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  if (!sid || !auth || !from) {
    logger.warn({ entity: 'PROPERTIES', action: 'SMS_SKIP', reason: 'Twilio env vars not configured' });
    return;
  }
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + Buffer.from(`${sid}:${auth}`).toString('base64'),
    },
    body: new URLSearchParams({ To: to, From: from, Body: message }).toString(),
  });
  if (!res.ok) {
    const body = await res.text();
    logger.error({ entity: 'PROPERTIES', action: 'SMS_ERROR', status: res.status, body });
  }
}

listingRouter.post('/list', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ownerId = (req as Request & { user?: { jag_user_id?: string } }).user?.jag_user_id;
    if (!ownerId) return void res.status(401).json(err('Unauthorised', 'UNAUTHORIZED'));
    const { id } = IdParam.parse(req.params);

    const unit = await withOwnerRLS(propertiesPool, ownerId, async client => {
      const { rows } = await client.query(
        `SELECT u.*, p.name AS property_name, p.address_line1, p.city, p.owner_id AS prop_owner_id
         FROM prop_units u
         LEFT JOIN prop_properties p ON p.id = u.property_id
         WHERE u.id = $1`,
        [id],
      );
      return rows[0] ?? null;
    });
    if (!unit) return void res.status(404).json(err('Unit not found', 'NOT_FOUND'));

    const fbListingId = await postToFacebook(unit as Record<string, unknown>, []);

    const slug = `${String(unit['unit_number']).toLowerCase().replace(/\s+/g, '-')}-${id.slice(0, 8)}`;

    const updated = await withOwnerRLS(propertiesPool, ownerId, async client => {
      const { rows } = await client.query(
        `UPDATE prop_units SET listing_status = 'LISTED', listed_at = NOW(),
           facebook_listing_id = $1, facebook_listed_at = $2, booking_slug = $3
         WHERE id = $4 RETURNING *`,
        [fbListingId, fbListingId ? new Date() : null, slug, id],
      );
      return rows[0];
    });
    res.json(ok({ unit: updated, facebook_listing_id: fbListingId, booking_slug: slug }));
  } catch (e) { next(e); }
});

listingRouter.post('/suggest-price', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ownerId = (req as Request & { user?: { jag_user_id?: string } }).user?.jag_user_id;
    if (!ownerId) return void res.status(401).json(err('Unauthorised', 'UNAUTHORIZED'));
    const { id } = IdParam.parse(req.params);

    const { unit, comparables } = await withOwnerRLS(propertiesPool, ownerId, async client => {
      const { rows: [u] } = await client.query(
        `SELECT u.*, p.address_line1, p.city FROM prop_units u
         LEFT JOIN prop_properties p ON p.id = u.property_id WHERE u.id = $1`,
        [id],
      );
      const { rows: comps } = await client.query(
        `SELECT u.bedrooms, u.bathrooms, l.rent_amount_ttd, u.wasa_included
         FROM prop_units u
         JOIN prop_lease_agreements l ON l.unit_id = u.id
         WHERE l.status = 'ACTIVE' AND u.bedrooms = $1 AND u.id != $2
         LIMIT 5`,
        [u?.bedrooms ?? 0, id],
      );
      return { unit: u ?? null, comparables: comps };
    });
    if (!unit) return void res.status(404).json(err('Unit not found', 'NOT_FOUND'));

    const ollamaUrl = process.env.OLLAMA_URL ?? 'http://host.docker.internal:11434';
    const model     = process.env.OLLAMA_MODEL ?? 'llama3.2';

    const prompt = `You are a Trinidad real estate advisor. Suggest a monthly rent range in TTD for:
- Location: ${unit.address_line1 ?? 'Trinidad'}, ${unit.city ?? ''}
- Bedrooms: ${unit.bedrooms ?? '?'}, Bathrooms: ${unit.bathrooms ?? '?'}
- Size: ${unit.floor_area_sqm ?? '?'} sqm
- WASA included: ${unit.wasa_included ? 'Yes' : 'No'}, Electricity: tenant pays, Internet: tenant pays
${comparables.length > 0 ? `- Comparable units renting at: ${comparables.map(c => `TTD ${c.rent_amount_ttd}`).join(', ')}` : ''}

Return JSON only: { "min_ttd": number, "max_ttd": number, "recommended_ttd": number, "rationale": "string" }`;

    const ollamaRes = await fetch(`${ollamaUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt, stream: false, options: { num_ctx: 4096 } }),
    });

    if (!ollamaRes.ok) return void res.status(502).json(err('Ollama unavailable', 'UPSTREAM_ERROR'));
    const ollamaData = (await ollamaRes.json()) as { response: string };

    type RentSuggestion = { min_ttd: number; max_ttd: number; recommended_ttd: number; rationale: string };
    let suggestion: RentSuggestion | null = null;
    try {
      const jsonMatch = ollamaData.response.match(/\{[\s\S]*\}/);
      if (jsonMatch) suggestion = JSON.parse(jsonMatch[0]) as RentSuggestion;
    } catch { /* ignore parse error */ }

    if (suggestion) {
      const s = suggestion;
      await withOwnerRLS(propertiesPool, ownerId, async client => {
        await client.query(
          `UPDATE prop_units SET suggested_rent_min_ttd = $1, suggested_rent_max_ttd = $2,
             suggested_rent_recommended_ttd = $3 WHERE id = $4`,
          [s.min_ttd, s.max_ttd, s.recommended_ttd, id],
        );
      });
    }

    res.json(ok(suggestion ?? { error: 'Could not parse Ollama response', raw: ollamaData.response }));
  } catch (e) { next(e); }
});

listingRouter.post('/sms-broadcast', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ownerId = (req as Request & { user?: { jag_user_id?: string } }).user?.jag_user_id;
    if (!ownerId) return void res.status(401).json(err('Unauthorised', 'UNAUTHORIZED'));
    const { id } = IdParam.parse(req.params);
    const { contacts } = SmsSchema.parse(req.body);

    const unit = await withOwnerRLS(propertiesPool, ownerId, async client => {
      const { rows } = await client.query(
        `SELECT u.*, p.address_line1, p.city FROM prop_units u
         LEFT JOIN prop_properties p ON p.id = u.property_id WHERE u.id = $1`,
        [id],
      );
      return rows[0] ?? null;
    });
    if (!unit) return void res.status(404).json(err('Unit not found', 'NOT_FOUND'));

    const bookingBase = process.env.PUBLIC_BOOKING_BASE_URL ?? 'https://jagcorporate.com/book';
    const rent = unit.suggested_rent_recommended_ttd ?? '—';
    const beds = unit.bedrooms ?? '?';
    const area = `${unit.city ?? 'Trin'}`;
    const unitType = unit.unit_type ?? 'Apt';
    const slug = unit.booking_slug ?? id;
    const msg = `FOR RENT: ${beds}BR ${unitType} ${area}. TTD$${rent}/mo. ${unit.wasa_included ? 'WASA incl.' : 'Util excl.'} View: ${bookingBase}/${slug} JAG Properties +18681234567`.slice(0, 160);

    let sent = 0;
    for (const phone of contacts) {
      try {
        await sendSmsViaTwilio(phone, msg);
        sent++;
      } catch (e) {
        logger.warn({ entity: 'PROPERTIES', action: 'SMS_FAILED', to: phone, error_message: (e as Error).message });
      }
    }
    res.json(ok({ sent, total: contacts.length }));
  } catch (e) { next(e); }
});

listingRouter.post('/unlist', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ownerId = (req as Request & { user?: { jag_user_id?: string } }).user?.jag_user_id;
    if (!ownerId) return void res.status(401).json(err('Unauthorised', 'UNAUTHORIZED'));
    const { id } = IdParam.parse(req.params);

    const unit = await withOwnerRLS(propertiesPool, ownerId, async client => {
      const { rows } = await client.query(`SELECT * FROM prop_units WHERE id = $1`, [id]);
      return rows[0] ?? null;
    });
    if (!unit) return void res.status(404).json(err('Unit not found', 'NOT_FOUND'));

    if (unit.facebook_listing_id) {
      await deleteFromFacebook(unit.facebook_listing_id as string);
    }

    const updated = await withOwnerRLS(propertiesPool, ownerId, async client => {
      const { rows } = await client.query(
        `UPDATE prop_units SET listing_status = 'VACANT', facebook_listing_id = NULL,
           facebook_listed_at = NULL WHERE id = $1 RETURNING *`,
        [id],
      );
      return rows[0];
    });
    res.json(ok(updated));
  } catch (e) { next(e); }
});
