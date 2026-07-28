/**
 * One-time backfill: pull Category / Priority / Responsible / Trade / Est Hours onto
 * the already-loaded prop_scheduled_maintenance tasks (see migration 062 -- these
 * fields didn't exist when the original 395 tasks were loaded via
 * load-pm-schedule-api.js, so they only ever lived in the source workbook's
 * "PM Master Schedule" tab).
 *
 * Reads pm_schedule_fields.json (property_name + unit_label + title -> category/
 * priority/responsible/trade/est_hours), matches each row to a live task by
 * (property_name, unit_label, title), and PATCHes the match.
 *
 * Same auth pattern as load-pm-schedule-api.js -- bearer token from your browser
 * session, dry run by default, --commit to actually write, safe to re-run.
 *
 * Usage (PowerShell, from repo root):
 *   $env:JAG_TOKEN = "eyJ...the token you copied..."
 *   node scripts/backfill-pm-schedule-fields.js            # dry run
 *   node scripts/backfill-pm-schedule-fields.js --commit    # actually patch
 */
'use strict';
const fs = require('fs');

const BASE = 'https://jagcorporate.com/api/v1/properties/scheduled-maintenance';
const TOKEN = process.env.JAG_TOKEN;
const COMMIT = process.argv.includes('--commit');
const JSON_PATH = process.env.PM_FIELDS_JSON ||
  'C:\\Users\\rober\\My Drive (robertjohnsonattin@gmail.com) (1)\\RJA\\JAG Real Estate\\Maintenance\\pm_schedule_fields.json';

if (!TOKEN) { console.error('JAG_TOKEN env var required (copy the bearer token from your browser).'); process.exit(1); }
const AUTH = TOKEN.replace(/^Bearer\s+/i, '');
const headers = { 'Authorization': `Bearer ${AUTH}`, 'Content-Type': 'application/json' };

function key(propertyName, unitLabel, title) {
  return `${(propertyName || '').trim()}|${(unitLabel || '').trim()}|${(title || '').trim()}`;
}

async function run() {
  const fieldRows = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
  console.log(`Loaded ${fieldRows.length} field rows from the workbook.`);

  const getRes = await fetch(BASE, { headers });
  if (getRes.status === 401) { console.error('401 Unauthorized — your token is missing/expired. Copy a fresh one and re-run.'); process.exit(1); }
  if (!getRes.ok) { console.error(`Could not read existing tasks: HTTP ${getRes.status}`); process.exit(1); }
  const gj = await getRes.json();
  const existing = Array.isArray(gj) ? gj : (gj.data || []);
  console.log(`Portal has ${existing.length} live task(s). ${COMMIT ? '*** COMMIT MODE ***' : '--- DRY RUN (no writes) ---'}`);

  const byKey = new Map();
  for (const t of existing) {
    byKey.set(key(t.property_name, t.unit_number, t.title), t);
  }

  let matched = 0, patched = 0, unmatched = 0, alreadySet = 0, failed = 0;
  const unmatchedRows = [];

  for (const r of fieldRows) {
    const task = byKey.get(key(r.property_name, r.unit_label, r.title));
    if (!task) { unmatched++; unmatchedRows.push(`${r.property_name} | ${r.unit_label || ''} | ${r.title}`); continue; }
    matched++;

    // Skip if already fully populated (idempotent re-run)
    if (task.category && task.priority && task.responsible) { alreadySet++; continue; }

    const body = {
      category: r.category || undefined,
      priority: r.priority || undefined,
      responsible: r.responsible || undefined,
      trade: r.trade || undefined,
      est_hours: (r.est_hours && r.est_hours > 0) ? r.est_hours : undefined,
    };

    if (!COMMIT) { patched++; continue; }

    const res = await fetch(`${BASE}/${task.id}`, { method: 'PATCH', headers, body: JSON.stringify(body) });
    if (res.status === 401) { console.error(`\n401 mid-run — token expired after ${patched} patches. Copy a fresh token and re-run (safe; it resumes).`); break; }
    if (res.ok) { patched++; if (patched % 25 === 0) process.stdout.write(`  ...${patched} patched\n`); }
    else { failed++; const txt = await res.text().catch(() => ''); console.warn(`  ! failed (${res.status}) "${r.title}" ${txt.slice(0, 120)}`); }
  }

  console.log(`\nMatched: ${matched}   ${COMMIT ? 'PATCHED' : 'WOULD PATCH'}: ${patched}   already set (skipped): ${alreadySet}   failed: ${failed}   unmatched: ${unmatched}`);
  if (unmatchedRows.length) {
    console.log('\nUnmatched workbook rows (not found among live tasks -- check title/property/unit drift):');
    unmatchedRows.forEach(u => console.log('  - ' + u));
  }
  if (!COMMIT) console.log('\nRe-run with --commit to actually patch these.');
  else console.log('\nDone. Refresh Properties > Preventive Maintenance to see the new fields.');
}

run().catch(err => { console.error(err); process.exit(1); });
