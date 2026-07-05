// POST   /api/v1/properties/units/:id/list
// POST   /api/v1/properties/units/:id/suggest-price
// POST   /api/v1/properties/units/:id/sms-broadcast
// POST   /api/v1/properties/units/:id/unlist
// GET    /api/v1/properties/units/:id/photos
// POST   /api/v1/properties/units/:id/photos/upload-url
// POST   /api/v1/properties/units/:id/photos
// DELETE /api/v1/properties/units/:id/photos/:photoId
// PATCH  /api/v1/properties/units/:id/listing-info

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { withOwnerRLS } from '../../middleware/rls';
import { propertiesPool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';
import { sendTemplate } from '../../lib/whatsapp';
import { BUCKET_PHOTOS, getPresignedPutUrl, getPresignedGetUrl, deleteObject, mediaObjectKey } from '../../lib/minio';

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
    const ownerId = req.rlsCtx.userId;
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

    const photoRows = await withOwnerRLS(propertiesPool, ownerId, async client => {
      const { rows } = await client.query(
        `SELECT object_key FROM prop_unit_photos WHERE unit_id = $1 ORDER BY display_order, created_at LIMIT 10`,
        [id],
      );
      return rows as Array<{ object_key: string }>;
    });
    const photoUrls = await Promise.all(
      photoRows.map(p => getPresignedGetUrl(BUCKET_PHOTOS, p.object_key, 604800).catch(() => null)),
    ).then(urls => urls.filter((u): u is string => u !== null));

    const fbListingId = await postToFacebook(unit as Record<string, unknown>, photoUrls);

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
    // JAG_ADV_001 — broadcast to all past enquirers for this property
    broadcastNewListing(ownerId, unit as Record<string, unknown>, slug).catch(e =>
      logger.warn({ entity: 'PROPERTIES', action: 'WA_BROADCAST_FAILED', error_message: (e as Error).message }),
    );

    res.json(ok({ unit: updated, facebook_listing_id: fbListingId, booking_slug: slug }));
  } catch (e) { next(e); }
});

async function broadcastNewListing(ownerId: string, unit: Record<string, unknown>, slug: string): Promise<void> {
  const enquirers = await withOwnerRLS(propertiesPool, ownerId, async client => {
    const { rows } = await client.query<Record<string, unknown>>(
      `SELECT DISTINCT ON (e.prospect_phone) e.prospect_phone, e.prospect_name
       FROM prop_enquiries e
       JOIN prop_units u ON u.id = e.unit_id
       WHERE e.owner_id = $1
         AND u.property_id = $2
         AND e.prospect_phone IS NOT NULL
       ORDER BY e.prospect_phone, e.created_at DESC
       LIMIT 500`,
      [ownerId, unit['property_id']],
    );
    return rows;
  });

  const bookingBase = process.env.PUBLIC_BOOKING_BASE_URL ?? 'https://jagcorporate.com/book';
  const rent  = String(unit['suggested_rent_recommended_ttd'] ?? unit['rent_amount'] ?? '');
  const avail = new Date().toLocaleDateString('en-TT', { day: 'numeric', month: 'long', year: 'numeric' });

  for (const contact of enquirers) {
    if (!contact['prospect_phone']) continue;
    await sendTemplate({
      to: String(contact['prospect_phone']),
      templateName: 'jag_adv_new_listing',
      components: [
        { type: 'body', parameters: [
          { type: 'text', text: String(unit['property_name'] ?? '') },
          { type: 'text', text: String(unit['unit_number'] ?? '') },
          { type: 'text', text: rent },
          { type: 'text', text: avail },
        ]},
        { type: 'button', sub_type: 'url', index: '0', parameters: [
          { type: 'text', text: `${bookingBase}/${slug}` },
        ]},
      ],
    }).catch(() => { /* per-contact failure is non-fatal */ });
    await new Promise(r => setTimeout(r, 100)); // rate-limit: 10 msg/sec
  }
  logger.info({ entity: 'PROPERTIES', action: 'WA_BROADCAST_COMPLETE', unit_id: unit['id'], sent: enquirers.length, severity: 'INFO' });
}

