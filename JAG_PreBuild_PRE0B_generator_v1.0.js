// JAG Pre-Build PRE-0B: Cloudflare Authenticated Origin Pull — Configuration Guide v1.0
// Robert Johnson-Attin / Johnson Attin Group
// Generated: May 2026
// Purpose: Step-by-step guide to lock down Oracle VM so only Cloudflare can reach it on port 443.
//          Must be completed before any application is deployed to the Oracle VM.

const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  HeadingLevel, AlignmentType, BorderStyle, WidthType, ShadingType,
  PageNumber, PageBreak, LevelFormat, Header, Footer
} = require('docx');
const fs = require('fs');

// ─── Brand colours ───────────────────────────────────────────────────────────
const JAG_BLUE       = "1F3864";
const JAG_LIGHT_BLUE = "D5E8F0";
const JAG_GOLD       = "C9A84C";
const JAG_GOLD_LIGHT = "FFF3CD";
const JAG_GREEN      = "1E6B3C";
const JAG_GREEN_LIGHT= "D4EDDA";
const JAG_RED_LIGHT  = "FCE4D6";
const JAG_GREY       = "F2F2F2";
const WHITE          = "FFFFFF";
const BORDER_COLOR   = "CCCCCC";

const border   = { style: BorderStyle.SINGLE, size: 1, color: BORDER_COLOR };
const borders  = { top: border, bottom: border, left: border, right: border };
const noBorder = { style: BorderStyle.NONE,   size: 0, color: "FFFFFF" };
const noBorders= { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder };

// ─── Typography helpers ───────────────────────────────────────────────────────
function h1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 400, after: 200 },
    children: [new TextRun({ text, bold: true, size: 36, color: JAG_BLUE, font: "Arial" })]
  });
}
function h2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 300, after: 160 },
    children: [new TextRun({ text, bold: true, size: 28, color: JAG_BLUE, font: "Arial" })]
  });
}
function h3(text) {
  return new Paragraph({
    spacing: { before: 200, after: 120 },
    children: [new TextRun({ text, bold: true, size: 24, color: JAG_GOLD, font: "Arial" })]
  });
}
function body(text, opts = {}) {
  return new Paragraph({
    spacing: { before: 80, after: 80 },
    children: [new TextRun({ text, size: 22, font: "Arial", ...opts })]
  });
}
function code(text) {
  return new Paragraph({
    spacing: { before: 60, after: 60 },
    indent: { left: 720 },
    children: [new TextRun({ text, size: 20, font: "Courier New", color: "1F3864" })]
  });
}
function bullet(text, bold = false) {
  return new Paragraph({
    numbering: { reference: "bullets", level: 0 },
    spacing: { before: 60, after: 60 },
    children: [new TextRun({ text, size: 22, font: "Arial", bold })]
  });
}
function numberedStep(text) {
  return new Paragraph({
    numbering: { reference: "numbers", level: 0 },
    spacing: { before: 80, after: 80 },
    children: [new TextRun({ text, size: 22, font: "Arial" })]
  });
}
function spacer() {
  return new Paragraph({ spacing: { before: 120, after: 120 }, children: [new TextRun("")] });
}
function pageBreak() {
  return new Paragraph({ children: [new PageBreak()] });
}
function divider() {
  return new Paragraph({
    spacing: { before: 200, after: 200 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: JAG_BLUE, space: 1 } },
    children: [new TextRun("")]
  });
}

function colorBox(text, fillColor, textColor = "000000", bold = false) {
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [9360],
    rows: [new TableRow({
      children: [new TableCell({
        borders,
        width: { size: 9360, type: WidthType.DXA },
        shading: { fill: fillColor, type: ShadingType.CLEAR },
        margins: { top: 120, bottom: 120, left: 160, right: 160 },
        children: [new Paragraph({
          spacing: { before: 60, after: 60 },
          children: [new TextRun({ text, size: 22, font: "Arial", color: textColor, bold })]
        })]
      })]
    })]
  });
}

