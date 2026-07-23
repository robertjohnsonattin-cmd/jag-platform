/**
 * Load the preventive-maintenance schedule via the JAG API (no SSH / DB / pg needed).
 *
 * Uses Node's built-in fetch (Node 18+). Authenticates with a bearer token you
 * copy from your own logged-in browser session — the token never goes to anyone
 * else. Idempotent: reads existing tasks first and skips any already present
 * (matched on property_id + title + unit_id), so it is safe to re-run.
 *
 * Steps:
 *   1) In your browser on https://jagcorporate.com (logged in), open DevTools (F12)
 *      -> Network tab -> click any request to  /api/v1/...  -> Headers ->
 *      copy the value of the "authorization" header AFTER the word "Bearer ".
 *   2) In PowerShell (from the repo root):
 *        $env:JAG_TOKEN = "eyJ...the token you copied..."
 *        node scripts/load-pm-schedule-api.js            # dry run, writes nothing
 *        node scripts/load-pm-schedule-api.js --commit   # actually create them
 *
 * Tokens expire after a few minutes. If you see 401s, copy a fresh token and
 * re-run — already-created tasks are skipped automatically.
 */
'use strict';
const fs = require('fs');

const BASE = 'https://jagcorporate.com/api/v1/properties/scheduled-maintenance';
const TOKEN = process.env.JAG_TOKEN;
const COMMIT = process.argv.includes('--commit');
const JSON_PATH = process.env.PM_JSON ||
  'C:\\Users\\rober\\My Drive (robertjohnsonattin@gmail.com) (1)\\RJA\\JAG Real Estate\\Maintenance\\pm_schedule_load.json';

if (!TOKEN) { console.error('JAG_TOKEN env var required (copy the bearer token from your browser).'); process.exit(1); }
const AUTH = TOKEN.replace(/^Bearer\s+/i, '');
const headers = { 'Authorization': `Bearer ${AUTH}`, 'Content-Type': 'application/json' };

async function run() {
  const rows = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
  console.log(`Loaded ${rows.length} tasks from the schedule.`);

  // 1. fetch existing tasks (verifies the token + gives us idempotency)
  const getRes = await fetch(BASE, { headers });
  if (getRes.status === 401) { console.error('401 Unauthorized — your token is missing/expired. Copy a fresh one and re-run.'); process.exit(1); }
  if (!getRes.ok) { console.error(`Could not read existing tasks: HTTP ${getRes.status}`); process.exit(1); }
  const gj = await getRes.json();
  const existing = Array.isArray(gj) ? gj : (gj.data || []);
  const seen = new Set(existing.map(t => `${t.property_id}|${t.title}|${t.unit_id || ''}`));
  console.log(`Portal already has ${existing.length} task(s). ${COMMIT ? '*** COMMIT MODE ***' : '--- DRY RUN (no writes) ---'}`);

  let created = 0, skipped = 0, failed = 0;
  for (const r of rows) {
    const key = `${r.property_id}|${r.title}|${r.unit_id || ''}`;
    if (seen.has(key)) { skipped++; continue; }

    const body = {
      property_id: r.property_id,
      unit_id: r.unit_id || null,
      title: r.title,
      description: r.description || null,
      frequency: r.frequency,
      next_due_date: r.next_due_date,
      estimated_cost_ttd: (r.estimated_cost_ttd && r.estimated_cost_ttd > 0) ? r.estimated_cost_ttd : null,
      notes: r.notes || null,
    };

    if (!COMMIT) { created++; continue; }

    const res = await fetch(BASE, { method: 'POST', headers, body: JSON.stringify(body) });
    if (res.status === 401) { console.error(`\n401 mid-run — token expired after ${created} inserts. Copy a fresh token and re-run (safe; it resumes).`); break; }
    if (res.status === 201 || res.ok) { created++; seen.add(key); if (created % 25 === 0) process.stdout.write(`  ...${created} created\n`); }
    else { failed++; const txt = await res.text().catch(() => ''); console.warn(`  ! failed (${res.status}) "${r.title}" ${txt.slice(0,120)}`); }
  }

  console.log(`\n${COMMIT ? 'CREATED' : 'WOULD CREATE'}: ${created}   skipped (already present): ${skipped}   failed: ${failed}`);
  if (!COMMIT) console.log('Re-run with --commit to actually create these.');
  else console.log('Done. Refresh Properties > Preventive Maintenance to see them.');
}

run().catch(err => { console.error(err); process.exit(1); });