// Called automatically by handover.ts when an EXIT checklist is completed.
// Idempotent: skips if the unit is already LISTED.
export async function triggerAutoListing(ownerId: string, unitId: string): Promise<void> {
  const unit = await withOwnerRLS(propertiesPool, ownerId, async client => {
    const { rows } = await client.query(
      `SELECT u.*, p.name AS property_name, p.address_line1, p.city
       FROM prop_units u
       LEFT JOIN prop_properties p ON p.id = u.property_id
       WHERE u.id = $1`,
      [unitId],
    );
    return rows[0] ?? null;
  });
  if (!unit) {
    logger.warn({ entity: 'PROPERTIES', action: 'AUTO_LIST_SKIP', unit_id: unitId, reason: 'unit not found' });
    return;
  }
  if (String(unit.listing_status) === 'LISTED') {
    logger.info({ entity: 'PROPERTIES', action: 'AUTO_LIST_SKIP', unit_id: unitId, reason: 'already listed' });
    return;
  }

  const slug = (unit.booking_slug as string | null) ??
    `${String(unit.unit_number).toLowerCase().replace(/\s+/g, '-')}-${unitId.slice(0, 8)}`;

  // Fetch photos for Facebook post
  const photoRows = await withOwnerRLS(propertiesPool, ownerId, async client => {
    const { rows } = await client.query(
      `SELECT object_key FROM prop_unit_photos WHERE unit_id = $1 ORDER BY display_order, created_at LIMIT 10`,
      [unitId],
    );
    return rows as Array<{ object_key: string }>;
  });
  const photoUrls = await Promise.all(
    photoRows.map(p => getPresignedGetUrl(BUCKET_PHOTOS, p.object_key, 604800).catch(() => null)),
  ).then(urls => urls.filter((u): u is string => u !== null));

  const fbListingId = await postToFacebook(unit as Record<string, unknown>, photoUrls);

  await withOwnerRLS(propertiesPool, ownerId, async client => {
    await client.query(
      `UPDATE prop_units
       SET listing_status = 'LISTED', listed_at = NOW(),
           facebook_listing_id = $1, facebook_listed_at = $2, booking_slug = $3
       WHERE id = $4`,
      [fbListingId, fbListingId ? new Date() : null, slug, unitId],
    );
  });

  logger.info({ entity: 'PROPERTIES', action: 'AUTO_LISTED', unit_id: unitId, user_id: ownerId, photos: photoUrls.length });

  broadcastNewListing(ownerId, unit as Record<string, unknown>, slug).catch(e =>
    logger.warn({ entity: 'PROPERTIES', action: 'WA_BROADCAST_FAILED', error_message: (e as Error).message }),
  );
}

listingRouter.post('/suggest-price', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ownerId = req.rlsCtx.userId;
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

    const geminiKey = process.env.GEMINI_API_KEY;
    if (!geminiKey) return void res.status(503).json(err('GEMINI_API_KEY not configured', 'CONFIG_ERROR'));
    const geminiModel = process.env.GEMINI_MODEL ?? 'gemini-2.0-flash';

    const prompt = `You are a Trinidad & Tobago real estate expert. Suggest a monthly rent range in TTD for this residential unit:
- Location: ${unit.address_line1 ?? 'Trinidad'}, ${unit.city ?? ''}
- Bedrooms: ${unit.bedrooms ?? 'unknown'}, Bathrooms: ${unit.bathrooms ?? 'unknown'}
- Floor area: ${unit.floor_area_sqm ?? 'unknown'} sqm
- WASA included: ${unit.wasa_included ? 'Yes' : 'No'}
- Electricity: ${unit.electricity_included ? 'included' : 'tenant pays'}
- Internet: ${unit.internet_included ? 'included' : 'tenant pays'}
${(comparables as Array<Record<string, unknown>>).length > 0
  ? `- Comparable units currently renting at: ${(comparables as Array<Record<string, unknown>>).map(c => `TTD $${c['rent_amount_ttd']}`).join(', ')}`
  : '- No comparable data available'}

Base your suggestion on current Trinidad rental market conditions.`;

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${geminiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: 'OBJECT',
              properties: {
                min_ttd:         { type: 'INTEGER' },
                max_ttd:         { type: 'INTEGER' },
                recommended_ttd: { type: 'INTEGER' },
                rationale:       { type: 'STRING' },
              },
              required: ['min_ttd', 'max_ttd', 'recommended_ttd', 'rationale'],
            },
          },
        }),
      },
    );

    if (!geminiRes.ok) {
      const body = await geminiRes.text();
      logger.error({ entity: 'PROPERTIES', action: 'GEMINI_ERROR', status: geminiRes.status, body });
      return void res.status(502).json(err('Gemini unavailable', 'UPSTREAM_ERROR'));
    }

    type GeminiResp = { candidates: Array<{ content: { parts: Array<{ text: string }> } }> };
    const geminiData = (await geminiRes.json()) as GeminiResp;
    const raw = geminiData.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

    type RentSuggestion = { min_ttd: number; max_ttd: number; recommended_ttd: number; rationale: string };
    let suggestion: RentSuggestion | null = null;
    try { suggestion = JSON.parse(raw) as RentSuggestion; } catch { /* schema enforcement means this rarely fires */ }

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

    res.json(ok(suggestion
      ? { min: suggestion.min_ttd, max: suggestion.max_ttd, recommended: suggestion.recommended_ttd, rationale: suggestion.rationale }
      : { error: 'Could not parse Gemini response', raw },
    ));
  } catch (e) { next(e); }
});

