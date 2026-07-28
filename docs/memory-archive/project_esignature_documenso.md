---
name: project-esignature-documenso
description: "Self-hosted Documenso e-signature integration for lease/handover magic-link signing — replaces DocuSeal, deployed and live; WhatsApp delivery confirmation pending Meta propagation"
metadata: 
  node_type: memory
  type: project
  originSessionId: 2a2ff520-2da0-4ab8-99cf-20685c422028
---

Session 39 (2026-07-08) replaced the blocked DocuSeal integration (see [[project-esignature-docuseal]]) with **Documenso**, a self-hosted open-source e-signature platform (AGPL-3.0). Same magic-link pattern: tenants/landlord sign via a `/sign/<token>` link, no account/login needed.

**Why DocuSeal was abandoned:** its free self-hosted edition 404'd "Pro Edition" on create-submission-from-PDF (confirmed session 38).

**Verification before rebuilding:** ran a live smoke test against a throwaway self-hosted Documenso instance on the production VM (isolated docker-compose stack, spare port, cleaned up after) — create-from-PDF → recipient → field → distribute all worked on the free Community Edition with no license gate. Only committed to the full rebuild after confirming this live, not from reading docs alone (the DocuSeal mistake was trusting documentation over a real API call).

**What was built:**
- `jag-api/src/lib/documenso.ts` (replaces `lib/docuseal.ts`) — same `createSigningSubmission()`/`getSubmission()`/`downloadSignedPdf()` shape, so callers (`properties.ts`, `handover.ts`) needed minimal changes. Internally bridges Documenso's different data model: fields attach to a numeric `recipientId` (not a free-text role) resolved after document creation; field coordinates are 0-100 percentages (not 0-1 fractions); every recipient needs an email (synthesized for phone-only tenants).
- `jag-api/src/routes/internal/documenso-webhook.ts` (replaces `docuseal-webhook.ts`) — uses a proper `X-Documenso-Secret` header + `timingSafeEqual`, since Documenso supports per-webhook secrets (DocuSeal's self-hosted UI only offered a plain URL, forcing a token-in-path workaround). **Real trigger name is lowercase `document.completed`**, not `DOCUMENT_COMPLETED` as prose docs implied — confirmed via the live Webhooks UI trigger dropdown, not assumed from documentation.
- Migration `044_documenso_columns.sql` (jag_properties) — additive, adds `documenso_document_id` to `prop_lease_agreements`/`prop_handover_checklists`; old `docuseal_submission_id` columns from `043_esignature.sql` left in place, dead/unused (never populated — the DocuSeal send-for-signing call always failed before reaching that point).
- Infra: `documenso` Docker service, own native-PG database + role (`documenso_app`, same pattern as Traccar), reverse-proxied at the same `sign.jagcorporate.com` subdomain the old DocuSeal service used — no DNS change needed, just the Caddy `reverse_proxy` target. `DOCUMENSO_DISABLE_TELEMETRY=true` set from the start. `NEXT_PUBLIC_DISABLE_SIGNUP=true` set after Robert's real owner account was created (blocks further public signups on the instance).

**Bug found and fixed during live testing (Robert clicking the real button in the real UI):** signing URLs were built from `DOCUMENSO_BASE_URL` (`http://documenso:3000`, the internal Docker hostname) instead of a public base — opened `documenso:3000/sign/...` in the browser, which can't resolve. Same class of mistake as the MinIO presign issue (see [[feedback-minio-presign-public-endpoint]]) — any URL handed to a browser needs a separate "public base" constant from the one used for server-to-server API calls. Fixed with `DOCUMENSO_PUBLIC_BASE_URL=https://sign.jagcorporate.com`.

**Licensing (AGPL-3.0) — checked, not a blocker:** the network-source-disclosure clause only triggers on a **modified** Documenso build. Calling the stock API/UI from `jag-api` (never touching Documenso's own source) does not trigger it — confirmed via Documenso's own licensing docs, which explicitly name this as the Community-vs-Enterprise distinction. Only relevant again if a future session forks Documenso's codebase itself (e.g. for custom branding beyond what's config-driven).

**Security posture checked:** CVE-2024-52271 (HIGH, PDF-layer-flattening/content-spoofing — relevant to document integrity for a legal lease signature; fixed via a linked PR, very likely already patched in the `:latest` image pulled) and CVE-2026-13543 (LOW). No independent third-party security audit found for Documenso — comparable risk posture to the platform's other self-hosted OSS pieces (Keycloak, MinIO, Traccar), not enterprise-audited but actively maintained.

**Status:** fully deployed and live. First real end-to-end test (Marcus Ramkissoon test lease) confirmed the signing page loads correctly and shows the right lease content. WhatsApp delivery of the signing link to the tenant is pending — see [[project-whatsapp-business-registration]] for that separate, still-settling issue (unrelated to Documenso itself; the signing link works via direct browser access regardless of WhatsApp delivery status).

**How to apply:** this is now the platform's e-signature tool going forward. If Documenso itself needs modification (custom fields, branding beyond config), re-check the AGPL modified-build clause before shipping. If any other document-signing feature is added, reuse `createSigningSubmission()` rather than building a new integration.
