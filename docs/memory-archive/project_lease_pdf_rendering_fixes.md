---
name: project-lease-pdf-rendering-fixes
description: 5 lease-agreement PDF/Documenso rendering bugs found + fixed via live signing walkthrough with Hugh Smith test lease — session 43 2026-07-13
metadata:
  node_type: memory
  type: project
  originSessionId: 9ecef067-d2df-4bff-a850-31f6610dfcc4
---

Robert noticed the already-signed Hugh Smith test lease (Apt C1, 45 Eleventh Street) displayed wrong when downloaded — kicked off a live end-to-end re-signing walkthrough that surfaced 5 real bugs, all fixed and deployed same session. See [[project-esignature-completion-pipeline]] for the session-42 infra fixes (cert, bucket, webhook body limit) this builds on.

1. **Signed-copy download read the wrong MinIO bucket.** `GET /properties/:id/leases/:id/signed-pdf` (`properties.ts`) was hardcoded to `BUCKET_DOCUMENTS`, but the Documenso webhook stores into `BUCKET_SIGNED_DOCUMENTS`. Fix: try `BUCKET_SIGNED_DOCUMENTS` first, fall back to `BUCKET_DOCUMENTS` (covers the older wet-sign-upload path too, no migration needed).

2. **Signature/date field boxes overlapped the underline they sat on.** `lease-pdf.ts` `recordField` calls for `SIGNATURE`/`DATE` were only 16pt tall, anchored exactly on the underline's y — Documenso rendered the signature squashed and the date text struck through the rule. First fix attempt (taller box shifted up 26pt) overcorrected and started overlapping the "SIGNED by the LANDLORD" heading instead — required a second pass: extra `moveDown(2.4)` (was 1.2) between heading and line to create real headroom, field now 34pt tall floating cleanly between the two.

3. **Documenso DATE field had no timezone/format set**, defaulting to UTC in some auto-picked format — showed 4 hours ahead for Trinidad (UTC-4) signers. Fix: `documenso.ts` `createSigningSubmission` now calls `POST /document/update` with `meta: { timezone: 'America/Port_of_Spain', dateFormat: 'yyyy-MM-dd hh:mm a' }` right after document creation (confirmed via the live `/api/v2-beta/openapi.json` schema — `dateFormat` is a fixed enum, `hh:mm a` is the 12-hour option).

4. **No page-numbering footer existed at all** — checked full git history, never implemented despite being expected. Added: `bufferPages: true` on the `PDFDocument` constructor, then after all content is drawn, loop `doc.bufferedPageRange()` + `switchToPage(i)` + stamp "Page X of Y" before `doc.end()`.

5. **The page-numbering footer doubled the page count (12 → 22).** The footer y (`page.height - 36`) sits below the page's usable content area (`margins.bottom` = 56pt default) — PDFKit's `.text()` auto-triggers `addPage()` when writing past that boundary, even via `switchToPage` on an already-rendered page, silently inserting a blank page after every real one. Fix: zero `doc.page.margins.bottom` for just that write, restore after. Verified locally by generating a test PDF and counting `/Type /Page` objects before deploying (11 pages, matching the original).

**Also surfaced (not a code bug, pre-existing test data):** Hugh Smith's test tenant record shares Robert's own email (`robertjohnsonattin@gmail.com`). Documenso can't distinguish two recipients with the same email — when Robert completed the landlord signature, Documenso silently auto-completed the tenant recipient row too (no actual signature captured), then every further tenant-signing attempt 500'd with `"Document must be pending for signing"`. This is the exact scenario `documenso.ts`'s comments already warn about. Left as-is (test data); a real lease will never have landlord==tenant email. If retesting, give the test tenant a distinct email first.

**Browser-automation lesson:** the Documenso signing widget's field markers are a canvas/portal overlay that resists synthetic clicks unpredictably — succeeded via ref-based clicks on the *sidebar* signature thumbnail button (not the in-document overlay directly), and only after several retries. A too-short Browser-pane viewport also silently clipped the "Complete" button off-screen with no scroll affordance — widening to ~900-1280px fixed it. Worth trying a wider viewport by default for any future Documenso walkthrough.

Commits: `a9d5e75`, `91e4bce`, `633004f`, `82ca0a2` (all 2026-07-13 afternoon/evening).
