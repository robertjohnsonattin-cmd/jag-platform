# Cloudflare Authenticated Origin Pull — Setup Checklist
## PRE-0B Security Item (CRITICAL — complete before any public traffic)

The nginx.conf is already configured (`ssl_verify_client on`, `ssl_client_certificate`).
These are the operational steps to activate it on the Oracle VM.

---

## Step 1 — Cloudflare Origin Certificate (nginx cert)

1. Cloudflare Dashboard → your domain → SSL/TLS → Origin Server
2. Click **Create Certificate**
   - Private key type: RSA (2048)
   - Hostnames: `*.jabco.tt`, `jabco.tt`
   - Validity: 15 years
3. Download:
   - Certificate → save as `/etc/ssl/certs/jabco-origin.pem` on Oracle VM
   - Private Key → save as `/etc/ssl/private/jabco-origin-key.pem` on Oracle VM
4. Set permissions:
   ```bash
   chmod 644 /etc/ssl/certs/jabco-origin.pem
   chmod 600 /etc/ssl/private/jabco-origin-key.pem
   ```

---

## Step 2 — Cloudflare Authenticated Origin Pull CA Certificate

1. Download the Cloudflare Origin Pull CA certificate:
   ```bash
   curl -o /etc/ssl/certs/cloudflare-origin-pull-ca.pem \
     https://developers.cloudflare.com/ssl/static/authenticated_origin_pull_ca.pem
   chmod 644 /etc/ssl/certs/cloudflare-origin-pull-ca.pem
   ```
2. Verify it looks like a valid PEM cert:
   ```bash
   openssl x509 -in /etc/ssl/certs/cloudflare-origin-pull-ca.pem -noout -subject
   ```

---

## Step 3 — Enable Authenticated Origin Pulls in Cloudflare

1. Cloudflare Dashboard → your domain → SSL/TLS → Origin Server
2. Toggle **Authenticated Origin Pulls** to ON
3. SSL/TLS encryption mode must be set to **Full (strict)**

---

## Step 4 — Oracle Cloud Security List — Restrict Port 443

Goal: Only Cloudflare's IP ranges can reach the VM on port 443.
If this step is skipped, an attacker who discovers the VM's public IP can bypass Cloudflare entirely.

1. Oracle Cloud Console → Networking → Virtual Cloud Networks → your VCN → Security Lists
2. Find the security list for your subnet → Edit Ingress Rules
3. **Remove** any existing rule that allows `0.0.0.0/0` on port 443
4. **Add** Cloudflare IPv4 ranges (current list as of May 2026 — check https://www.cloudflare.com/ips-v4/ for updates):
   ```
   173.245.48.0/20
   103.21.244.0/22
   103.22.200.0/22
   103.31.4.0/22
   141.101.64.0/18
   108.162.192.0/18
   190.93.240.0/20
   188.114.96.0/20
   197.234.240.0/22
   198.41.128.0/17
   162.158.0.0/15
   104.16.0.0/13
   104.24.0.0/14
   172.64.0.0/13
   131.0.72.0/22
   ```
5. **Add** Cloudflare IPv6 ranges (from https://www.cloudflare.com/ips-v6/):
   ```
   2400:cb00::/32
   2606:4700::/32
   2803:f800::/32
   2405:b500::/32
   2405:8100::/32
   2a06:98c0::/29
   2c0f:f248::/32
   ```
6. Keep port 22 (SSH) allowed only from your home IP.

---

## Step 5 — Test

```bash
# This should succeed (returns nginx/API response):
curl -sv https://api.jabco.tt/health

# This should FAIL with SSL error (direct IP bypasses Cloudflare):
curl -sk https://<ORACLE_VM_PUBLIC_IP>/health
# Expected: SSL handshake error (400 — no client cert presented)
```

---

## Step 6 — Reload nginx

```bash
nginx -t && systemctl reload nginx
```