listingRouter.post('/sms-broadcast', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ownerId = req.rlsCtx.userId;
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

// ── Batch: stale listing alert ────────────────────────────────────────────────
// Exported and mounted directly at POST /properties/units/alert-stale in index.ts
// (cannot use listingRouter which requires :id prefix)
export async function handleAlertStale(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ownerId = req.rlsCtx.userId;
    if (!ownerId) return void res.status(401).json(err('Unauthorised', 'UNAUTHORIZED'));
    const staleDays = z.object({ stale_days: z.number().int().min(7).max(60).default(14) }).parse(req.body).stale_days;
    const ownerPhone = process.env.JAG_OWNER_PHONE;
    if (!ownerPhone) return void res.json(ok({ alerted: 0, reason: 'JAG_OWNER_PHONE not set' }));

    const units = await withOwnerRLS(propertiesPool, ownerId, async client => {
      const { rows: r } = await client.query<Record<string, unknown>>(
        `SELECT u.id, u.unit_number, u.listed_at,
                p.name AS property_name, p.address_line1,
                (CURRENT_DATE - u.listed_at::date)::int AS days_listed,
                COUNT(v.id) AS viewing_count
         FROM prop_units u
         LEFT JOIN prop_properties p ON p.id = u.property_id
         LEFT JOIN prop_viewings v ON v.unit_id = u.id
         WHERE u.owner_id = $1
           AND u.listing_status = 'LISTED'
           AND u.listed_at IS NOT NULL
           AND u.listed_at < NOW() - ($2 || ' days')::INTERVAL
           AND (u.stale_alert_sent_at IS NULL OR u.stale_alert_sent_at < NOW() - INTERVAL '7 days')
         GROUP BY u.id, p.name, p.address_line1`,
        [ownerId, staleDays],
      );
      return r;
    });

    let alerted = 0;
    for (const unit of units) {
      try {
        await sendTemplate({
          to: ownerPhone,
          templateName: 'jag_adv_stale_alert',
          components: [{ type: 'body', parameters: [
            { type: 'text', text: String(unit['property_name'] ?? '') },
            { type: 'text', text: String(unit['unit_number'] ?? '') },
            { type: 'text', text: String(unit['days_listed'] ?? staleDays) },
            { type: 'text', text: String(unit['viewing_count'] ?? 0) },
          ]}],
        });
        await withOwnerRLS(propertiesPool, ownerId, async client => {
          await client.query(
            `UPDATE prop_units SET stale_alert_sent_at = NOW() WHERE id = $1`, [unit['id']],
          );
        });
        alerted++;
      } catch { /* per-unit failure is non-fatal */ }
    }

    logger.info({ entity: 'PROPERTIES', action: 'STALE_LISTING_ALERTED', alerted, severity: 'INFO' });
    res.json(ok({ alerted }));
  } catch (e) { next(e); }
}

listingRouter.post('/unlist', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ownerId = req.rlsCtx.userId;
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

// ── Photo schemas ─────────────────────────────────────────────────────────────
const PhotoIdParam   = z.object({ id: z.string().uuid(), photoId: z.string().uuid() });
const ConfirmSchema  = z.object({ object_key: z.string().min(1), caption: z.string().max(200).optional(), display_order: z.number().int().optional() }).strict();
const ListingInfoSchema = z.object({
  listing_description:   z.string().max(2000).nullable().optional(),
  wasa_included:         z.boolean().optional(),
  electricity_included:  z.boolean().optional(),
  internet_included:     z.boolean().optional(),
  rent_amount:           z.number().positive().optional(),
}).strict();

// GET /properties/units/:id/photos
listingRouter.get('/photos', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ownerId = req.rlsCtx.userId;
    if (!ownerId) return void res.status(401).json(err('Unauthorised', 'UNAUTHORIZED'));
    const { id } = IdParam.parse(req.params);

    const photos = await withOwnerRLS(propertiesPool, ownerId, async client => {
      const { rows } = await client.query(
        `SELECT id, object_key, display_order, caption, created_at
         FROM prop_unit_photos WHERE unit_id = $1 AND owner_id = $2
         ORDER BY display_order, created_at`,
        [id, ownerId],
      );
      return rows;
    });

    // Attach short-lived presigned GET URLs
    const withUrls = await Promise.all(
      (photos as Array<Record<string, unknown>>).map(async p => ({
        ...p,
        url: await getPresignedGetUrl(BUCKET_PHOTOS, String(p['object_key']), 3600),
      })),
    );
    res.json(ok(withUrls));
  } catch (e) { next(e); }
});

