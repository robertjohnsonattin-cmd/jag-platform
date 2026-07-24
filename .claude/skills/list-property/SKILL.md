---
name: list-property
description: End-to-end workflow for listing a property/apartment unit for rent on the JAG platform — verify the unit record, research and set rent/description/utilities, prep photos, generate a branded one-page PDF flyer, confirm the listing is live, and draft a Facebook post for Robert's personal profile. Use when the user wants to list, advertise, or put out for rent a unit/apartment, or asks for a flyer/advertisement for a property.
---

# List a property for rent (JAG Properties)

Full workflow developed while listing Apt A, 4 Skinner Terrace, Diego Martin (2026-07-24). Covers everything from "I want to rent this unit" to a finished flyer + Facebook post draft, in the order it actually happens in practice.

## Step 1 — Identify and verify the unit record

Ask for (or confirm) the exact address and unit — voice-to-text garbles Trinidad street/area names often (e.g. "skin uterus liver Martin" → "Skinner Terrace, Diego Martin"), so read it back for confirmation before searching.

Look up the property and unit directly in the database rather than guessing — never assume a unit exists or is empty:

```bash
ssh -i ~/.ssh/jag_oracle2 ubuntu@150.136.151.64 "sudo -u postgres psql -d jag_properties -c \"SELECT id, name, address_line1, city FROM prop_properties WHERE address_line1 ILIKE '%<street>%';\""
ssh -i ~/.ssh/jag_oracle2 ubuntu@150.136.151.64 "sudo -u postgres psql -d jag_properties -c \"SELECT id, unit_number, listing_status, listing_description, rent_amount, is_rented, booking_slug, bedrooms, bathrooms, floor_area_sqft, wasa_included, electricity_included, internet_included FROM prop_units WHERE property_id = '<property_id>';\""
```

Report back what already exists (unit status, whether description/rent/photos are already filled in) before doing anything else — the user may have already done some of this manually.

## Step 2 — Photos

If the user has photos to prep (HEIC conversion, downscaling, brightness), **use the `prep-listing-photos` skill** — don't duplicate that logic here.

**Photo editing requests need one check first:** if the user shares a "cleaned up" or "edited" version of a photo (e.g. removing a person from a mirror reflection) and the filename suggests AI generation (`Gemini_Generated_...`, etc.), ask directly whether it's a faithful photo edit or an AI-recreated image before using it in a real listing — a substantially AI-generated image used to advertise the actual physical unit could misrepresent the property to prospective tenants. Take the user's answer at face value once asked.

**Bathroom photos specifically:** a close-up of a single fixture (especially the toilet, doubly so if a plunger/brush is visible) reads poorly in a flyer. If a wide/panoramic shot of the same bathroom exists, crop it to show sink + shower + toilet together in one frame — this reads as a complete, well-lit room instead of "here is a toilet." Sample crop (adjust fractions to center the fixtures):

```python
from PIL import Image
p = Image.open(r"panorama.png").convert("RGB")
w, h = p.size
crop = p.crop((int(w*0.43), 0, int(w*0.91), h))
crop.save(r"bathroom_crop.jpg", quality=92)
```

## Step 3 — Rent, description, and utilities

