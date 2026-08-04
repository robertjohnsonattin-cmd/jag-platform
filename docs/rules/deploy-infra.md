# Deploy & infrastructure rules

> Split out of CLAUDE.md. Read this before any deploy, env-var change, or container work.

### CRITICAL: jag-api Docker deploy pattern
The Dockerfile copies `dist/` (pre-compiled TypeScript) — **NOT** `src/`. Uploading source changes has zero effect on the running container.

**Correct deploy sequence for API changes:**
1. `npm run build:prod` — compile TypeScript locally
2. `scp -r dist/ ubuntu@150.136.151.64:/opt/jag/jag-api/`
3. `docker compose build api && docker compose up -d api` on VM

**Correct deploy sequence for frontend changes:**
1. `npm run build` — Vite build locally
2. Sync the build **into** `/opt/jag/jag-web/dist` in place (clear contents, then extract/copy — never delete or rename the `dist` directory itself). `deploy.sh`'s `tar_upload_inplace()` does this correctly.
3. No container rebuild or restart needed — Caddy serves static files directly, *as long as step 2 never touched the directory's identity* (see the bind-mount gotcha below).

**deploy.sh** (repo root) — STD-12 deploy gate script handles both. Flags: `--api-only`, `--frontend-only`, `--skip-typecheck`, `--skip-zap`, `--no-commit`, `--no-push`.
Deploy runs **8 steps**: TypeScript compile → frontend build → VM check → **dist + prod_modules/node_modules upload (as of 2026-07-21, both via tar_upload())** → health check → ZAP baseline → frontend upload → **git snapshot (commit + push to off-site backup)**.
Step 6 (ZAP baseline) fires automatically when `ZAP_SCAN_PASSWORD` env var is set; silently skips if unset. Blocks deploy on HIGH-risk findings only.
Step 8 (added 2026-06-24) auto-commits the deployed state and pushes to the private GitHub backup `robertjohnsonattin-cmd/jag-platform` so "deployed" and "saved off-site" always happen together; non-fatal, disable with `--no-commit`/`--no-push`. **Do NOT `set -a; . .env` before any `docker compose` command** — shell env overrides the `.env` file and silently no-ops config changes (force-recreate + verify instead). See [[feedback-compose-env-precedence]].

**`scp -r` on `prod_modules/node_modules` and `dist/` is unreliable — silently stalls, does not error (found session 44, 2026-07-21):** on a `scp -r` of a directory with hundreds of files (283-package `node_modules`, 692-file compiled `dist/`), the transfer can silently die partway — TCP stays `ESTABLISHED`, no error, no timeout, remote byte count just stops growing. Confirmed twice in one session, ~30-40 min each before being caught (checked via `du -sb` on the remote path at two points in time — flat byte count = dead). A single large file over the same link transfers fine in seconds, so it isn't bandwidth — looks like an idle-connection drop during the per-file negotiation gaps that plain `scp -r` doesn't retry or detect. **Workaround: tar the directory into one archive first, `scp` the single file, extract on the VM.** `tar -czf /tmp/x.tar.gz -C <dir> .` then `scp` then `tar -xzf ... -C <dest>` — a 286MB `node_modules` compressed to ~90MB and transferred in ~6 seconds this way, vs. never finishing as `scp -r`. **Gotcha:** `-C <dir> .` tars the *contents* of `<dir>`, not `<dir>` itself — extracting that into the destination's parent will land packages flat instead of nested under `node_modules/`; extract into the actual target directory (e.g. `-C /opt/jag/jag-api/prod_modules/node_modules/`, pre-created), not one level up. If a `docker compose build` step is already running when a transfer looks stuck, verify with `du -sb <remote path>` twice, ~15-20s apart, before assuming it's just slow — flat byte count means dead, kill it and switch to the tar approach rather than waiting longer.

