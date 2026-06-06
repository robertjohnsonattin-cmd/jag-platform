# JAG Holdings — PRE-7: Migrate JABCO Domain to Cloudflare Free Tier
**Date:** 2026-05-24  
**Status:** ✅ DONE  
**Session scope:** Full migration runbook — DNS records, SSL/TLS, custom WAF rules, Authenticated Origin Pull, zero-downtime cutover, rollback procedure.

---

## Overview

**What Cloudflare Free Tier gives you:**
- Full DNS management with < 1-minute propagation (after nameservers are delegated)
- CDN + reverse proxy (orange cloud) — hides origin IP, DDoS protection included
- SSL/TLS edge termination — Full (Strict) mode
- Authenticated Origin Pull — only Cloudflare can reach your origin
- 5 custom WAF rules + Bot Fight Mode
- Always Online (serves cached pages during origin downtime)

**What it does NOT include (Free Tier limits):**
- Managed WAF rulesets (OWASP, etc.) — Pro plan and above
- Advanced rate limiting rules — Pro plan and above
- Custom analytics retention beyond 24 h

**Subdomains being configured:**

| Subdomain | Target | Proxy | Purpose |
|---|---|---|---|
| `jabco.tt` | Oracle AMD VM | ✅ Proxied | Main JABCO site |
| `www.jabco.tt` | `jabco.tt` (CNAME) | ✅ Proxied | www redirect |
| `api.jabco.tt` | Oracle AMD VM | ✅ Proxied | JAG API (Phase 1) |
| `auth.jabco.tt` | Oracle AMD VM | ✅ Proxied | Keycloak |

---

## Pre-Migration Checklist

Complete **all** items before touching nameservers:

- [ ] Note your current registrar login credentials for `jabco.tt` (TTNIC reseller)
- [ ] Export or photograph your current DNS record set (all A, CNAME, MX, TXT records)
- [ ] Identify your Oracle AMD VM's public IP address (`<ORACLE_AMD_IP>`)
- [ ] Confirm Keycloak Docker Compose has `KC_PROXY=edge` and `KC_HOSTNAME=auth.jabco.tt` (see Step 6)
- [ ] Lower TTL on all current DNS records to **300 seconds** (5 min) at your current registrar — do this **24 hours before** cutover to minimise propagation lag
- [ ] Create your Cloudflare account at cloudflare.com (free plan)
- [ ] Have a phone/SMS available for Cloudflare 2FA setup

---

## Step 1: Add Site to Cloudflare

