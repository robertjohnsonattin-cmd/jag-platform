# MinIO / file-storage rules

> Split out of CLAUDE.md. Read this before any upload, presigned-URL, or streamed-asset work.

### MinIO — critical operational notes

**jag_app MinIO user is a separate IAM user, NOT the root user.** It must be created explicitly after any MinIO data wipe or volume loss:
```bash
MINIO_ROOT_PASSWORD=<pw> MINIO_ROOT_USER=jag_minio_admin \
  mc admin user add jagadmin <jag-app-access-key> <secret>
mc admin policy attach jagadmin jag-app-buckets --user <jag-app-access-key>
```

**IAM policy** `jag-app-buckets` restricts jag_app to the 4 authorised buckets only. Recreate with:
```bash
MINIO_ROOT_PASSWORD=<pw> JAG_APP_ACCESS_KEY=<jag-app-access-key> \
  bash /opt/jag/jag-infra/scripts/setup-minio-policy.sh
```

**SSE-S3 encryption** — all 4 buckets auto-encrypt at rest via `MINIO_KMS_SECRET_KEY` (`/opt/jag/jag-infra/.env`, format `jag-sse-key:<base64>`, value ‹SECRETS VAULT›[^secrets]). **Rotating this key is destructive — two hazards:** (1) existing objects can't be decrypted under a new key → must **re-encrypt** (download all objects plaintext while old key active → swap key → re-upload; buckets auto-encrypt on PUT). (2) the swap **wipes the IAM store** (users/policies are KMS-encrypted) → after rotation, recreate the `jag-app-buckets` policy + `jag_app` user (fresh secret) and update `MINIO_SECRET_KEY` in `.env` + restart api. Root user survives (env-based). Done once on 2026-06-24 (see Secrets hygiene). Force-recreate minio after `.env` change (compose shell-override caveat — see [[feedback-compose-env-precedence]]).