### docker-compose.yml env-var wiring gap — CRITICAL (found session 39, three separate instances in one day; recurred session 48)
Adding a new env var to `.env` does **nothing** on its own — `docker-compose.yml`'s `environment:` block for a service only passes through vars **explicitly listed there** (no `env_file:` directive is used for `api`). Three real features were found completely non-functional in production because this second step was skipped: `WHATSAPP_ACCESS_TOKEN`/`WHATSAPP_PHONE_NUMBER_ID` (WhatsApp sending silently no-op'd for an unknown number of prior sessions despite being documented as "live"), `MINIO_PUBLIC_ENDPOINT`/`MINIO_PUBLIC_PORT`/`MINIO_PUBLIC_SSL` (presigned photo URLs fell back to the unreachable internal MinIO hostname), and `storage.jagcorporate.com` itself never got a Caddy site block at all despite being documented as deployed. **When adding any new env var that code reads via `process.env`, always grep `docker-compose.yml` to confirm it's actually wired into the relevant service's `environment:` block — a value existing in `.env` is not sufficient.** Also: `docker compose restart <service>` does **not** pick up new env values (env vars are baked in at container creation) — always use `docker compose up -d --force-recreate <service>` after an `.env` change, and verify with `docker exec <service> printenv <VAR>` afterward.

**Recurrence, session 48:** `GEMINI_API_KEY`/`GEMINI_MODEL` were set in VM `.env` but never listed in `docker-compose.yml`'s `api.environment` block — this meant the *pre-existing* Properties rent-suggestion feature (`listing.ts` `suggest-price`, live since session 19) had likely been silently 503ing in production the whole time, not just the new AI Fitness Coach that surfaced it. Fixed by adding both vars to the block and force-recreating; this is now the 4th time this exact class of gap has been found — always grep `docker-compose.yml` for a var *before* assuming a feature that calls `process.env.X` actually works in prod, even if it's been "live" for a long time.

### Cloudflare silently replaces 502/504 responses — never use those codes for app-level errors (found session 49, 2026-07-30)
Cloudflare's edge intercepts HTTP `502` and `504` responses from the origin and replaces the body with its own generic error page (plain text, e.g. `error code: 502`) — **even when jag-api sends back a perfectly valid `{ success, data, error, code }` JSON body.** `500` and `503` are passed through untouched. Confirmed empirically with a temporary no-auth debug route returning each status in turn through `jagcorporate.com` (Cloudflare-proxied, confirmed via `nslookup` resolving to Cloudflare anycast IPs, not the VM's real IP):

| Status sent by jag-api | What the browser actually receives |
|---|---|
| 500 | Our JSON, untouched |
| 502 | Cloudflare's own plaintext page — origin JSON discarded |
| 503 | Our JSON, untouched |
| 504 | Cloudflare's own plaintext page — origin JSON discarded |

**Symptom:** frontend `fetch().then(r => r.json())` throws `Unexpected token '<', "<!DOCTYPE "... is not valid JSON` — looks like a broken deploy or a raw HTML error page, but the API logs show a normal, well-formed error response was sent. This exact bug shipped in `ai-coach.ts`'s Gemini-unavailable path (`err(res, 502, 'UPSTREAM_ERROR', ...)`) — every time Gemini returned its own transient `503 high demand` error, jag-api correctly wrapped it as a `502` JSON error, and Cloudflare swallowed it before it reached the browser.

**Rule: never call `err(res, 502, ...)` or `err(res, 504, ...)` anywhere in jag-api.** Use `503` for "upstream/dependency unavailable" cases (semantically correct anyway) and `500` for generic unhandled failures — both pass through Cloudflare cleanly. Before adding any new upstream-integration error path (payment gateways, AI APIs, webhooks to third parties), grep `err(res, 50` across the codebase and confirm nothing uses 502/504.