function makeTable(headers, rows, colWidths) {
  const totalWidth = colWidths.reduce((a, b) => a + b, 0);
  const headerRow = new TableRow({
    tableHeader: true,
    children: headers.map((h, i) => new TableCell({
      borders,
      width: { size: colWidths[i], type: WidthType.DXA },
      shading: { fill: JAG_BLUE, type: ShadingType.CLEAR },
      margins: { top: 80, bottom: 80, left: 120, right: 120 },
      children: [new Paragraph({
        children: [new TextRun({ text: h, size: 20, font: "Arial", bold: true, color: WHITE })]
      })]
    }))
  });
  const dataRows = rows.map((row, ri) => new TableRow({
    children: row.map((cell, ci) => new TableCell({
      borders,
      width: { size: colWidths[ci], type: WidthType.DXA },
      shading: { fill: ri % 2 === 0 ? WHITE : JAG_GREY, type: ShadingType.CLEAR },
      margins: { top: 80, bottom: 80, left: 120, right: 120 },
      children: [new Paragraph({
        children: [new TextRun({ text: cell, size: 20, font: "Arial" })]
      })]
    }))
  }));
  return new Table({
    width: { size: totalWidth, type: WidthType.DXA },
    columnWidths: colWidths,
    rows: [headerRow, ...dataRows]
  });
}

function sectionHeader(title) {
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [9360],
    rows: [new TableRow({
      children: [new TableCell({
        borders: noBorders,
        width: { size: 9360, type: WidthType.DXA },
        shading: { fill: JAG_BLUE, type: ShadingType.CLEAR },
        margins: { top: 120, bottom: 120, left: 200, right: 200 },
        children: [new Paragraph({
          children: [new TextRun({ text: title, bold: true, size: 28, color: WHITE, font: "Arial" })]
        })]
      })]
    })]
  });
}

// ─── Cloudflare IPv4 ranges (current as of May 2026) ─────────────────────────
const CF_IPV4 = [
  "173.245.48.0/20",
  "103.21.244.0/22",
  "103.22.200.0/22",
  "103.31.4.0/22",
  "141.101.64.0/18",
  "108.162.192.0/18",
  "190.93.240.0/20",
  "188.114.96.0/20",
  "197.234.240.0/22",
  "198.41.128.0/17",
  "162.158.0.0/15",
  "104.16.0.0/13",
  "104.24.0.0/14",
  "172.64.0.0/13",
  "131.0.72.0/22"
];

const CF_IPV6 = [
  "2400:cb00::/32",
  "2606:4700::/32",
  "2803:f800::/32",
  "2405:b500::/32",
  "2405:8100::/32",
  "2a06:98c0::/29",
  "2c0f:f248::/32"
];

