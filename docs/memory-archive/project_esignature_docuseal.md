---
name: project-esignature-docuseal
description: "SUPERSEDED by [[project-esignature-documenso]] — DocuSeal was abandoned after its free edition turned out to be Pro-gated; kept for historical reference only"
metadata: 
  node_type: memory
  type: project
  originSessionId: aa22890e-2b4d-49df-a76d-736376dfae73
---

**SUPERSEDED 2026-07-08 (session 39) — see [[project-esignature-documenso]] for the current, live integration.** DocuSeal was replaced entirely; nothing below reflects the current system. Kept only as a record of what was tried and why it didn't work.

Session 38 (2026-07-07) built a complete self-hosted e-signature integration so tenants can sign the Tenancy Agreement (with Schedule C made fillable) and Schedule B move-in/move-out condition checklists digitally, via magic links (no tenant account/login — matches the WhatsApp-first, no-tenant-portal pattern used everywhere else in the platform).

**Tool chosen:** DocuSeal (self-hosted, `docuseal/docuseal` Docker image), for Postgres-only stack fit.

**What was built and verified working end-to-end, up to the actual signing step:**
- `docuseal` Docker service + `sign.jagcorporate.com` Caddy block + Cloudflare DNS A record + native Postgres role/DB (same pattern as Traccar).
- Migration `043_esignature.sql` (jag_properties): `docuseal_submission_id`/`signature_status`/`signed_pdf_object_key`/`agreement_signed_at` on `prop_lease_agreements`; `docuseal_submission_id`/`signed_pdf_object_key` on `prop_handover_checklists`.
- `jag-api/src/lib/docuseal.ts` — `createSigningSubmission()`/`getSubmission()`/`downloadSignedPdf()`.
- `jag-api/src/routes/internal/docuseal-webhook.ts` — receives `submission.completed`, downloads signed PDF, stores in new MinIO bucket `jag-signed-documents`, updates the lease/handover row via `withOwnerRLS`.
- `jag-api/src/lib/condition-report-pdf.ts` — standalone Schedule-B-style PDF for handover condition reports.
- Lease PDF (`lib/lease-pdf.ts`) field-tracking so DocuSeal field coordinates line up with Schedule C.
- Frontend: signature-status badge + "Send for Signature" in `PropertiesPanel.tsx`; embedded iframe signing flow in `PropertiesHandoverPanel.tsx`.

**BLOCKING DISCOVERY (found only during the live test):** DocuSeal's self-hosted **free/Community edition has no API for creating a submission from a raw PDF** — both `POST /api/submissions/pdf` and `POST /api/templates/pdf` return `404 "This feature is available in Pro Edition"`. All the infra/webhook/PDF plumbing works; only the actual submission-creation call is gated. This invalidates the core mechanism the integration was built around.

**Why this matters:** confirm a vendor's self-hosted "free" tier actually includes the API surface you need *before* building the full integration around it — DocuSeal's docs describe the submissions-from-PDF endpoint without flagging it as Pro-only; the gate was only discovered by hitting the real 404 in production testing.

**Decision pending from Robert** — three options, none yet chosen:
1. Upgrade to DocuSeal Pro (paid) — no rework needed, everything already built stays as-is.
2. Manual per-lease/checklist PDF upload + field placement inside DocuSeal's own dashboard UI (not yet verified whether this path is also Pro-gated).
3. Switch to a different self-hosted e-sign tool with a genuinely free API-driven submission-creation tier (needs fresh research — nothing evaluated yet).

**Incidental fixes made en route (both deployed, unrelated to the blocker):**
- `parseYMD()` in `lease-pdf.ts` / `condition-report-pdf.ts` crashed (`iso.slice is not a function`) — node-postgres returns DATE/TIMESTAMPTZ columns as native `Date` objects (not ISO strings) when no custom type parser is configured, unlike the rest of the codebase which mostly only ever sees JSON-API ISO-string shapes. Fixed to accept `string | Date`, using UTC getters (never local — Trinidad is UTC-4) for the Date branch. Commit `b190e19`. See [[feedback-date-display-timezone-bug]] for the related (but distinct) display-side version of this bug class.
- `sendTemplate()` → `sendText()` swap in the lease send-for-signing route, to allow live testing with a real WhatsApp number without a Meta-approved template. **Must be reverted to `sendTemplate('jag_lease_signing_request', ...)` once that template exists and is Meta-approved** — `sendText` only works inside a 24h customer-service session window, unsuitable for production. Commit `3a473d9`.

**Test artifacts left in the live system (not cleaned up):**
- Tenant "Marcus Ramkissoon" (`37167abc-11a1-4ae1-a41b-0193a521abc2`) — `phone` field overwritten from its placeholder to a real test number (`18682912787`).
- A test lease for that tenant, 45 Eleventh Street Unit "Apt B", 01/07/2026–30/06/2027, $2,700/mo rent+deposit — `signature_status` still `UNSIGNED`, no `docuseal_submission_id` was ever persisted (both send-for-signing attempts failed before reaching that point).

**How to apply:** don't resume the live test or build further on this until Robert picks one of the three options above. If Pro is chosen, no code changes needed — just the DocuSeal license upgrade + re-test. If switching tools, treat this whole integration as a reference design (magic-link pattern, webhook pattern, field-tracking pattern) rather than throwaway work — most of it (webhook shape, PDF generation, frontend UI) is DocuSeal-agnostic and can likely be ported.
