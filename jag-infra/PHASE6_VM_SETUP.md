# JAG Platform — Phase 6: Oracle Cloud VM Provisioning Guide

**Robert action required — follow these steps before running bootstrap-vm.sh**

---

## Step 1 — Create the Oracle Cloud VM

1. Log in to **cloud.oracle.com** → Compute → Instances → **Create instance**
2. **Name:** `jag-primary`
3. **Image:** Canonical Ubuntu 22.04 (Minimal)
4. **Shape:** Change shape → Ampere → **VM.Standard.A1.Flex**
   - OCPUs: **4**
   - Memory: **24 GB**
   *(This is within the Always Free allocation)*
5. **Networking:** Accept defaults (creates a new VCN and subnet)
6. **SSH keys:** Paste your SSH public key (or generate one — download the private key now, you cannot retrieve it later)
7. Click **Create** — wait ~3 minutes until state shows **Running**
8. Note the **Public IP address** shown on the instance detail page

---

## Step 2 — Set up Oracle billing alerts (do this immediately after VM creation)

This takes 2 minutes and ensures you are notified before any charge ever occurs.

### 2a — Create a $1 budget alert
1. In Oracle Cloud top menu: **Billing & Cost Management → Budgets → Create Budget**
2. Fill in:
   - **Name:** `jag-spend-alert`
   - **Target:** Root Compartment
   - **Budget amount:** `1` (USD, monthly)
   - **Threshold %:** `100`
   - **Email recipients:** `robertjohnsonattin@gmail.com`
   - **Alert message:** `JAG Oracle spend has reached $1 — check for accidentally launched paid resources`
3. Click **Create**

> If you ever receive this email, log in immediately and check Compute → Instances and Storage → Block Volumes for any resource that isn't `jag-primary`.

### 2b — Check your usage limits baseline
1. Go to: **Governance & Administration → Limits, Quotas and Usage**
2. Filter by Service: **Compute**
3. Confirm your A1 OCPU and memory usage shows **4 / 4 OCPU** and **24 / 24 GB** — confirming you are at the free limit and Oracle will block (not bill) any further compute additions

---

## Step 3 — Open firewall ports in Oracle Cloud

Oracle Cloud has TWO firewalls: Security Lists (VCN-level) and the VM's own UFW. Both must allow traffic.

1. Go to: Networking → Virtual Cloud Networks → your VCN → Security Lists → Default Security List
2. Add **Ingress Rules:**

| Source CIDR | IP Protocol | Port | Description |
|-------------|-------------|------|-------------|
| 0.0.0.0/0 | TCP | 80 | HTTP (Caddy redirect to HTTPS) |
| 0.0.0.0/0 | TCP | 443 | HTTPS |
| your-home-IP/32 | TCP | 22 | SSH (restrict to your IP) |

> **Note:** Port 22 is already open. Narrow it to your home IP for security.

---

## Step 4 — Point DNS to the VM

In **Cloudflare dashboard** for jagcorporate.com:

| Type | Name | Content | Proxy |
|------|------|---------|-------|
| A | `@` | `<VM Public IP>` | Proxied (orange cloud) |
| A | `www` | `<VM Public IP>` | Proxied |
| A | `api` | `<VM Public IP>` | Proxied |
| A | `auth` | `<VM Public IP>` | Proxied |

> Set TTL to **Auto**. The orange cloud (proxied) routes traffic through Cloudflare — this is required for DDoS protection and the correct `CF-Connecting-IP` header that the API uses.

---

## Step 5 — Get a Cloudflare API Token

Caddy uses Cloudflare DNS-01 challenge to obtain wildcard TLS certificates. It needs a token.

1. Cloudflare dashboard → top-right profile → **My Profile** → **API Tokens** → **Create Token**
2. Use template: **Edit zone DNS**
3. Scope: **Zone → jagcorporate.com**
4. Click **Continue to summary** → **Create Token**
5. **Copy the token now** — it is shown only once

You will put this token in `jag-infra/.env` as `CLOUDFLARE_API_TOKEN=<token>`.

---

## Step 6 — Enable Oracle Cloud automated backups

Automated snapshots of the VM's boot volume protect against OS/disk failure.

1. Go to: Compute → Instances → jag-primary → **Boot volume** (click the link)
2. Click **Edit** → enable **Auto-tune performance** and **Backup policies**
3. Select policy: **Bronze** (weekly backup, 5 backups retained — free within Always Free)
4. Click **Save changes**

---

## Step 7 — SSH into the VM and run the bootstrap script

```bash
# From your Windows machine (PowerShell or WSL):
ssh -i path/to/private-key ubuntu@<VM-Public-IP>
```

Once logged in, copy the bootstrap script to the VM and run it:

```bash
# From PowerShell on your Windows machine:
scp -i path/to/private-key jag-infra/scripts/bootstrap-vm.sh ubuntu@<VM-Public-IP>:~/
ssh -i path/to/private-key ubuntu@<VM-Public-IP> "chmod +x bootstrap-vm.sh && sudo ./bootstrap-vm.sh"
```

The script takes ~5 minutes and prints each step. **Do not interrupt it.**

---

## Step 8 — Copy project files to the VM

After bootstrap completes, clone or copy the JAG project:

