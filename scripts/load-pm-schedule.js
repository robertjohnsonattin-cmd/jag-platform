/**
 * Bulk-load the preventive-maintenance schedule into prop_scheduled_maintenance.
 *
 * Mirrors scripts/migrate-insurance.js: direct pg insert over the SSH tunnel,
 * owner-scoped via app.current_owner_id RLS. Idempotent — re-running skips any
 * task already present (matched on property_id + title + unit_id), so it is safe
 * to run repeatedly and after regenerating the JSON.
 *
 * Requires SSH tunnel:  ssh -L 15432:localhost:5432 ubuntu@150.136.151.64
 * Env:  JAG_APP_PASSWORD (required), PGHOST (def 127.0.0.1), PGPORT (def 15432),
 *       PM_JSON (path to pm_schedule_load.json)
 *
 * Dry run (default, writes nothing):   node scripts/load-pm-schedule.js
 * Commit:                              node scripts/load-pm-schedule.js --commit
 */
'use strict';
const fs = require('fs');
const { Client } = require('pg');

const HOST = process.env.PGHOST || '127.0.0.1';
const PORT = parseInt(process.env.PGPORT || '15432', 10);
const USER = 'jag_app';
const PASS = process.env.JAG_APP_PASSWORD;
const OWNER_ID = '95ca3f77-60ba-4a0f-af70-2832b247b525';   // Robert's jag_core users.id
const COMMIT = process.argv.includes('--commit');
const JSON_PATH = process.env.PM_JSON ||
  'C:\\Users\\rober\\My Drive (robertjohnsonattin@gmail.com) (1)\\RJA\\JAG Real Estate\\Maintenance\\pm_schedule_load.json';

if (!PASS) { console.error('JAG_APP_PASSWORD env var required'); process.exit(1); }

const FREQ_OK = new Set(['WEEKLY','MONTHLY','QUARTERLY','BIANNUAL','ANNUAL','ONE_TIME']);

async function run() {
  const rows = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
  console.log(`Loaded ${rows.length} tasks from ${JSON_PATH}`);
  console.log(COMMIT ? '*** COMMIT MODE — writing to jag_properties ***' : '--- DRY RUN (no writes) — add --commit to apply ---');

  const client = new Client({ host: HOST, port: PORT, user: USER, password: PASS, database: 'jag_properties', ssl: false });
  await client.connect();
  // session-level owner context for RLS (persists across statements on this connection)
  await client.query(`SELECT set_config('app.current_owner_id', $1, false)`, [OWNER_ID]);

  let inserted = 0, skipped = 0, bad = 0;
  if (COMMIT) await client.query('BEGIN');
  try {
    for (const r of rows) {
      if (!r.property_id || !r.title || !r.next_due_date || !FREQ_OK.has(r.frequency)) {
        console.warn('  ! skipping malformed row:', r.title || '(no title)'); bad++; continue;
      }
      const exists = await client.query(
        `SELECT 1 FROM prop_scheduled_maintenance
         WHERE property_id = $1 AND title = $2 AND unit_id IS NOT DISTINCT FROM $3 LIMIT 1`,
        [r.property_id, r.title, r.unit_id || null]);
      if (exists.rowCount) { skipped++; continue; }

      if (COMMIT) {
        await client.query(
          `INSERT INTO prop_scheduled_maintenance
             (owner_id, property_id, unit_id, title, description, frequency,
              next_due_date, estimated_cost_ttd, status, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'ACTIVE',$9)`,
          [OWNER_ID, r.property_id, r.unit_id || null, r.title, r.description || null, r.frequency,
           r.next_due_date, (r.estimated_cost_ttd ?? null), r.notes || null]);
      }
      inserted++;
    }
    if (COMMIT) await client.query('COMMIT');
  } catch (e) {
    if (COMMIT) await client.query('ROLLBACK');
    throw e;
  } finally {
    await client.end();
  }

  console.log(`\n${COMMIT ? 'INSERTED' : 'WOULD INSERT'}: ${inserted}   already present (skipped): ${skipped}   malformed: ${bad}`);
  if (!COMMIT) console.log('Re-run with --commit to write these to the portal.');
  else console.log('Done. Review in Properties > Preventive Maintenance.');
}

run().catch(err => { console.error(err); process.exit(1); });