**Audit log** — MinIO sends every file operation (PUT/GET/DELETE) to `http://jag-api:3000/internal/minio-audit` via `audit_webhook:loki`. Secured by `Bearer $MINIO_AUDIT_TOKEN`. Events appear in Grafana/Loki under `entity="MINIO_AUDIT"`. Config survives container restarts (stored in MinIO's internal KV).

**Stale statement cleanup** — VM cron at 07:00 UTC (03:00 TT) runs `cleanup-stale-statements.sh`. Deletes PENDING `fin_bank_statement_jobs` older than 7 days + their MinIO objects. Logs to `/var/log/jag-stmt-cleanup.log`.

### MinIO presigned URLs — public vs internal endpoint — CRITICAL (session 36)
`MINIO_ENDPOINT` (`minio`) is the internal Docker-network hostname — correct for server-side operations (`ensureBucket`, `getObjectStream`, `deleteObject`) but **presigned URLs are handed to the browser**, which cannot resolve `minio` at all. Any presigned PUT/GET built against the internal client fails in the browser with a bare `fetch` "Failed to fetch" (upload) or a broken `<img>` (gallery) — no server-side error, so it's easy to ship without noticing until someone actually uploads through the UI. This had silently affected **every** presigned-URL feature (unit listing photos, VMS compliance docs) since they were built.

**Fix:** `jag-api/src/lib/minio.ts` has a second `presignClient` configured against `MINIO_PUBLIC_ENDPOINT` (`storage.jagcorporate.com`, port 443, SSL) — used only by `getPresignedPutUrl`/`getPresignedGetUrl`. Requires: a Caddy site block reverse-proxying `storage.jagcorporate.com` → `minio:9000` (wildcard cert already covers it, but the DNS **A record** still had to be created separately in Cloudflare — DNS-01 challenge doesn't imply a routable record), `MINIO_API_CORS_ALLOW_ORIGIN=https://jagcorporate.com` on the MinIO container (browser PUT is cross-origin, needs CORS preflight to succeed), and the main site's CSP `img-src`/`connect-src` extended to allow the new subdomain. All three pieces are required together — missing any one produces a different failure mode (CORS error, CSP violation, or plain connection refused) that looks unrelated to the other two.

**CORRECTION (2026-07-08, session 39):** despite the above being written up as done in session 36, **none of the three infra pieces were ever actually deployed** — only the DNS record existed. Git history confirms `storage.jagcorporate.com` never appeared in the Caddyfile at any commit; `.env` had the right values but `docker-compose.yml`'s `api` service never wired `MINIO_PUBLIC_ENDPOINT`/`MINIO_PUBLIC_PORT`/`MINIO_PUBLIC_SSL` into the container at all (so `presignClient` silently fell back to the internal client). This was only discovered when a real user actually opened a listing's photo gallery for the first time since session 36 — broken images fail silently (no console error most people notice), so the gap went unnoticed. **A second, previously-masked bug surfaced once the endpoint was fixed:** the `minio` npm SDK's `presignedUrl()` makes an internal `getBucketRegionAsync()` call to auto-detect the bucket's region, and that call failed with an opaque `S3Error` when routed through Caddy's reverse proxy — causing the whole photo-list endpoint to 500 instead of just serving a broken link. **Fix:** pin `region: 'us-east-1'` (MinIO's own default) explicitly on both the internal `minioClient` and `presignClient` constructors so the SDK never makes that network call at all. All three infra pieces (Caddy block, MinIO CORS, CSP) plus the region pin are now actually deployed and verified end-to-end (`curl` against a freshly-generated presigned URL returned `200 image/jpeg`). **Lesson:** a CLAUDE.md "DONE" entry reflects intent at write-time, not necessarily current VM/repo reality — this was the third such gap found in one session (see also Documenso and WhatsApp entries above). Treat "documented as deployed" with some skepticism; verify against actual git history / live container env when a feature that touches infra wiring hasn't been exercised recently.

### MinIO SDK region auto-detection fails behind a reverse proxy — CRITICAL (found session 39)
The `minio` npm package's `presignedUrl()` (used by `getPresignedGetUrl`/`getPresignedPutUrl`) makes an internal `getBucketRegionAsync()` call to auto-detect the bucket's region unless one is set explicitly. That auto-detect call fails with an opaque `S3Error` when the client is pointed at a hostname reverse-proxied by Caddy (as `presignClient` in `lib/minio.ts` is, against `storage.jagcorporate.com`) — this silently breaks *every* presigned-URL feature at once (photo galleries return empty, uploads fail) with no obvious error pointing at the cause. **Fix:** always pass `region: 'us-east-1'` (or whatever the real bucket region is) explicitly in the `MinioClient` constructor for any client used for presigned URLs, so the SDK never makes that extra network call.

---

### Auth-gated streaming assets — cannot be bare `<img src>` / `<a href>` (session 26)
`requireAuth()` is **header-only** (Authorization: Bearer; no cookie/query fallback). Any backend route that **streams bytes** behind `requireAuth()` (e.g. `GET /ims/items/:id/photos/:photoId/download` via `stream.pipe(res)`, or `/files/download`) **cannot** be used as a bare `<img src="/api/v1/...">` or `<a href>` — the browser-native request carries no Bearer header → **401, asset never loads**.
- **Images:** use `<AuthedImg path={...} />` (`jag-web/src/components/AuthedImg.tsx`) — fetches via `api.objectUrl()` (Bearer fetch → blob object URL), renders it, revokes on unmount.
- **Downloads:** use `api.download(path, fileName)` (DocVault, Succession, `filesApi.download()` already do this).
- Both helpers live in `jag-web/src/api/client.ts`. `path` is **BASE-relative** (no `/api/v1` prefix — the helper prepends it). API helpers returning such URLs (e.g. `imsApi.photoDownloadUrl`) must return the BASE-relative path.
- **Exception:** MinIO **presigned GET URLs** (`getPresignedGetUrl()`, e.g. property/unit photos) are self-authenticating and DO work as a bare `<img src>` — leave those alone.
- **Viewing/printing HTML** (not a download, no filename): use `api.openHtml(path)` (session 40) — fetches with the Bearer token, opens a blank tab synchronously on click (avoids the popup blocker), then navigates it to the blob URL. Found broken in the Rent Schedule "Receipt" link (`<a href="/api/v1/...">`) — silently 401'd for months since nothing surfaced the failure to Robert. Same class of bug as the image/download case above; check for it whenever a receipt/report link opens in a new tab.
