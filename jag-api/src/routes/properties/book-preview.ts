// GET /book/:slug — crawler-facing Open Graph preview for a listing's booking link.
//
// jag-web is a static SPA — a plain index.html can't carry per-listing meta tags,
// so every shared booking link previewed with the same generic "JAG Properties —
// For Rent" card (see jag-web/index.html) no matter which unit it pointed to.
// Facebook/WhatsApp/etc. crawlers don't execute JS, so there's no way to fix this
// client-side; the server has to hand crawlers different HTML than real visitors.
//
// Caddy (see jag-infra/caddy/Caddyfile) matches known crawler User-Agents on
// /book/* and reverse-proxies ONLY those requests here — real browsers still hit
// the normal SPA catch-all and load the full booking/viewing-request page as
// before. This route never needs to know about Vite's hashed asset filenames
// because it never serves the app itself, only a meta-tag stub for crawlers.
import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { withOwnerRLS } from '../../middleware/rls';
import { propertiesPool } from '../../db/index';
import { BUCKET_PHOTOS, getPresignedGetUrl } from '../../lib/minio';

export const bookPreviewRouter = Router();

const PUBLIC_LISTING_OWNER_ID =
  process.env['NOTIFY_OWNER_USER_ID'] ?? '95ca3f77-60ba-4a0f-af70-2832b247b525';

const SlugParam = z.object({ slug: z.string().min(1) });

const FALLBACK_IMAGE = 'https://jagcorporate.com/jag-logo-share.png';
// Crawlers cache the scraped og:image for a while and may re-fetch it days
// later — a short-lived presigned URL would 403 by then. 7 days matches the
// TTL already used elsewhere for Facebook-facing photo URLs (listing.ts).
const IMAGE_TTL_SECONDS = 7 * 24 * 60 * 60;

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderPreviewHtml(opts: { title: string; description: string; image: string; url: string }): string {
  const { title, description, image, url } = opts;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<meta property="og:site_name" content="JAG Properties" />
<meta property="og:title" content="${escapeHtml(title)}" />
<meta property="og:description" content="${escapeHtml(description)}" />
<meta property="og:image" content="${escapeHtml(image)}" />
<meta property="og:type" content="website" />
<meta property="og:url" content="${escapeHtml(url)}" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:image" content="${escapeHtml(image)}" />
</head>
<body>
<p>${escapeHtml(title)} — ${escapeHtml(description)}</p>
<p><a href="${escapeHtml(url)}">View listing</a></p>
</body>
</html>`;
}

bookPreviewRouter.get('/:slug', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { slug } = SlugParam.parse(req.params);
    const url = `https://jagcorporate.com/book/${slug}`;

    const unit = await withOwnerRLS(propertiesPool, PUBLIC_LISTING_OWNER_ID, async client => {
      const { rows } = await client.query(
        `SELECT u.bedrooms, u.rent_amount, u.listing_description, p.city
         FROM prop_units u
         LEFT JOIN prop_properties p ON p.id = u.property_id
         WHERE u.booking_slug = $1 AND u.listing_status = 'LISTED'`,
        [slug],
      );
      return rows[0] ?? null;
    });

    if (!unit) {
      // Unlisted/unknown slug — generic card rather than a broken crawler fetch.
      res.set('Content-Type', 'text/html; charset=utf-8');
      res.send(renderPreviewHtml({
        title: 'JAG Properties — For Rent',
        description: 'Quality rental spaces in Trinidad & Tobago.',
        image: FALLBACK_IMAGE,
        url,
      }));
      return;
    }

    const rent = parseFloat(String(unit.rent_amount ?? 0));
    const beds = unit.bedrooms ?? '?';
    // City only — no exact street address in anything crawler-facing or public.
    const title = `$${rent.toLocaleString('en-US')}/mo · ${beds}BR Apartment — ${unit.city ?? 'Trinidad'}`;
    const description = String(unit.listing_description ?? '')
      .replace(/\n\s*\n/g, ' — ')   // paragraph breaks (e.g. heading -> body) become a visible separator
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 160);

    const photoRow = await withOwnerRLS(propertiesPool, PUBLIC_LISTING_OWNER_ID, async client => {
      const { rows } = await client.query(
        `SELECT object_key FROM prop_unit_photos
         WHERE unit_id = (SELECT id FROM prop_units WHERE booking_slug = $1)
         ORDER BY display_order, created_at LIMIT 1`,
        [slug],
      );
      return rows[0] ?? null;
    });
    const image = photoRow
      ? await getPresignedGetUrl(BUCKET_PHOTOS, photoRow.object_key, IMAGE_TTL_SECONDS).catch(() => FALLBACK_IMAGE)
      : FALLBACK_IMAGE;

    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(renderPreviewHtml({ title, description: description || 'Quality rental spaces in Trinidad & Tobago.', image, url }));
  } catch (e) { next(e); }
});
