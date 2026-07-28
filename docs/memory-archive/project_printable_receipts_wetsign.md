---
name: project-printable-receipts-wetsign
description: "Non-WhatsApp tenant document workflow — fixed broken receipt print links, added missing print buttons, added wet-sign lease upload/download; landlord identity fix on all receipts"
metadata:
  node_type: memory
  type: project
  originSessionId: 2a2ff520-2da0-4ab8-99cf-20685c422028
---

Session 40 (2026-07-11), triggered by Robert asking "how do I print receipts/leases for tenants who don't use WhatsApp — what's the workflow."

**Findings before fixing:**
- Lease agreement PDF (`lib/lease-pdf.ts`) already worked and already named Robert Johnson-Attin as Landlord (not JAG Properties as an entity) — no change needed. Download button existed and worked.
- Rent receipt "Receipt" link in the Rent Schedule was a bare `<a href="/api/v1/...">` to an auth-gated endpoint — silently 401'd, because a browser-native link navigation carries no Bearer token. Nobody had noticed because nobody had tried printing a rent receipt from the app before. See [[feedback-authed-streaming-assets]] — same bug class, this time on a "view/print HTML" endpoint rather than an image/download.
- Deposit receipt had a working backend endpoint (`GET /properties/deposits/:id/receipt`) but **zero UI** — no button existed anywhere to reach it.
- The WhatsApp Receipt modal (System B — copy/share text) had no print option at all.
- There was no way to record that a lease had been wet-signed on paper — Documenso e-signature was the only "signed" path, even though `signed_pdf_object_key`/`signature_status`/`agreement_signed_at` columns already existed on `prop_lease_agreements` (migration 043) for exactly this purpose, unused.

**Fixed, same session, deployed + committed (`c70de3c`):**
- New `api.openHtml(path)` helper in `jag-web/src/api/client.ts` — opens a blank tab synchronously (avoids popup blocker), fetches with the Bearer token, navigates the tab to the blob URL. Use this pattern for any "view/print" (not download-with-filename) auth-gated HTML/PDF endpoint.
- Rent Schedule "Receipt" link → `api.openHtml`, now actually opens.
- Deposits panel gained a "Print receipt" button.
- WhatsApp Receipt modal gained a "Print / PDF" button — client-rendered HTML (that endpoint returns JSON not HTML, so there's no server route to hit; the printable markup is generated in the component).
- New backend: `POST /properties/:id/leases/:id/upload-signed` (multer memory storage + MinIO put, marks lease `SIGNED`, stamps `agreement_signed_at`) and `GET /properties/:id/leases/:id/signed-pdf` (download the stored scan). Leases UI: "Upload signed" file picker + "Signed copy" download button (shown once signed).

**The actual answer to "what's the workflow":** download the lease PDF → print → both parties wet-sign on paper → scan → use the new "Upload signed" button on that lease (stores the scan in MinIO, marks the lease SIGNED). Rent and deposit receipts now print via the fixed/added buttons in their respective panels.

**Landlord identity fix (same session):** Robert clarified tenancies/receipts are with him personally, not "JAG Properties" as a company. Rent + deposit receipt HTML/text/WhatsApp templates all gained a "Landlord: Robert Johnson-Attin" line while keeping the JAG Properties brand header. See [[project-whatsapp-business-registration]] for the template-recreation detail (hit the same delete-name-lock bug again — `jag_rent_receipt_full_v2` / `jag_onb_deposit_receipt_v2`).

**How to apply:** any future "print/view a document" feature in this codebase should default to `api.openHtml()` rather than a bare `<a href>` — that mistake has now recurred at least twice (photos/downloads in session 26, this rent receipt in session 40). Check new print/view links against this pattern in review.
