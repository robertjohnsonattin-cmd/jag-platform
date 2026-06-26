/**
 * One-time insurance data migration
 * Reads existing property insurance (prop_insurance in jag_properties)
 * and vehicle insurance columns (ims_vehicles in jag_commercial) and
 * inserts them into fin_insurance_policies (jag_family).
 *
 * Run BEFORE the schema-drop migrations (034, 037).
 * Run from repo root: node scripts/migrate-insurance.js
 *
 * Requires SSH tunnel:  ssh -L 15432:localhost:5432 ubuntu@150.136.151.64
 * Env vars (from .env or inline):
 *   PGHOST, PGPORT (default 15432), PG_SUPERUSER_PASSWORD or JAG_APP_PASSWORD
 */

'use strict';
const { Client } = require('pg');

const HOST = process.env.PGHOST || '127.0.0.1';
const PORT = parseInt(process.env.PGPORT || '15432', 10);
const USER = 'jag_app';
const PASS = process.env.JAG_APP_PASSWORD;
const OWNER_ID = '95ca3f77-60ba-4a0f-af70-2832b247b525'; // Robert's jag_core users.id

if (!PASS) { console.error('JAG_APP_PASSWORD env var required'); process.exit(1); }

const base = { host: HOST, port: PORT, user: USER, password: PASS, ssl: false };

// Map prop_insurance.insurance_type → fin_insurance_policies.policy_type
const PROP_TYPE_MAP = {
  BUILDING:      'BUILDING',
  CONTENTS:      'CONTENTS',
  COMPREHENSIVE: 'COMPREHENSIVE',
  LIABILITY:     'LIABILITY',
  FLOOD:         'FLOOD',
  FIRE:          'FIRE',
  OTHER:         'OTHER',
};

// Entity UUID for JAG Properties
const JAG_PROPERTIES_ENTITY = '00000000-0000-0000-0001-000000000003';
// Entity UUID for JAG Holdings (used for vehicle insurance under company entities)
const JAG_HOLDINGS_ENTITY   = '00000000-0000-0000-0001-000000000001';

async function run() {
  const propClient  = new Client({ ...base, database: 'jag_properties' });
  const commClient  = new Client({ ...base, database: 'jag_commercial' });
  const familyClient = new Client({ ...base, database: 'jag_family' });

  await propClient.connect();
  await commClient.connect();
  await familyClient.connect();

  // Set owner RLS context on jag_family
  await familyClient.query(`SELECT set_config('app.current_owner_id', $1, true)`, [OWNER_ID]);

  let inserted = 0;

  // ── 1. Property insurance ──────────────────────────────────────────────────
  console.log('Migrating prop_insurance rows...');
  const { rows: propRows } = await propClient.query(`
    SELECT pi.*, pp.address_line1
    FROM prop_insurance pi
    JOIN prop_properties pp ON pp.id = pi.property_id
    ORDER BY pi.created_at
  `);

  for (const row of propRows) {
    const policyType = PROP_TYPE_MAP[row.insurance_type] || 'OTHER';
    const label = row.address_line1 || row.property_id;
    await familyClient.query(`
      INSERT INTO fin_insurance_policies
        (owner_id, owner_entity_id, policy_number, insurer_name,
         policy_type, insured_asset_type, insured_asset_ref,
         coverage_amount, currency, coverage_amount_ttd,
         premium_amount, premium_amount_ttd, premium_frequency,
         start_date, expiry_date, renewal_alert_days, notes, created_at)
      VALUES ($1,$2,$3,$4,$5,'PROPERTY',$6,$7,$8,$9,$10,$11,$12,$13,$14,60,$15,$16)
      ON CONFLICT DO NOTHING
    `, [
      OWNER_ID,
      JAG_PROPERTIES_ENTITY,
      row.policy_number || `MIGRATED-PROP-${row.id.slice(0, 8)}`,
      row.insurer,
      policyType,
      row.property_id,
      row.coverage_amount || 0,
      row.premium_currency || 'TTD',
      row.coverage_amount || 0,
      row.premium_amount || 0,
      row.premium_amount || 0,
      row.premium_frequency || 'ANNUAL',
      row.start_date || null,
      row.expiry_date || new Date(Date.now() + 365*24*60*60*1000).toISOString().slice(0, 10),
      row.notes ? `${row.notes}\n[Migrated from property: ${label}]` : `Migrated from property: ${label}`,
      row.created_at,
    ]);
    inserted++;
    console.log(`  ✓ Property insurance: ${row.insurer} (${policyType}) → property ${label}`);
  }

  // ── 2. Vehicle insurance columns ───────────────────────────────────────────
  console.log('Migrating ims_vehicles insurance columns...');
  const { rows: vehRows } = await commClient.query(`
    SELECT id, name, registration_number, owner_entity,
           insurance_policy_number, insurance_provider, insurance_expiry
    FROM ims_vehicles
    WHERE insurance_policy_number IS NOT NULL
       OR insurance_provider IS NOT NULL
       OR insurance_expiry IS NOT NULL
  `);

  for (const v of vehRows) {
    if (!v.insurance_provider && !v.insurance_policy_number) continue;
    const label = `${v.name} (${v.registration_number})`;

    // Best-effort owner_entity_id from owner_entity string
    const entityMap = {
      'JAG Holdings':       '00000000-0000-0000-0001-000000000001',
      'JABCO':              '00000000-0000-0000-0001-000000000002',
      'JAG Properties':     '00000000-0000-0000-0001-000000000003',
      'JAG Entertainment':  '00000000-0000-0000-0001-000000000004',
      'JAG Finance':        '00000000-0000-0000-0001-000000000005',
      'DragonBridge':       '00000000-0000-0000-0001-000000000006',
      'Personal — Robert':  '00000000-0000-0000-0001-000000000008',
      'Personal — Brian':   '00000000-0000-0000-0001-000000000011',
    };
    const ownerEntityId = entityMap[v.owner_entity] || JAG_HOLDINGS_ENTITY;

    await familyClient.query(`
      INSERT INTO fin_insurance_policies
        (owner_id, owner_entity_id, policy_number, insurer_name,
         policy_type, insured_asset_type, insured_asset_ref,
         coverage_amount, currency, coverage_amount_ttd,
         premium_amount, premium_amount_ttd, premium_frequency,
         start_date, expiry_date, renewal_alert_days, notes)
      VALUES ($1,$2,$3,$4,'VEHICLE','VEHICLE',$5,0,'TTD',0,0,0,'ANNUAL',null,$6,60,$7)
      ON CONFLICT DO NOTHING
    `, [
      OWNER_ID,
      ownerEntityId,
      v.insurance_policy_number || `MIGRATED-VEH-${v.id.slice(0, 8)}`,
      v.insurance_provider || 'Unknown (migrated)',
      v.id,
      v.insurance_expiry || new Date(Date.now() + 365*24*60*60*1000).toISOString().slice(0, 10),
      `Vehicle: ${label}\n[Migrated from vehicle record — update coverage/premium amounts]`,
    ]);
    inserted++;
    console.log(`  ✓ Vehicle insurance: ${v.insurance_provider || 'Unknown'} → ${label}`);
  }

  await propClient.end();
  await commClient.end();
  await familyClient.end();

  console.log(`\nDone. ${inserted} records migrated to fin_insurance_policies.`);
  console.log('Review the migrated records in Finance → Insurance and update any missing amounts.');
}

run().catch(err => { console.error(err); process.exit(1); });
