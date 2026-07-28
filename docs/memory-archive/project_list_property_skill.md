---
name: project-list-property-skill
description: Standardized end-to-end property listing workflow — Apt A (4 Skinner Terrace) was the first listing built this way; captured as the list-property Claude skill for all future listings
metadata: 
  node_type: memory
  type: project
  originSessionId: 9d8b4fb0-e8b2-41d4-953b-a2d2c9b792e0
  modified: 2026-07-24T22:47:56.404Z
---

Built and used a full listing workflow for Apt A (4 Skinner Terrace, Diego Martin) — 1BR, $2,800 TTD/month, WASA included — then re-applied the same standard to Apt C1 (45 Eleventh Street, Barataria) for consistency. Captured as the `list-property` Claude skill (`.claude/skills/list-property/SKILL.md` + `build_flyer.py`) so every future listing follows the same process instead of reinventing it.

**Standing decisions made this session (don't re-litigate without reason):**
- **Flyer color theme is navy + gold**, extracted directly from `jag-logo.png` (`#0A2946` navy, `#A67942` gold) — not the green used on the original one-off Apt C1 flyer. Chosen for brand consistency across every listing/app surface, not arbitrary preference.
- **CTA footer always shows two contact numbers** — `868-277-3726` (WhatsApp, for messaging/booking) and `868-753-2637` (call, for prospects who'd rather talk to someone). Learned this session that wording it as "WhatsApp only, please don't call" was actively turning away callers. Applied to both flyers' CTA blocks *and* both units' `listing_description` DB text (the public booking page renders `listing_description` verbatim, so the same phone-number update had to land in two places: the flyer PDF and the DB text).
- **Never name the exact unit letter or street number** in flyer headline/address unless explicitly asked — "1-Bedroom Apartment" / "Skinner Terrace, Diego Martin", not "Apartment A" / "4 Skinner Terrace". Exact address is disclosed at viewing only.
- **Facebook Marketplace can't be posted from JAG Properties' Page** — see [[project-facebook-marketplace-personal-profile]]. Flyers include a QR code + booking link instead, and a separate casual-voice post draft is prepared for Robert's personal profile.

**Two bugs found and fixed while building the first listing (both live in production now):**
1. **`book-preview.ts` (crawler-facing WhatsApp/Facebook link preview) collapsed the heading and body of `listing_description` into one unbroken string** — `.replace(/\s+/g, ' ')` ate the blank line between them, so shared links showed "HeadlineBody text..." with no separator. Fixed by turning paragraph breaks into an em-dash separator before the whitespace collapse. Deployed (commit `fddd1a7`).
2. **Unit photo upload only ever accepted one file at a time** across all four upload surfaces on the platform (Properties unit photos, IMS item photos, vehicle photos, DocVault). Added `multiple` + a sequential upload loop to all four. Deployed (commits `bffee7d`, `416af87`, `45f1014`).

**Gotcha for future listings — portrait photos in the photo-strip:** the 3-photo "closer look" strip cells are wide/short (~2.3:1). Feeding a portrait phone photo (e.g. 1200×1600) lets CSS `object-fit: cover` blind-center-crop it, usually slicing off the actual subject (a doorway, a light fixture) and leaving a bland wall. Fix is to pre-crop the photo yourself with PIL to the cell's rough aspect ratio, deliberately keeping the room's defining feature in frame, and view the crop before committing — same technique as the bathroom-panorama crop.

**Link-preview caching gotcha:** WhatsApp and Facebook cache scraped OG previews per-exact-URL, and their caches are separate from each other despite both being Meta products. If a booking link was ever shared before a preview bug was fixed, the stale broken card can persist indefinitely. The reliable fix is a **brand-new `booking_slug`** (guaranteed fresh scrape), not a `?v=2` query hack — cleaner for a link that'll be printed/shared repeatedly. See `list-property` SKILL.md for the exact SQL + crawler-verification curl command.