Ask the user for: bedrooms/bathrooms count, room dimensions (they'll often give them as "6x12" per room — sum the rooms for a total `floor_area_sqft`), what's included (water/electricity/internet), any notable features (gated, parking, quiet street — and get the *specifics* right, e.g. "fenced yard with a gate" is not the same marketing claim as "gated community," and "off-street parking" is not "covered parking" — don't upgrade the claim past what's true), and their target rent figure.

**Do market research before finalizing rent** — `WebSearch` for comparable rentals in the same area (bedroom count, gated/parking, furnished vs unfurnished). Give a specific recommendation with reasoning, not just a range, and explicitly weigh "get it rented fast" vs "maximize monthly rent" if the user seems torn — with many vacant units, fast turnover usually wins. Use `AskUserQuestion` to let them pick the final number rather than deciding for them.

Write the description in the same format the platform already uses (see any existing `listing_description` you pulled in Step 1 for the house style) — a bold heading line, a marketing paragraph, a utilities/responsibility line, a "Size" breakdown by room, and a WhatsApp contact line. Example heading format: `Bright and airy, unfurnished 1-bedroom apartment...`

**Update the unit record directly via SQL** (raw UPDATE for data content, not schema — this is normal and matches how corrections are made elsewhere on this platform) if the user has already entered some fields through the app UI and just needs a fix (e.g. missing heading, wrong wording) — no need to make them re-open the modal for a one-line text fix. For a brand-new listing, point them to Properties → [property] → Units → [unit] → Manage Listing to enter photos/description/rent/utilities themselves (that's also where photos actually upload to MinIO — this skill doesn't do that part).

## Step 4 — The flyer

Use `build_flyer.py` in this skill folder — a complete, parameterized HTML→PDF generator using Playwright (renders real vector text via headless Chromium, not a rasterized screenshot). Copy it out, edit the `CONFIG` block at the top (photo paths, price, stats, description, checklist, location, booking URL), and run it.

**Design decisions already made for you (don't re-litigate unless asked):**
- **Navy + gold theme** (`THEME_NAVY_GOLD`, extracted from the real `jag-logo.png`: navy `#0A2946`, gold `#A67942`) is the standing choice over green — established 2026-07-24 specifically to keep every flyer visually consistent with the actual JAG brand/logo/app, not an arbitrary pick. Only use `THEME_GREEN` if the user explicitly asks for it.
- Layout is a hybrid: warm cream background + bold colored bands (borrowed from an earlier green-themed flyer that read as more "real marketing" than a plain spec sheet) **plus** a QR code linking to the booking page (cleaner than making people type a URL) **plus** the actual JAG logo (missing from every prior flyer attempt — always include it).
- Stat box icons are flat inline SVGs (`ICONS` dict in the script), not emoji — emoji rendered as wrong/monochrome glyphs inconsistently across environments when tried.
- The CTA footer shows **two contact options**: `WHATSAPP_NUMBER` to message/book, and `CALL_NUMBER` for prospects who'd rather talk to someone directly (learned 2026-07-24 — don't word the WhatsApp line as "please don't call," some people genuinely prefer calling). Keep both.
- Don't name the specific unit letter/number in the flyer headline or address line unless the user asks for it (e.g. "1-Bedroom Apartment" / "Skinner Terrace, Diego Martin" rather than "Apartment A" / "4 Skinner Terrace") — some owners deliberately keep exact unit and street number private until viewing.
- **Portrait source photos in the 3-photo strip get badly cropped.** The strip cells are wide and short (`.photo-strip .ph`, roughly 2.3:1 landscape). `object-fit: cover` center-crops whatever you feed it, so a tall phone photo (e.g. 1200×1600 portrait) gets almost all its height sliced off — usually cutting the actual subject (a doorway, a ceiling fixture) and leaving a bland strip of blank wall. Found 2026-07-24 on Apt C1's bedroom photo. **Fix:** don't rely on the CSS crop for portrait sources — pre-crop the photo yourself with PIL to roughly the cell's aspect ratio, deliberately choosing the vertical band that keeps the room's defining feature (a doorway, window, furniture) in frame, then feed that crop in. Same technique as the bathroom-panorama crop in Step 2 — view the candidate crop before committing, don't guess blind.

**Fitting to one page:** the template is already tuned to fit US Letter in one page for a "hero image + 4 stats + description + 4-item checklist + 3-photo strip + location box + CTA footer" layout. If you add content (an extra checklist bullet, longer description, a bigger hero), it can overflow to page 2 — check with:

```python
import fitz
doc = fitz.open(OUT_PDF)
print('pages', len(doc))  # must be 1
```

If it's 2 pages, shave vertical space in this order (each is a small fix, don't overcorrect): hero image height, `.photo-strip .ph` height, section-head/checklist margins, CTA padding. Rebuild and recheck after each change rather than guessing the total needed.