// ─── Document ─────────────────────────────────────────────────────────────────
const doc = new Document({
  numbering: {
    config: [
      {
        reference: "bullets",
        levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } } }]
      },
      {
        reference: "numbers",
        levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } } }]
      }
    ]
  },
  styles: {
    default: { document: { run: { font: "Arial", size: 22 } } }
  },
  sections: [{
    properties: {
      page: {
        size: { width: 12240, height: 15840 },
        margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 }
      }
    },
    headers: {
      default: new Header({
        children: [new Paragraph({
          border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: JAG_BLUE, space: 1 } },
          children: [
            new TextRun({ text: "JAG Platform — PRE-0B: Cloudflare Authenticated Origin Pull", size: 18, font: "Arial", color: "888888" }),
            new TextRun({ text: "\tJohnson Attin Group  |  Pre-Build  |  Confidential", size: 18, font: "Arial", color: "888888" }),
          ],
          tabStops: [{ type: "right", position: 9360 }]
        })]
      })
    },
    footers: {
      default: new Footer({
        children: [new Paragraph({
          border: { top: { style: BorderStyle.SINGLE, size: 4, color: JAG_BLUE, space: 1 } },
          children: [
            new TextRun({ text: "JAG_PreBuild_PRE0B_v1.0  |  May 2026  |  OFFLINE ONLY — do NOT share digitally", size: 16, font: "Arial", color: "888888" }),
            new TextRun({ text: "\tPage ", size: 16, font: "Arial", color: "888888" }),
            new TextRun({ children: [PageNumber.CURRENT], size: 16, font: "Arial", color: "888888" }),
          ],
          tabStops: [{ type: "right", position: 9360 }]
        })]
      })
    },
    children: [

      // ── TITLE BLOCK ────────────────────────────────────────────────────────
      spacer(),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 200, after: 100 },
        children: [new TextRun({ text: "JAG PLATFORM", bold: true, size: 44, color: JAG_BLUE, font: "Arial" })]
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 60, after: 60 },
        children: [new TextRun({ text: "PRE-0B: Cloudflare Authenticated Origin Pull", bold: true, size: 32, color: JAG_GOLD, font: "Arial" })]
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 60, after: 200 },
        children: [new TextRun({ text: "Configuration Guide — Pre-Build Day 1  |  v1.0  |  May 2026", size: 22, color: "666666", font: "Arial" })]
      }),
      divider(),
      spacer(),

      colorBox(
        "SECURITY CRITICAL — MUST COMPLETE BEFORE ANY APPLICATION IS DEPLOYED TO ORACLE VM. " +
        "This step closes the attack surface that would otherwise allow anyone to bypass Cloudflare " +
        "by hitting your Oracle VM's public IP directly. Do this before Phase 0, before any containers are running.",
        JAG_BLUE, WHITE, true
      ),
      spacer(),

      // ── SECTION 1: OVERVIEW ───────────────────────────────────────────────
      sectionHeader("1. WHY THIS MATTERS"),
      spacer(),
      body("Your Oracle VM has a public IP address. Once you point your domain at Cloudflare, traffic flows: User → Cloudflare → Oracle VM. Cloudflare provides DDoS protection, WAF, TLS termination, and hides your real IP. BUT — by default, anyone who discovers your Oracle VM's public IP can bypass Cloudflare entirely and talk to your applications directly. This defeats all of Cloudflare's security."),
      spacer(),
      body("Authenticated Origin Pull fixes this with two locks:"),
      spacer(),
      bullet("Lock 1 — Oracle Security List (network firewall): Only Cloudflare's published IP ranges are allowed to reach port 443 on your VM. All other sources are silently dropped at the network level before they even touch your VM."),
      bullet("Lock 2 — Caddy TLS client auth: Even if traffic somehow reaches port 443, Caddy requires the connecting client to present Cloudflare's Origin Pull certificate. Requests without it are rejected at the TLS handshake."),
      spacer(),
      body("Both locks must be in place. Either alone is insufficient."),
      spacer(),

      makeTable(
        ["", "Description", "Where Configured"],
        [
          ["Lock 1", "Block all non-Cloudflare IPs on port 443", "Oracle Cloud Console → VCN Security List"],
          ["Lock 2", "Require Cloudflare client certificate on TLS", "Caddy → Caddyfile (tls client_auth)"],
          ["Test", "Direct IP access must be rejected", "curl from your machine — must fail"],
        ],
        [480, 5400, 3480]
      ),
      spacer(),

      // ── SECTION 2: PREREQUISITES ──────────────────────────────────────────
      sectionHeader("2. PREREQUISITES"),
      spacer(),
      body("Confirm all of the following before starting:"),
      spacer(),
      bullet("Oracle Cloud Always Free account exists and Ubuntu VM is provisioned (4 OCPU, 24 GB RAM Ampere — or AMD micro if Ampere unavailable)"),
      bullet("Caddy is installed on the VM (or you have a Caddyfile ready to configure)"),
      bullet("Your JABCO domain is on Cloudflare Free Tier (or you are about to migrate it — PRE-7)"),
      bullet("You have SSH access to the Oracle VM"),
      bullet("You have login access to the Oracle Cloud Console (cloud.oracle.com)"),
      bullet("You have login access to the Cloudflare Dashboard (dash.cloudflare.com)"),
      spacer(),
      colorBox(
        "NOTE: Cloudflare DNS migration (PRE-7) and this step (PRE-0B) can be done in either order, but " +
        "Authenticated Origin Pull only activates once your domain is actually proxied through Cloudflare (orange cloud icon). " +
        "You can complete all configuration steps now and activate the Cloudflare toggle after DNS migration.",
        JAG_GOLD_LIGHT
      ),
      spacer(),

      pageBreak(),

      // ── SECTION 3: DOWNLOAD CF ORIGIN PULL CERT ───────────────────────────
      sectionHeader("3. STEP 1 — Download Cloudflare Origin Pull CA Certificate"),
      spacer(),
      body("Cloudflare presents a client certificate when making requests to your origin. You need to download Cloudflare's Origin Pull CA certificate and save it on the VM so Caddy can validate incoming client certificates against it."),
      spacer(),
      h3("3.1 On your Oracle VM (via SSH):"),
      spacer(),
      body("Connect to your VM and run:"),
      spacer(),
      code("ssh ubuntu@<YOUR_VM_PUBLIC_IP>"),
      spacer(),
      body("Download the Cloudflare Authenticated Origin Pull CA certificate:"),
      spacer(),
      code("sudo mkdir -p /etc/caddy/tls"),
      code("sudo curl -o /etc/caddy/tls/cloudflare-origin-pull-ca.pem \\"),
      code("  https://developers.cloudflare.com/ssl/static/authenticated_origin_pull_ca.pem"),
      spacer(),
      body("Verify the file downloaded correctly — it should show a certificate block:"),
      spacer(),
      code("sudo cat /etc/caddy/tls/cloudflare-origin-pull-ca.pem"),
      spacer(),
      body("Expected output starts with:"),
      code("-----BEGIN CERTIFICATE-----"),
      code("MIIGCjCCA..."),
      code("-----END CERTIFICATE-----"),
      spacer(),
      body("Set correct permissions:"),
      spacer(),
      code("sudo chown root:caddy /etc/caddy/tls/cloudflare-origin-pull-ca.pem"),
      code("sudo chmod 640 /etc/caddy/tls/cloudflare-origin-pull-ca.pem"),
      spacer(),

      // ── SECTION 4: ENABLE IN CF DASHBOARD ────────────────────────────────
      sectionHeader("4. STEP 2 — Enable Authenticated Origin Pulls in Cloudflare Dashboard"),
      spacer(),
      body("This tells Cloudflare to present its client certificate when connecting to your origin. Without this toggle, the cert is never sent and Caddy's client_auth check will reject all traffic — including legitimate traffic from Cloudflare."),
      spacer(),
      numberedStep("Log in to dash.cloudflare.com"),
      numberedStep("Select your domain (your JABCO domain)"),
      numberedStep("Go to SSL/TLS → Origin Server"),
      numberedStep("Scroll to Authenticated Origin Pulls"),
      numberedStep("Toggle it ON"),
      numberedStep("Click Save"),
      spacer(),
      colorBox(
        "IMPORTANT: This toggle must be ON before you activate the Caddy client_auth configuration " +
        "(Step 3). If you enable Caddy client_auth first, all traffic — including legitimate Cloudflare " +
        "traffic — will be rejected until this toggle is on. Safe sequence: (1) download cert, " +
        "(2) enable dashboard toggle, (3) update Caddy config, (4) restrict Security List.",
        JAG_GOLD_LIGHT
      ),
      spacer(),

      pageBreak(),

      // ── SECTION 5: CADDY CONFIG ───────────────────────────────────────────
      sectionHeader("5. STEP 3 — Configure Caddy to Require Client Certificate"),
      spacer(),
      body("Edit your Caddyfile (typically at /etc/caddy/Caddyfile) to add TLS client authentication. This is the configuration for the pre-build state — before applications are running. Update the reverse_proxy target as each service comes online."),
      spacer(),
      h3("5.1 Caddyfile — Pre-Build Skeleton:"),
      spacer(),
      code("{"),
      code("    # Global options"),
      code("    email your-email@example.com"),
      code("}"),
      spacer(),
      code("your-jabco-domain.com {"),
      code("    tls {"),
      code("        client_auth {"),
      code("            mode require_and_verify"),
      code("            trusted_ca_cert_file /etc/caddy/tls/cloudflare-origin-pull-ca.pem"),
      code("        }"),
      code("    }"),
      spacer(),
      code("    # Health check endpoint (no auth required at app layer during pre-build)"),
      code("    respond /health 200"),
      spacer(),
      code("    # All other traffic — update this once apps are deployed"),
      code("    respond \"JAG Platform — Pre-Build\" 200"),
      code("}"),
      spacer(),
      h3("5.2 Apply the configuration:"),
      spacer(),
      code("sudo caddy fmt --overwrite /etc/caddy/Caddyfile"),
      code("sudo caddy validate --config /etc/caddy/Caddyfile"),
      code("sudo systemctl reload caddy"),
      spacer(),
      body("Check Caddy is running cleanly:"),
      spacer(),
      code("sudo systemctl status caddy"),
      code("sudo journalctl -u caddy --since '2 minutes ago'"),
      spacer(),
      body("Expected: no errors. If Caddy fails to start, check: (1) the cert file path is correct, (2) Caddy has read permission on the cert file, (3) Caddyfile syntax is valid."),
      spacer(),

      pageBreak(),

      // ── SECTION 6: ORACLE SECURITY LIST ──────────────────────────────────
      sectionHeader("6. STEP 4 — Restrict Oracle Security List to Cloudflare IPs Only"),
      spacer(),
      body("This is the network-level firewall. You will replace the existing \"allow all\" ingress rule on port 443 with 15 rules — one per Cloudflare IPv4 range. Requests from any other source are dropped at the network edge before touching your VM."),
      spacer(),
      h3("6.1 Navigate to the Security List:"),
      spacer(),
      numberedStep("Log in to cloud.oracle.com"),
      numberedStep("Open the navigation menu (top left) → Networking → Virtual Cloud Networks"),
      numberedStep("Click your VCN (created during Phase 0 setup)"),
      numberedStep("In the left panel click Security Lists"),
      numberedStep("Click the Default Security List (or the one attached to your public subnet)"),
      numberedStep("Click Edit All Rules"),
      spacer(),
      h3("6.2 Remove the existing permissive port 443 rule:"),
      spacer(),
      body("Find the ingress rule that allows 0.0.0.0/0 on TCP port 443. Delete it."),
      spacer(),
      h3("6.3 Add one ingress rule per Cloudflare IPv4 range:"),
      spacer(),
      body("For each IP range below, click Add Ingress Rule and enter:"),
      spacer(),
      bullet("Source Type: CIDR"),
      bullet("IP Protocol: TCP"),
      bullet("Destination Port Range: 443"),
      bullet("Description: Cloudflare Origin Pull — [the CIDR]"),
      spacer(),
      body("Cloudflare IPv4 ranges to add (15 rules total — current as of May 2026):"),
      spacer(),
      ...CF_IPV4.map(cidr => code(`    ${cidr}`)),
      spacer(),
      colorBox(
        "IPv6: If your Oracle VM has an IPv6 address assigned and your VCN has IPv6 enabled, " +
        "also add ingress rules for the following Cloudflare IPv6 ranges: " +
        CF_IPV6.join("  |  "),
        JAG_LIGHT_BLUE
      ),
      spacer(),
      h3("6.4 Save the Security List."),
      spacer(),
      body("Oracle applies the rules within 30-60 seconds. No VM restart needed."),
      spacer(),
      h3("6.5 OS-level firewall (Ubuntu ufw):"),
      spacer(),
      body("Oracle VMs also have a local OS firewall. Restrict port 443 at the OS level as a second layer:"),
      spacer(),
      code("# Delete any existing permissive port 443 rule"),
      code("sudo ufw delete allow 443/tcp"),
      spacer(),
      code("# Add one rule per Cloudflare range"),
      ...CF_IPV4.map(cidr => code(`sudo ufw allow from ${cidr} to any port 443 proto tcp comment "Cloudflare"`)),
      spacer(),
      code("# Reload ufw"),
      code("sudo ufw reload"),
      code("sudo ufw status verbose"),
      spacer(),

      pageBreak(),

      // ── SECTION 7: TEST ───────────────────────────────────────────────────
      sectionHeader("7. STEP 5 — Test: Direct IP Access Must Fail"),
      spacer(),
      body("Run these tests from your own machine (not from the Oracle VM itself). A passing test means the security configuration is working correctly."),
      spacer(),
      h3("Test A — Direct IP access (must FAIL):"),
      spacer(),
      code("curl -v --max-time 10 https://<YOUR_VM_PUBLIC_IP>"),
      spacer(),
      body("Expected result: Connection timed out OR connection refused. If you get any HTTP response (even an error page), the Security List is not yet active — wait 60 seconds and retry."),
      spacer(),
      h3("Test B — Domain access through Cloudflare (must SUCCEED):"),
      spacer(),
      code("curl -v --max-time 10 https://your-jabco-domain.com/health"),
      spacer(),
      body("Expected result: HTTP 200 OK. If this fails, check: (1) Cloudflare DNS is active for the domain with orange cloud icon, (2) the Authenticated Origin Pulls toggle is ON in Cloudflare dashboard, (3) Caddy is running and the Caddyfile is correct."),
      spacer(),
      h3("Test C — Simulate non-Cloudflare request (must FAIL):"),
      spacer(),
      body("From a VPN or different IP, or using curl with --resolve to bypass Cloudflare:"),
      spacer(),
      code("curl -v --max-time 10 --resolve your-jabco-domain.com:443:<YOUR_VM_IP> https://your-jabco-domain.com/"),
      spacer(),
      body("Expected result: TLS handshake failure (SSL error). This confirms Caddy is requiring the Cloudflare client certificate — a direct request without it is rejected even if the IP somehow bypasses the Security List."),
      spacer(),
      colorBox("PRE-0B COMPLETE when: Test A fails (timeout/refused) + Test B succeeds (HTTP 200) + Test C fails (TLS error). Record the date completed below.", JAG_GREEN_LIGHT),
      spacer(),
      body("Date PRE-0B completed: ___________________________"),
      body("Tested by: Robert Johnson-Attin"),
      spacer(),

      pageBreak(),

      // ── SECTION 8: MAINTENANCE ─────────────────────────────────────────────
      sectionHeader("8. MAINTENANCE — Keeping Cloudflare IP Ranges Current"),
      spacer(),
      body("Cloudflare periodically updates its published IP ranges. If they add a new IP range and your Security List doesn't include it, traffic from that new range will be blocked — your site will appear partially down to some users."),
      spacer(),
      h3("8.1 Check for updates:"),
      spacer(),
      bullet("Cloudflare publishes the authoritative list at: https://www.cloudflare.com/ips/"),
      bullet("Subscribe to Cloudflare's system status notifications at status.cloudflare.com"),
      bullet("Review your Oracle Security List against the published list quarterly (add a calendar reminder)"),
      spacer(),
      h3("8.2 Semi-automated check (run quarterly):"),
      spacer(),
      body("This script prints any Cloudflare IPs not yet in your Security List (for comparison — does not auto-update):"),
      spacer(),
      code("curl -s https://www.cloudflare.com/ips-v4 | sort > /tmp/cf_current.txt"),
      code("# Compare with your Security List rules manually"),
      spacer(),
      colorBox(
        "Phase 1A consideration: During Phase 1A (auth service build), add a scheduled cron job " +
        "that checks Cloudflare's published IP list weekly and sends a notification if the list " +
        "has changed. This can be a simple bash script that emails Robert via the notification tier. " +
        "Automate the Security List update via Oracle Cloud CLI in Phase 2.",
        JAG_LIGHT_BLUE
      ),
      spacer(),

      // ── SECTION 9: ROLLBACK ────────────────────────────────────────────────
      sectionHeader("9. ROLLBACK PROCEDURE"),
      spacer(),
      body("If Authenticated Origin Pull causes an outage (e.g., Cloudflare adds new IPs and your Security List blocks them), rollback is fast:"),
      spacer(),
      numberedStep("Oracle Cloud Console → Security List → temporarily re-add 0.0.0.0/0 on port 443 to restore access"),
      numberedStep("Diagnose: check Cloudflare's current IP list at cloudflare.com/ips and add any missing ranges"),
      numberedStep("Remove the temporary 0.0.0.0/0 rule once the correct Cloudflare IPs are in place"),
      spacer(),
      body("To fully disable Authenticated Origin Pull (not recommended for production):"),
      spacer(),
      numberedStep("Cloudflare Dashboard → SSL/TLS → Origin Server → toggle Authenticated Origin Pulls OFF"),
      numberedStep("Remove the tls { client_auth { ... } } block from Caddyfile"),
      numberedStep("Run: sudo systemctl reload caddy"),
      spacer(),

      // ── SECTION 10: SUMMARY TABLE ─────────────────────────────────────────
      sectionHeader("10. COMPLETION CHECKLIST"),
      spacer(),
      makeTable(
        ["Step", "Action", "Status"],
        [
          ["3", "Downloaded Cloudflare Origin Pull CA cert to /etc/caddy/tls/", "[ ] Done"],
          ["4", "Authenticated Origin Pulls toggled ON in Cloudflare Dashboard", "[ ] Done"],
          ["5", "Caddy tls client_auth configured and service reloaded", "[ ] Done"],
          ["6a", "Oracle Security List — 0.0.0.0/0 rule on 443 removed", "[ ] Done"],
          ["6b", "Oracle Security List — 15 Cloudflare IPv4 rules added", "[ ] Done"],
          ["6c", "Ubuntu ufw — Cloudflare-only rules applied", "[ ] Done"],
          ["7A", "Test A passed: direct IP access times out", "[ ] Pass"],
          ["7B", "Test B passed: domain via Cloudflare returns HTTP 200", "[ ] Pass"],
          ["7C", "Test C passed: direct domain request gets TLS error", "[ ] Pass"],
          ["—", "Date completed recorded above (Section 7)", "[ ] Done"],
        ],
        [480, 6000, 2880]
      ),
      spacer(),
      colorBox(
        "PRE-0B DONE. Next: PRE-1 — ERD/DBML for all five databases (jag_core, jag_commercial, " +
        "jag_entertainment, jag_family, jag_properties). Include pending_events outbox table in " +
        "each database schema. Start a new Claude session and load JAG_AI_Context_Summary_v2.1.docx.",
        JAG_BLUE, WHITE, true
      ),
      spacer(),

      divider(),
      spacer(),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({
          text: "JAG Platform PRE-0B  |  Johnson Attin Group  |  Confidential — Offline Only  |  May 2026",
          size: 18, font: "Arial", color: "888888"
        })]
      }),
    ]
  }]
});

Packer.toBuffer(doc).then(buffer => {
  const outputPath = process.argv[2] || './JAG_PreBuild_PRE0B_v1.0.docx';
  fs.writeFileSync(outputPath, buffer);
  console.log(`Done: ${outputPath}`);
}).catch(err => {
  console.error('Error generating document:', err);
  process.exit(1);
});