**How to re-verify if ever in doubt:** add a temporary unauthenticated debug route (e.g. `app.get('/api/v1/_debug/force/:code', (req, res) => res.status(Number(req.params.code)).json({...}))`), deploy it, `curl` each status code through the public domain, compare `Server:`/`Content-Type` headers (Cloudflare's substituted page has `Server: cloudflare` and `Content-Type: text/plain`, ours is `application/json`) — then remove the route and redeploy clean. Don't leave it in production.

### Caddy / frontend
- Caddy Caddyfile already has the `jag-web` block
- `docker-compose.yml` Caddy service has volume mount: `/opt/jag/jag-web/dist:/opt/jag/jag-web/dist:ro`
- If Caddy container needs recreating after docker-compose.yml change: `docker compose up -d --force-recreate caddy`
- **Docker overlayfs bind-mount masking (2026-06-13):** If frontend deploys successfully (files in `/opt/jag/jag-web/dist` on host) but site serves 404, the Caddy container's overlayfs layer is shadowing the bind mount. Fix: `docker compose up -d --force-recreate caddy`. Root cause was the image not having the mount path pre-declared — fixed by adding `RUN mkdir -p /opt/jag/jag-web/dist` to `jag-infra/caddy/Dockerfile`.
- **Bind-mount detachment via directory swap/rm-recreate (found 2026-08-04) — different bug, same symptom class:** Docker's bind mount binds to the directory's *inode* at container start, not its path. Any host-side operation that removes-and-recreates or renames the bind-mounted directory (`mv old dist.old && mv new dist`, or `rm -rf dist && mkdir dist`) silently detaches the mount — the container keeps serving the *old* inode forever (now reachable under whatever new name, e.g. `dist.old`), with zero error, zero log, and every health check still passing. A manual deploy that mv-swapped `/opt/jag/jag-web/dist` passed every check but kept serving yesterday's JS bundle indefinitely; only a hard browser refresh looked like it should have fixed it and didn't, because the problem was never the browser. **Fix: `docker restart jag-caddy` (or any container with a bind-mounted directory) after any deploy that replaced the directory itself rather than its contents.** **Prevention: never swap or recreate a bind-mounted directory — always clear its contents in place and write into the same directory** (`find $dir -mindepth 1 -delete` then extract/copy into `$dir`), exactly what `deploy.sh`'s `tar_upload_inplace()` does. This applies to *any* bind-mounted directory, not just `jag-web/dist` — the same trap exists for `/var/www/jabco.tt` and the Google Calendar key file mount below.

### OWASP ZAP security scanning
- Scripts: `security/zap-baseline.sh` (passive, ~5 min, deploy gate) and `security/zap-full-scan.sh` (active, ~60 min, manual)
- Auth hook: `security/zap_auth_hook.py` — injects JWT Bearer token + Cache-Control bypass into every ZAP request
- False-positive config: `security/zap-baseline.conf` — 4 Cloudflare-artefact findings documented as INFO (headers confirmed correct via curl from inside ZAP Docker container)
- Reports saved to `security/reports/` (gitignored)
- To run baseline manually: `ZAP_SCAN_PASSWORD=<keycloak-password> bash security/zap-baseline.sh`
- To run full active scan: `ZAP_SCAN_PASSWORD=<keycloak-password> bash security/zap-full-scan.sh`
- KC client secret for ZAP auth defaulted in scripts — override with `ZAP_CLIENT_SECRET` env var if rotated

### Google Calendar service account key
The service account JSON key is stored as a file **not** a base64 env var. Base64 encoding through heredoc + docker-compose env chain caused `invalid_grant: Invalid JWT Signature` (silent corruption).

**File location on VM:** `/opt/jag/jag-api/google-calendar-key.json` (read-only, outside the Docker image)
**docker-compose.yml volume mount:** `- /opt/jag/jag-api/google-calendar-key.json:/opt/jag/jag-api/google-calendar-key.json:ro`
**`getAccessToken()`** reads the file via `fs.readFileSync` first; falls back to `GOOGLE_SERVICE_ACCOUNT_KEY` base64 env var if the file is absent.
**Service account:** `jag-api@gen-lang-client-0812561230.iam.gserviceaccount.com` — calendar shared with this address (Editor permission on `robertjohnsonattin@gmail.com` calendar).
**If key needs rotation:** download new JSON from Google Cloud → SCP to `/opt/jag/jag-api/google-calendar-key.json` on VM → `docker compose up -d api` (no rebuild needed — file is mounted, not baked into image).
