/**
 * STD-03 — enquiry merge integration test (jag_properties).
 *
 * Duplicate enquiries for the same prospect (same last-7 phone key, same unit)
 * are merged into one keeper by `mergeEnquiriesTx` (routes/properties/enquiries.ts,
 * exposed via POST /properties/enquiries/merge). This exercises that transaction:
 * children repointed to the keeper, blank keeper fields filled from the dupes,
 * and the merged-away rows KEPT and marked MERGED with `merged_into_id`.
 *
 * INTEGRATION test — requires a live jag_properties database connected as a role
 * that owns (or can alter) the RLS-protected prop_enquiries tables. Without
 * DATABASE_URL_PROPERTIES the suite skips gracefully — no failures.
 *
 * To run:
 *   DATABASE_URL_PROPERTIES=postgresql://jag_app:pw@localhost:5432/jag_properties npm run test -- enquiry-merge
 *
 * Data isolation: all test records use fixed UUIDs in the 'e0000000-*' range.
 * The afterAll hook deletes them. NEVER run against a production database.
 */

import { Pool } from 'pg';
import { withOwnerRLS, type RLSContext } from '../middleware/rls';
import { mergeEnquiriesTx } from '../routes/properties/enquiries';

const DB_URL = process.env.DATABASE_URL_PROPERTIES;
const describe_ = DB_URL ? describe : describe.skip;

const OWNER = 'e0000000-0000-0000-0002-000000000001';
const KEEPER = 'e0000000-0000-0000-0003-000000000001'; // same phone key as DUPE
const DUPE   = 'e0000000-0000-0000-0003-000000000002'; // '18687871973' vs '8687871973'
const OTHER  = 'e0000000-0000-0000-0003-000000000003'; // different phone key
const MSG    = 'e0000000-0000-0000-0004-000000000001'; // WA message on the dupe
const LOG    = 'e0000000-0000-0000-0005-000000000001'; // contact-log entry on the dupe

const ctx: RLSContext = { userId: OWNER, tenantId: '', isOwner: false, ownerId: OWNER };

describe_('enquiry merge — jag_properties (STD-03)', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: DB_URL });

    const c = await pool.connect();
    try {
      await withOwnerRLS(c, ctx, async cl => {
        await cl.query(
          `INSERT INTO prop_enquiries (id, owner_id, prospect_name, prospect_phone, channel, notes) VALUES
             ($1, $4, 'Brijhan Lopez', '18687871973', 'WHATSAPP', NULL),
             ($2, $4, 'Brijhan',       '8687871973',  'WHATSAPP', 'dupe notes'),
             ($3, $4, 'Someone Else',  '18685551234', 'WHATSAPP', NULL)
           ON CONFLICT (id) DO NOTHING`,
          [KEEPER, DUPE, OTHER, OWNER],
        );
        await cl.query(
          `INSERT INTO prop_whatsapp_messages
             (id, owner_id, direction, from_number, to_number, enquiry_id, message_type, body, delivery_status, sent_at)
           VALUES ($1, $2, 'INBOUND', '18687871973', '1184193838112120', $3, 'TEXT', 'paid, thanks', 'READ', NOW())
           ON CONFLICT (id) DO NOTHING`,
          [MSG, OWNER, DUPE],
        );
        await cl.query(
          `INSERT INTO prop_contact_log (id, owner_id, contact_phone, log_type, body, enquiry_id)
           VALUES ($1, $2, '18687871973', 'NOTE', 'called them', $3)
           ON CONFLICT (id) DO NOTHING`,
          [LOG, OWNER, DUPE],
        );
      });
    } finally { c.release(); }
  });

  it('merges same-phone same-unit enquiries into the keeper', async () => {
    const client = await pool.connect();
    try {
      const result = await withOwnerRLS(client, ctx, c => mergeEnquiriesTx(c, OWNER, KEEPER, [DUPE]));
      expect(result.merged_rows).toBe(1);
      expect(result.messages_moved).toBe(1);
      expect(result.logs_moved).toBe(1);
      expect(result.viewings_moved).toBe(0);
      expect(result.applications_moved).toBe(0);

      // Message + log repointed to the keeper
      const { rows: [msg] } = await client.query('SELECT enquiry_id FROM prop_whatsapp_messages WHERE id = $1', [MSG]);
      expect(String(msg.enquiry_id)).toBe(KEEPER);
      const { rows: [log] } = await client.query('SELECT enquiry_id FROM prop_contact_log WHERE id = $1', [LOG]);
      expect(String(log.enquiry_id)).toBe(KEEPER);

      // Dupe kept, marked MERGED, pointed at keeper
      const { rows: [dupeRow] } = await client.query('SELECT stage, merged_into_id FROM prop_enquiries WHERE id = $1', [DUPE]);
      expect(dupeRow.stage).toBe('MERGED');
      expect(String(dupeRow.merged_into_id)).toBe(KEEPER);

      // Keeper kept its own name; its NULL notes filled from the dupe (fill path)
      const { rows: [keeperRow] } = await client.query('SELECT prospect_name, notes FROM prop_enquiries WHERE id = $1', [KEEPER]);
      expect(keeperRow.prospect_name).toBe('Brijhan Lopez');
      expect(keeperRow.notes).toBe('dupe notes');
    } finally { client.release(); }
  });

  it('refuses to merge enquiries with different phone keys', async () => {
    const client = await pool.connect();
    try {
      await expect(
        withOwnerRLS(client, ctx, c => mergeEnquiriesTx(c, OWNER, KEEPER, [OTHER])),
      ).rejects.toThrow('different phone numbers');
    } finally { client.release(); }
  });

  it('refuses to merge a row that is already merged', async () => {
    const client = await pool.connect();
    try {
      await expect(
        withOwnerRLS(client, ctx, c => mergeEnquiriesTx(c, OWNER, OTHER, [DUPE])),
      ).rejects.toThrow('already merged');
    } finally { client.release(); }
  });

  afterAll(async () => {
    if (!pool) return;
    const c = await pool.connect();
    try {
      await withOwnerRLS(c, ctx, async cl => {
        await cl.query('DELETE FROM prop_whatsapp_messages WHERE id = $1', [MSG]);
        await cl.query('DELETE FROM prop_contact_log WHERE id = $1', [LOG]);
        await cl.query('DELETE FROM prop_enquiries WHERE id = ANY($1::uuid[])', [[KEEPER, DUPE, OTHER]]);
      });
    } finally { c.release(); }
    await pool.end();
  });
});