// POST /properties/units/:id/photos/upload-url — returns a presigned PUT URL
listingRouter.post('/photos/upload-url', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ownerId = req.rlsCtx.userId;
    if (!ownerId) return void res.status(401).json(err('Unauthorised', 'UNAUTHORIZED'));
    const { id } = IdParam.parse(req.params);
    const { filename } = z.object({ filename: z.string().min(1) }).parse(req.body);

    // Confirm unit belongs to owner
    const exists = await withOwnerRLS(propertiesPool, ownerId, async client => {
      const { rows } = await client.query(`SELECT id FROM prop_units WHERE id = $1`, [id]);
      return rows.length > 0;
    });
    if (!exists) return void res.status(404).json(err('Unit not found', 'NOT_FOUND'));

    const key = mediaObjectKey(ownerId, 'listings', id, filename);
    const upload_url = await getPresignedPutUrl(BUCKET_PHOTOS, key, 900);
    res.json(ok({ upload_url, object_key: key }));
  } catch (e) { next(e); }
});

// POST /properties/units/:id/photos — confirm upload, save record
listingRouter.post('/photos', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ownerId = req.rlsCtx.userId;
    if (!ownerId) return void res.status(401).json(err('Unauthorised', 'UNAUTHORIZED'));
    const { id } = IdParam.parse(req.params);
    const body = ConfirmSchema.parse(req.body);

    const row = await withOwnerRLS(propertiesPool, ownerId, async client => {
      const { rows } = await client.query(
        `INSERT INTO prop_unit_photos (owner_id, unit_id, object_key, display_order, caption)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [ownerId, id, body.object_key, body.display_order ?? 0, body.caption ?? null],
      );
      return rows[0];
    });
    logger.info({ entity: 'PROPERTIES', action: 'PHOTO_ADDED', unit_id: id, user_id: ownerId });
    res.status(201).json(ok(row));
  } catch (e) { next(e); }
});

// DELETE /properties/units/:id/photos/:photoId
listingRouter.delete('/photos/:photoId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ownerId = req.rlsCtx.userId;
    if (!ownerId) return void res.status(401).json(err('Unauthorised', 'UNAUTHORIZED'));
    const { id, photoId } = PhotoIdParam.parse(req.params);

    const photo = await withOwnerRLS(propertiesPool, ownerId, async client => {
      const { rows } = await client.query(
        `DELETE FROM prop_unit_photos WHERE id = $1 AND unit_id = $2 AND owner_id = $3 RETURNING object_key`,
        [photoId, id, ownerId],
      );
      return rows[0] ?? null;
    });
    if (!photo) return void res.status(404).json(err('Photo not found', 'NOT_FOUND'));

    await deleteObject(BUCKET_PHOTOS, String(photo.object_key)).catch(e =>
      logger.warn({ entity: 'PROPERTIES', action: 'PHOTO_MINIO_DELETE_FAILED', error_message: (e as Error).message }),
    );
    res.json(ok({ deleted: true }));
  } catch (e) { next(e); }
});

// PATCH /properties/units/:id/listing-info — update description + utilities
listingRouter.patch('/listing-info', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ownerId = req.rlsCtx.userId;
    if (!ownerId) return void res.status(401).json(err('Unauthorised', 'UNAUTHORIZED'));
    const { id } = IdParam.parse(req.params);
    const body = ListingInfoSchema.parse(req.body);
    if (Object.keys(body).length === 0) return void res.status(400).json(err('No fields to update', 'VALIDATION_ERROR'));

    const sets: string[] = [];
    const vals: unknown[] = [];
    for (const [k, v] of Object.entries(body)) {
      vals.push(v); sets.push(`${k} = $${vals.length}`);
    }
    vals.push(id); vals.push(ownerId);

    const row = await withOwnerRLS(propertiesPool, ownerId, async client => {
      const { rows } = await client.query(
        `UPDATE prop_units SET ${sets.join(', ')} WHERE id = $${vals.length - 1} RETURNING *`,
        vals,
      );
      return rows[0] ?? null;
    });
    if (!row) return void res.status(404).json(err('Unit not found', 'NOT_FOUND'));
    res.json(ok(row));
  } catch (e) { next(e); }
});