**File locks:** if `page.pdf(path=...)` throws `PermissionError`, the output file is almost certainly still open in a PDF viewer from a prior send — write to a `_v2` filename, tell the user which file is locked, and offer to rename once they close it.

## Step 5 — Confirm the listing is actually live

Check `listing_status` in the DB — don't assume you need to trigger it. The platform's "list unit" action (`POST /properties/units/:id/list` in `routes/properties/listing.ts`) does three real things and can have live side effects:

1. **Posts to Facebook Marketplace** via Graph API — but only if `FACEBOOK_PAGE_ID`/`FACEBOOK_PAGE_ACCESS_TOKEN` are set in the VM `.env` (as of 2026-07-24 they are **not**, and this is intentional — see below). Verify with `ssh ... "grep -i FACEBOOK_PAGE /opt/jag/jag-infra/.env"` before assuming either way.
2. **Sends a WhatsApp broadcast** to every past enquirer for that *property* (not just the unit) — count real recipients first: `SELECT count(DISTINCT e.prospect_phone) FROM prop_enquiries e JOIN prop_units u ON u.id=e.unit_id WHERE u.property_id = '<id>' AND e.prospect_phone IS NOT NULL;`. If non-zero, this is a real message to real people — confirm with the user before triggering the full endpoint, same as any other "send a message on the user's behalf" action.
3. **Regenerates `booking_slug`** deterministically as `{unit_number}-{id.slice(0,8)}` — if you previously cache-busted the slug (see the WhatsApp/Facebook link-preview-caching note below), calling the full list endpoint will silently revert it back to the old, already-cached slug. If you just need to flip `listing_status`/`listed_at` and there's no real broadcast/Facebook risk, it's fine to set those two columns directly via SQL and leave `booking_slug` untouched.

**Facebook Marketplace note (learned 2026-07-24):** Marketplace listings can only be posted from an *individual's personal profile*, not a business Page — "JAG Properties" as a Page cannot post Marketplace listings at all. This is why the Graph API integration is deliberately left unconfigured; it's not a gap to fix. Robert posts manually from his personal profile instead — see Step 6.

## Step 6 — Facebook post draft (personal profile)

Since Marketplace posting has to go through Robert's personal profile, draft ready-to-paste post text in a **casual, first-person voice** — not flyer/business copy. Pull the same facts (rent, bed/bath, utilities, features, contact) but write it the way a person posts about their own rental, with a few emoji and a couple of relevant hashtags (area name, city, "for rent"). Include a suggested photo order (hero/living shot first, then bedroom, bathroom, kitchen). Give it in a plain code block so it copy-pastes cleanly with no markdown artifacts.

## Link-preview caching gotcha (relevant if you ever regenerate a booking slug)

WhatsApp and Facebook cache scraped Open Graph previews **per exact URL**, and their caches are **separate from each other** despite both being Meta products — fixing one does not fix the other. If a booking link was ever shared before a description/preview bug was fixed, the old broken preview can stay cached indefinitely. The reliable fix is a **brand-new booking slug** (no crawler has seen it yet, so first scrape is guaranteed fresh) — not a `?v=2` query-string hack, which works but reads as messier in a shared link. Generate a fresh slug directly in SQL if needed:

```sql
UPDATE prop_units SET booking_slug = 'apt-a-' || substr(md5(random()::text || clock_timestamp()::text), 1, 8)
WHERE id = '<unit_id>' RETURNING booking_slug;
```

Verify the fix with a real crawler user-agent before telling the user it's fixed:
```bash
curl -s -A "WhatsApp/2.23.20.0" https://jagcorporate.com/book/<slug> | grep -i "og:title\|og:description"
```
