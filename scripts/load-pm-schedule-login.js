/**
 * Load the preventive-maintenance schedule via the JAG API, authenticating with a
 * normal browser login (OAuth authorization-code + PKCE against the public
 * `jag-web` Keycloak client). No SSH, no DB password, no manual token-copying.
 *
 * What happens when you run it:
 *   1) It opens your default browser to the JAG login.
 *   2) You're already signed in, so Keycloak bounces straight back (or you log in
 *      once with your passkey/password IN THE BROWSER — the script never sees it).
 *   3) The script gets its own access token and creates the tasks.
 *
 * It's idempotent: it reads what's already in the portal and skips duplicates, so
 * it's safe to re-run. Run from the repo root:
 *
 *   node scripts/load-pm-schedule-login.js            # preview only (no writes)
 *   node scripts/load-pm-schedule-login.js --commit   # actually create them
 *
 * Note: it briefly uses port 5173. If your jag-web dev server is running, stop it
 * first (that port has to match the login redirect Keycloak allows).
 */
'use strict';
const http = require('http');
const crypto = require('crypto');
const { exec } = require('child_process');
const fs = require('fs');

const AUTH = 'https://auth.jagcorporate.com/realms/jag/protocol/openid-connect';
const CLIENT_ID = 'jag-web';
const REDIRECT = 'http://localhost:5173/callback';
const API = 'https://jagcorporate.com/api/v1/properties/scheduled-maintenance';
const COMMIT = process.argv.includes('--commit');
const JSON_PATH = process.env.PM_JSON ||
  'C:\\Users\\rober\\My Drive (robertjohnsonattin@gmail.com) (1)\\RJA\\JAG Real Estate\\Maintenance\\pm_schedule_load.json';

const b64url = (b) => b.toString('base64url');
const verifier = b64url(crypto.randomBytes(32));
const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
const state = b64url(crypto.randomBytes(16));

const authUrl = `${AUTH}/auth?` + new URLSearchParams({
  client_id: CLIENT_ID, response_type: 'code', redirect_uri: REDIRECT,
  scope: 'openid profile email', state,
  code_challenge: challenge, code_challenge_method: 'S256',
}).toString();

async function exchange(code) {
  const res = await fetch(`${AUTH}/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code', client_id: CLIENT_ID, code,
      redirect_uri: REDIRECT, code_verifier: verifier,
    }),
  });
  if (!res.ok) throw new Error(`Token exchange failed: ${res.status} ${await res.text()}`);
  return (await res.json()).access_token;
}

async function load(token) {
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const rows = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
  console.log(`Loaded ${rows.length} tasks from the schedule.`);

  const gj = await (await fetch(API, { headers })).json();
  const existing = Array.isArray(gj) ? gj : (gj.data || []);
  const seen = new Set(existing.map((t) => `${t.property_id}|${t.title}|${t.unit_id || ''}`));
  console.log(`Portal already has ${existing.length} task(s). ${COMMIT ? '*** COMMIT MODE ***' : '--- DRY RUN (no writes) ---'}`);

  let created = 0, skipped = 0, failed = 0;
  for (const r of rows) {
    const key = `${r.property_id}|${r.title}|${r.unit_id || ''}`;
    if (seen.has(key)) { skipped++; continue; }
    if (!COMMIT) { created++; continue; }
    const body = {
      property_id: r.property_id, unit_id: r.unit_id || null, title: r.title,
      description: r.description || null, frequency: r.frequency, next_due_date: r.next_due_date,
      estimated_cost_ttd: (r.estimated_cost_ttd && r.estimated_cost_ttd > 0) ? r.estimated_cost_ttd : null,
      notes: r.notes || null,
    };
    const res = await fetch(API, { method: 'POST', headers, body: JSON.stringify(body) });
    if (res.ok || res.status === 201) { created++; seen.add(key); if (created % 25 === 0) console.log(`  ...${created} created`); }
    else { failed++; console.warn(`  ! failed (${res.status}) "${r.title}" ${(await res.text().catch(() => '')).slice(0, 120)}`); }
  }
  console.log(`\n${COMMIT ? 'CREATED' : 'WOULD CREATE'}: ${created}   skipped (already present): ${skipped}   failed: ${failed}`);
  if (!COMMIT) console.log('Re-run with --commit to actually create them.');
  else console.log('Done. Refresh Properties > Preventive Maintenance to see them.');
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, REDIRECT);
  if (!u.pathname.startsWith('/callback')) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end('<h2 style="font-family:sans-serif">Signed in — you can close this tab and return to the terminal.</h2>');
  try {
    if (u.searchParams.get('state') !== state) throw new Error('state mismatch (possible stale login) — just run the command again.');
    const token = await exchange(u.searchParams.get('code'));
    await load(token);
  } catch (e) { console.error('\n' + (e.message || e)); }
  finally { server.close(); setTimeout(() => process.exit(0), 300); }
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') console.error('Port 5173 is busy — stop the jag-web dev server (or whatever is using 5173) and run again.');
  else console.error(e);
  process.exit(1);
});

server.listen(5173, () => {
  console.log('\nOpening your browser to sign in to JAG...');
  console.log('If it does not open automatically, paste this into your browser:\n\n' + authUrl + '\n');
  exec(`start "" "${authUrl}"`, () => {});
});