1. Log in to [dash.cloudflare.com](https://dash.cloudflare.com)
2. Click **Add a Site** → enter `jabco.tt` → select **Free plan**
3. Cloudflare scans your current DNS — review the imported records carefully against your exported list
4. Note the two Cloudflare nameservers assigned to your account, e.g.:
   ```
   aria.ns.cloudflare.com
   bob.ns.cloudflare.com
   ```
   (Cloudflare assigns unique nameservers per account — copy yours exactly)

---

## Step 2: Configure DNS Records

Enter these records in Cloudflare DNS. Replace `<ORACLE_AMD_IP>` with your actual VM IP.

**Delete any auto-imported records that conflict with the table below before adding.**

| Type | Name | Content | Proxy | TTL | Notes |
|---|---|---|---|---|---|
| A | `jabco.tt` | `<ORACLE_AMD_IP>` | ✅ Proxied | Auto | Main site |
| CNAME | `www` | `jabco.tt` | ✅ Proxied | Auto | www → apex redirect |
| A | `api` | `<ORACLE_AMD_IP>` | ✅ Proxied | Auto | JAG API |
| A | `auth` | `<ORACLE_AMD_IP>` | ✅ Proxied | Auto | Keycloak |
| TXT | `jabco.tt` | `v=spf1 ...` | DNS Only | Auto | **Keep existing SPF if present** |
| MX | `jabco.tt` | (keep existing) | DNS Only | Auto | **Keep existing MX records** |

> **WAL target VM:** The Ampere VM is an internal replica target — it has no public subdomain and should not appear in DNS.

> **Proxied vs DNS-only:** All application subdomains (`jabco.tt`, `api`, `auth`) must be **proxied** (orange cloud) for Authenticated Origin Pull and WAF to work. Email-related records (MX, SPF DKIM) must be **DNS-only** (grey cloud) — Cloudflare cannot proxy email.

---

## Step 3: SSL/TLS Configuration

In Cloudflare Dashboard → **SSL/TLS**:

### 3.1 Encryption mode
Set to **Full (Strict)**.

> Full (Strict) requires a valid SSL certificate on your origin server. Do not use "Flexible" (insecure) or "Full" (allows self-signed).

### 3.2 Origin certificate (install on Oracle AMD VM)

Cloudflare provides a free origin CA certificate trusted between Cloudflare and your origin:

1. Cloudflare Dashboard → SSL/TLS → **Origin Server** → **Create Certificate**
2. Choose **RSA 2048**, validity **15 years**
3. Add hostnames: `jabco.tt`, `*.jabco.tt`
4. Download the certificate (`origin.pem`) and private key (`origin-key.pem`)
5. Install on your Oracle VM:

```bash
sudo cp origin.pem     /etc/ssl/certs/jabco-origin.pem
sudo cp origin-key.pem /etc/ssl/private/jabco-origin-key.pem
sudo chmod 600         /etc/ssl/private/jabco-origin-key.pem
```

6. Reference in your nginx/Caddy config (see Step 9 — PRE-9 Docker setup covers this):

```nginx
# nginx origin SSL block (all vhosts)
ssl_certificate     /etc/ssl/certs/jabco-origin.pem;
ssl_certificate_key /etc/ssl/private/jabco-origin-key.pem;
ssl_protocols TLSv1.2 TLSv1.3;
```

### 3.3 Additional SSL settings

| Setting | Value |
|---|---|
| Always Use HTTPS | **On** |
| HTTP Strict Transport Security (HSTS) | Enable — max-age 6 months, include subdomains |
| Minimum TLS Version | TLS 1.2 |
| Opportunistic Encryption | On |
| TLS 1.3 | On |
| Automatic HTTPS Rewrites | On |

---

## Step 4: Custom WAF Rules (5 rules — Free Tier)

Cloudflare Dashboard → **Security** → **WAF** → **Custom Rules**.

Rules are evaluated top-to-bottom. Order matters.

---

### Rule 1 — Block Keycloak Admin Console from Internet

Keycloak's admin console (`/auth/admin`) must never be publicly reachable. Access only from your known static IPs.

**Expression:**
```
(http.host eq "auth.jabco.tt" and http.request.uri.path contains "/auth/admin") and not ip.src in {<YOUR_HOME_IP>/32 <ORACLE_AMD_IP>/32}
```

**Action:** Block  
**Name:** `Block Keycloak admin console`

> Replace `<YOUR_HOME_IP>` with your home static IP. If your ISP assigns dynamic IPs, use a VPN with a fixed egress IP for admin access instead.

---

### Rule 2 — Block Known Scanner Tool User-Agents

```
(http.user_agent matches "(?i)(sqlmap|nikto|masscan|nmap|nessus|dirbuster|gobuster|zgrab|nuclei|wfuzz)")
```

**Action:** Block  
**Name:** `Block scanner UAs`

---

### Rule 3 — Challenge Non-TT Countries on Login Paths

Legitimate users are in Trinidad and Tobago. Challenge (JS challenge, not block) anything from outside TT hitting auth endpoints. This catches credential-stuffing bots while allowing Robert to access from abroad with a one-time challenge.

```
(http.request.uri.path contains "/realms/jag/protocol/openid-connect") and not ip.geoip.country in {"TT"}
```

**Action:** Managed Challenge (not Block — allows legitimate travel access)  
**Name:** `Challenge non-TT auth attempts`

> WiPay's webhook (`/api/v1/webhooks/wipay`) is served on `api.jabco.tt`, not `auth.jabco.tt`, so it is unaffected by this rule. WiPay servers are based in TT; if they ever call from outside TT the HMAC middleware (PRE-5) would still reject bad signatures before any data is processed.

---

### Rule 4 — Block API Requests with No User-Agent

Automated vulnerability scanners often send empty User-Agent. Legitimate HTTP clients always send one.

```
(http.host eq "api.jabco.tt" and http.user_agent eq "")
```

**Action:** Block  
**Name:** `Block empty UA on API`

---

### Rule 5 — Block Direct-to-IP Access (Host Header Mismatch)

Attackers who discover the origin IP bypass Cloudflare by hitting the IP directly. Block requests where the Host header doesn't match a known vhost.

```
not (http.host in {"jabco.tt" "www.jabco.tt" "api.jabco.tt" "auth.jabco.tt"})
```

**Action:** Block  
**Name:** `Block unknown Host headers`

---

### Additional Free-Tier Security Settings

Enable these in the Security section — they don't consume rule quota:

| Setting | Value |
|---|---|
| **Bot Fight Mode** | **On** — blocks known bots automatically |
| Security Level | **Medium** |
| Challenge Passage | 30 minutes |
| Browser Integrity Check | On |

---

## Step 5: Page Rules (Optional — 3 free rules)

| URL Pattern | Setting | Value |
|---|---|---|
| `http://jabco.tt/*` | Always Use HTTPS | On |
| `http://www.jabco.tt/*` | Always Use HTTPS | On |
| `www.jabco.tt/*` | Forwarding URL (301) | `https://jabco.tt/$1` |

---

## Step 6: Authenticated Origin Pull

Authenticated Origin Pull ensures **only Cloudflare's servers** can reach your origin — even if your IP leaks, direct connections are refused.

### 6.1 Enable in Cloudflare

Dashboard → SSL/TLS → **Origin Server** → toggle **Authenticated origin pulls** → **On**

### 6.2 Download Cloudflare's client CA certificate

```bash
# On your Oracle AMD VM
sudo curl -o /etc/ssl/certs/cloudflare-origin-pull-ca.pem \
  https://developers.cloudflare.com/ssl/static/authenticated_origin_pull_ca.pem
```

### 6.3 Configure nginx to require the certificate

```nginx
# In your server block for all vhosts
ssl_client_certificate /etc/ssl/certs/cloudflare-origin-pull-ca.pem;
ssl_verify_client      on;
```

After this, nginx will reject any TLS connection that doesn't present Cloudflare's client certificate. Direct-to-IP connections return a TLS handshake failure.

### 6.4 Test before going live

```bash
# Direct connection should fail (from any machine)
curl -v --resolve api.jabco.tt:443:<ORACLE_AMD_IP> https://api.jabco.tt/health
# Should return: SSL alert: certificate required

# Via Cloudflare should succeed
curl https://api.jabco.tt/health
# Should return: {"status":"ok"}
```

---

## Step 7: Keycloak Configuration for Cloudflare Proxy

Keycloak must know it's behind a proxy; otherwise OAuth redirect URLs will use `http://` or the wrong hostname.

Add these environment variables to your Keycloak Docker Compose service (PRE-4 setup):

```yaml
environment:
  KC_PROXY: edge                        # Tells KC it's behind a reverse proxy doing SSL
  KC_HOSTNAME: auth.jabco.tt            # Frontend URL for OAuth redirect generation
  KC_HOSTNAME_STRICT: "true"            # Reject requests with wrong Host header
  KC_HOSTNAME_STRICT_BACKCHANNEL: "false" # Allow internal backchannel calls
```

And in the nginx vhost for `auth.jabco.tt`, pass the real client IP and protocol:

```nginx
location / {
    proxy_pass         http://localhost:8080;
    proxy_set_header   Host               $host;
    proxy_set_header   X-Real-IP          $http_cf_connecting_ip;
    proxy_set_header   X-Forwarded-For    $http_cf_connecting_ip;
    proxy_set_header   X-Forwarded-Proto  $scheme;
}
```

> Use `$http_cf_connecting_ip` (Cloudflare's header for the real client IP), not `$remote_addr` (which would be Cloudflare's server IP).

---

## Step 8: Zero-Downtime Cutover Procedure

**Timing:** Do this during a low-traffic window. For a TT business, Sunday 2–4 AM is ideal.

### T-24 hours
- [ ] Lower TTL on all `jabco.tt` DNS records to **300 seconds** at current registrar
- [ ] Verify all DNS records are correctly entered in Cloudflare (Step 2)
- [ ] Verify Cloudflare SSL/TLS and WAF settings are complete (Steps 3–5)
- [ ] Verify origin SSL cert is installed on the Oracle VM (Step 3.2)
- [ ] Do NOT enable Authenticated Origin Pull yet

### T-0 (cutover)
1. Log in to your TTNIC registrar portal
2. Navigate to **jabco.tt** → **Nameservers**
3. Replace current nameservers with Cloudflare's assigned nameservers:
   ```
   aria.ns.cloudflare.com    (use your actual assigned NS)
   bob.ns.cloudflare.com     (use your actual assigned NS)
   ```
4. Save changes
5. Note the exact time — `.tt` domains can take **12–48 hours** for full global propagation (TTNIC is a slower registry than .com)

### T+15 minutes
- [ ] Check propagation for TT-based resolvers: `dig jabco.tt NS @ns1.tstt.net.tt`
- [ ] Check global propagation: [dnschecker.org](https://dnschecker.org) → jabco.tt → NS
- [ ] Once NS resolves to Cloudflare: verify HTTPS works via browser
- [ ] Check Cloudflare dashboard → **Analytics** for traffic flowing through

### T+24 hours (after propagation confirmed globally)
- [ ] Enable Authenticated Origin Pull (Step 6)
- [ ] Test direct-to-IP access is blocked (Step 6.4)

---

## Step 9: Post-Migration Verification Checklist

Run all checks after propagation is confirmed:

**DNS:**
- [ ] `dig A jabco.tt` → returns Cloudflare anycast IP (not `<ORACLE_AMD_IP>`)
- [ ] `dig A api.jabco.tt` → returns Cloudflare anycast IP
- [ ] `dig A auth.jabco.tt` → returns Cloudflare anycast IP
- [ ] MX records intact (if you have email)

**SSL:**
- [ ] `https://jabco.tt` → padlock shown, cert issued by "Cloudflare"
- [ ] `https://api.jabco.tt/health` → `{"status":"ok"}`
- [ ] `https://auth.jabco.tt/realms/jag/.well-known/openid-configuration` → JSON response
- [ ] Keycloak admin console → `https://auth.jabco.tt/auth/admin` → loads (from your allowed IP only)

**WAF:**
- [ ] Scanner UA test: `curl -A "sqlmap/1.0" https://api.jabco.tt/` → `403`
- [ ] Empty UA test: `curl -A "" https://api.jabco.tt/` → `403`
- [ ] Unknown Host test: `curl -H "Host: evil.com" https://<ORACLE_AMD_IP>/` → `403` or TLS failure
- [ ] WiPay webhook test: `curl -X POST https://api.jabco.tt/api/v1/webhooks/wipay` → `401` (bad sig) — NOT blocked by WAF

**Keycloak OAuth:**
- [ ] Navigate to Keycloak Account Console → `https://auth.jabco.tt/realms/jag/account`
- [ ] OAuth redirect URL in response uses `https://auth.jabco.tt` (not http or wrong host)
- [ ] Login flow completes and returns JWT with correct issuer

**Authenticated Origin Pull (after enabling):**
- [ ] Direct IP access: `curl --resolve api.jabco.tt:443:<ORACLE_AMD_IP> https://api.jabco.tt/` → TLS error
- [ ] Via Cloudflare: `curl https://api.jabco.tt/health` → `200 OK`

---

## Step 10: Rollback Procedure

If something goes wrong after nameserver change:

1. Log in to TTNIC registrar portal immediately
2. Change nameservers back to the **original nameservers** (you noted these in Pre-Migration Checklist)
3. Wait for propagation (up to 48 h for `.tt` — the old TTL of 300 s helps here)
4. Diagnose the issue with Cloudflare support or this runbook before re-attempting

**What cannot be quickly rolled back:**
- If you installed the Cloudflare origin cert and removed the old cert, you'll need to restore the old cert before re-enabling the old proxy/direct setup

**Safe order of operations (prevents cert lockout):**
1. Install Cloudflare origin cert alongside existing cert (don't remove the old one yet)
2. After Cloudflare migration is stable for 7+ days → remove old cert
3. Enable Authenticated Origin Pull only after everything is confirmed working

---

## Summary of Key Configuration Values

| Item | Value |
|---|---|
| Cloudflare plan | Free |
| SSL/TLS mode | Full (Strict) |
| Origin cert type | Cloudflare Origin CA — RSA 2048, 15 years |
| Authenticated Origin Pull | Enabled (after cutover confirmed) |
| Bot Fight Mode | On |
| WAF custom rules | 5 (see Step 4) |
| HSTS max-age | 6 months (15,552,000 s) |
| Keycloak proxy setting | `KC_PROXY=edge` |

---

## Files Changed This Session

| File | Change |
|---|---|
| `JAG_PreBuild_PRE7_Cloudflare_Migration.md` | New — this runbook |

No code changes. The migration is an operational task performed in Cloudflare's dashboard and on the Oracle VM.

---

## Pre-Build Task Status (Updated)

| ID | Task | Status |
|----|------|--------|
| PRE-0A | WAL target decision | ✅ LOCKED |
| PRE-0B | Cloudflare Authenticated Origin Pull guide | ✅ DONE (content incorporated into PRE-7 Step 6) |
| PRE-1 | ERD/DBML — all 5 databases | ✅ DONE |
| PRE-2 | OpenAPI YAML contract | ✅ DONE |
| PRE-3 | Outbox migrations + jag-event-dispatcher | ✅ DONE |
| PRE-4 | Keycloak realm + clients + roles | ✅ DONE |
| PRE-5 | WiPay sandbox POC | ✅ DONE |
| PRE-6 | Bank statement parser POC (Ollama/Mistral 7B) | ✅ DONE |
| PRE-7 | Migrate JABCO domain to Cloudflare Free Tier | ✅ DONE |
| PRE-8 | Write DR failover runbook | ⬅ NEXT |
| PRE-9 | Oracle Cloud + Docker setup (Phase 0) | Pending |

---

## What Comes Next — PRE-8

**PRE-8: Write DR failover runbook**

Disaster recovery for the two-VM Oracle Always Free setup:
- **Primary:** Oracle AMD micro VM (production — all 5 databases + API + Keycloak)
- **WAL target:** Oracle Ampere VM (streaming replica — 4 OCPU, 24 GB RAM)

PRE-8 will document:
- When to failover (detection criteria)
- PostgreSQL WAL streaming promotion procedure (replica → primary)
- Cloudflare DNS update to point all A records at Ampere VM IP
- Keycloak failover (if Keycloak DB is also replicated) or restart from backup
- jag-event-dispatcher restart on Ampere
- RTO/RPO estimates
- How to re-establish replication when the AMD VM recovers (re-sync, re-subordinate)
