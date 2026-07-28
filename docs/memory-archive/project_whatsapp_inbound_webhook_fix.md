---
name: project-whatsapp-inbound-webhook-fix
description: "Inbound WhatsApp webhook (prospect replies → enquiry + auto-reply) never worked at all until session 41 (2026-07-13) — 5 chained bugs, all fixed and verified with a real message"
metadata: 
  node_type: memory
  type: project
  originSessionId: 90c7057a-4e2c-47de-bc41-0fffdd9d061e
---

Inbound WhatsApp had never processed a single real message since the feature was originally built. Fixed as a chain of 5 independent bugs, each confirmed separately via [[feedback-webhook-signature-testing-pattern]], and finally verified with a real message from Robert's own phone that created a real `prop_enquiries` row and triggered the auto-reply.

**The 5 bugs, in the order they were found (fixing one just exposed the next):**
1. Meta app was **unpublished** — Meta silently refuses to deliver production webhooks to an unpublished app. Fixed by completing required App Dashboard fields (Privacy Policy URL — new static `jag-web/public/privacy.html` — and Category) then clicking Publish.
2. The WABA had **zero subscribed apps** (`GET /{waba-id}/subscribed_apps` → `{data: []}`). App-level webhook config (Callback URL + Verify Token, set in App Dashboard → WhatsApp → Configuration) is a *separate* step from telling the WABA to route events to that app — fixed via `POST /{waba-id}/subscribed_apps`.
3. `jag-api/src/index.ts` had a **global `express.json()` mounted before** the WhatsApp webhook's own `express.raw()` — the global parser consumed the body first, so the raw Buffer needed for HMAC was never available and `Hmac.update()` threw a `TypeError` on every call. Fixed by moving the whole webhook mount above the global `express.json()`, same as the pre-existing WiPay webhook pattern.
4. `verifyWebhookSignature()` in `lib/whatsapp.ts` signed with **`WHATSAPP_ACCESS_TOKEN` instead of the Meta App Secret** — completely different secret. Meta signs `X-Hub-Signature-256` with the App Dashboard → Settings → Basic → "App secret" value. Added `WHATSAPP_APP_SECRET` env var, wired into `docker-compose.yml`'s `api` service (per [[feedback-docker-compose-env-wiring-gap]] — a value in `.env` alone does nothing).
5. Even after the signature passed, **`req.body` ended up empty** — chaining `express.json()` after `express.raw()` can't re-read an already-consumed stream. Fixed by manually `JSON.parse()`-ing the raw Buffer instead of chaining a second parser. A 6th smaller bug surfaced once messages actually parsed: `prop_whatsapp_messages.message_type` CHECK constraint requires uppercase but Meta sends lowercase `text` — added a normalizer.

**Also fixed same session — duplicate enquiries.** The enquiry-lookup query only matched via a prior `prop_whatsapp_messages` row already linked to an `enquiry_id`. Most enquiries are created by other flows (viewing booked, application submitted) with no such linked message row, so every reply from someone who already had an *open* enquiry silently spawned a new duplicate instead of reusing it. Fixed with a fallback query directly on `prop_enquiries` for the most recent non-terminal-stage row (excludes `REJECTED`/`WITHDRAWN`/`CONVERTED`) before creating a new one. Verified against real production data (an enquiry count that stayed flat after a new inbound message, instead of incrementing). 9 pre-existing test/duplicate enquiries from earlier simulation sessions on the test number were cleaned up with explicit user confirmation.

**Also fixed — GPS battery-sync silent failures.** Unrelated discovery while chasing DB auth noise during this session: `/internal/gps/battery-sync` responds `200 OK` to its cron *before* any DB work runs (fire-and-forget so the hourly cron isn't blocked). This meant 4 straight hourly sync failures during a transient `jag_app` credential incident were completely invisible outside a `WARN` log line — the cron's own log said "success" throughout. Now fires a deduped (1 per 3h) in-app notification on failure, mirroring the file's existing low-battery alert pattern.

Commits: `7bc6f1c` (webhook fixes + misc), `b72efaf` (dedup fix), `58ddfea` (GPS battery alert).

**How to apply:** when a new webhook integration is added in the future (or an existing one seems dead), check for all of: app-publish status, WABA/account subscription, body-parser mount order relative to any global JSON parser, which secret the signature actually uses, and whether `express.raw()`+`express.json()` are ever chained on the same route (they can't be — pick one).