```bash
# Option A: clone from GitHub (if you have a private repo)
git clone git@github.com:your-org/jag-platform.git /opt/jag

# Option B: rsync from your Windows machine
rsync -avz -e "ssh -i path/to/key" \
  "/c/Users/rober/Documents/Claude/Projects/JAG Holdings/" \
  ubuntu@<VM-IP>:/opt/jag/ \
  --exclude node_modules --exclude .git --exclude dist
```

---

## Step 9 — Populate production .env

```bash
ssh into the VM, then:
cp /opt/jag/jag-infra/.env.example /opt/jag/jag-infra/.env
nano /opt/jag/jag-infra/.env
```

Fill in every `CHANGE_ME_*` value. See `.env.example` for the full list.
**Critical values:**
- All `CHANGE_ME_*` passwords — generate strong random passwords
- `CLOUDFLARE_API_TOKEN` — from Step 5
- `KC_HOSTNAME=auth.jagcorporate.com`
- `ACME_EMAIL=robertjohnsonattin@gmail.com`
- `KC_WEBAUTHN_RP_ID=jagcorporate.com`
- Leave `ALERT_USER_ID` and `WIPAY_DEFAULT_OWNER_ID` as placeholder — set after Step 11

---

## Step 10 — Run the deploy script (first deploy)

```bash
cd /opt/jag/jag-infra
./scripts/deploy.sh --env=production
```

This compiles TypeScript, runs migrations on all 5 databases, builds Docker images, and starts the stack.

---

## Step 11 — Keycloak setup

Once the stack is up:

```bash
cd /opt/jag/jag-infra

# 1. Declare custom attributes + JWT mappers
bash scripts/keycloak-mappers-setup.sh

# 2. Configure WebAuthn with production rpId (MUST be done before any biometric registration)
KC_WEBAUTHN_RP_ID=jagcorporate.com bash scripts/keycloak-webauthn-setup.sh
```

---

## Step 12 — Create real Keycloak users

Create each user via the Keycloak admin console at `https://auth.jagcorporate.com/admin`:

1. Create user → set email + temporary password → mark email verified
2. After creation, run for each user:
   ```bash
   bash scripts/set-user-tenant.sh <keycloak-user-uuid> <tenant-uuid>
   ```
3. Once Robert's account is synced, retrieve `users.id` from jag_core:
   ```bash
   psql -U jag_app jag_core -c \
     "SELECT id FROM users WHERE keycloak_id = '<robert-kc-uuid>';"
   ```
4. Update `/opt/jag/jag-infra/.env`:
   - `ALERT_USER_ID=<robert-users-id>`
   - `WIPAY_DEFAULT_OWNER_ID=<robert-users-id>`
5. `docker compose restart dispatcher api`

---

## Step 13 — Smoke test

```bash
# Test API health
curl https://api.jagcorporate.com/health/ready

# Test auth (get a token)
curl -s -X POST https://auth.jagcorporate.com/realms/jag/protocol/openid-connect/token \
  -d "grant_type=password&client_id=jag-api&client_secret=<secret>&username=<email>&password=<pw>" \
  | python3 -m json.tool
```

Then open `https://auth.jagcorporate.com/admin` in your browser and log in — confirm WebAuthn is available.

---

## Ongoing access

| Service | Access |
|---------|--------|
| Keycloak admin | `https://auth.jagcorporate.com/admin` |
| Grafana dashboards | `ssh -L 3001:localhost:3001 ubuntu@<VM-IP>` then `http://localhost:3001` |
| MinIO console | `ssh -L 9001:localhost:9001 ubuntu@<VM-IP>` then `http://localhost:9001` |
| PostgreSQL | `ssh -L 5432:localhost:5432 ubuntu@<VM-IP>` then connect with pgAdmin |

---

## Security migrations applied (post-Phase 5 audit)

These migrations were added after the initial Phase 5 schema and must be included in the first deploy:

| Database | File | Purpose |
|----------|------|---------|
| jag_core | `006_missing_indexes.sql` | FK indexes on user_tenant_roles; idempotency_key on audit_log |
| jag_commercial | `008_rls_and_indexes.sql` | RLS policies on 16 unprotected tables (NLCB, CRM, JABCO, pending_events); idempotency UNIQUE constraints; FK indexes |

The deploy script runs all numbered SQL files in order — no manual steps required.

## Code security fixes applied (post-Phase 5 audit)

The following API-layer fixes were applied and are included in the codebase:

- `index.ts` — security headers (X-Frame-Options, HSTS etc.), rate limiting (300 req/min), graceful shutdown
- `lib/logger.ts` — sensitive field redaction (passwords, tokens, secrets never logged)
- `lib/extractor/extract.ts` — path traversal guard + 20MB file size limit on PDF extraction
- `lib/extractor/parse.ts` — Ollama fetch timeout (2 min default, configurable via OLLAMA_TIMEOUT_MS)
- `routes/finance/transactions.ts` — atomic balance update (was split across two DB connections — race condition fixed)
- `routes/finance/expenses.ts` — credit account type validation (must be LIABILITY or ASSET, not REVENUE)
- `routes/docvault/index.ts` — storage_path Zod regex prevents path traversal
- `routes/succession/index.ts` — storage_path Zod regex prevents path traversal
- `routes/webhooks/wipay.ts` — body size limit (64kb), idempotent audit log INSERT
- `caddy/Caddyfile` — HSTS on both api and auth domains
- `docker-compose.yml` — Promtail corrected to /var/log/postgresql (PG17 Ubuntu path), dispatcher healthcheck, resource limits
