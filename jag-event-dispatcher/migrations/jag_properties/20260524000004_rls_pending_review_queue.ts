import type { MigrationBuilder } from 'node-pg-migrate';

// STD-02: RLS on prop_pending_review_queue.
// This table was created in migration 000002 without policies — this migration closes the gap.
// Policy: owner_id = app.current_owner_id (set per-transaction by API middleware).
// FORCE ensures the policy applies even to the jag_app table owner (STD-02).

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE prop_pending_review_queue ENABLE ROW LEVEL SECURITY;
    ALTER TABLE prop_pending_review_queue FORCE ROW LEVEL SECURITY;

    CREATE POLICY owner_isolation ON prop_pending_review_queue
      USING (owner_id = nullif(current_setting('app.current_owner_id', true), '')::uuid);
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    DROP POLICY IF EXISTS owner_isolation ON prop_pending_review_queue;
    ALTER TABLE prop_pending_review_queue DISABLE ROW LEVEL SECURITY;
    ALTER TABLE prop_pending_review_queue NO FORCE ROW LEVEL SECURITY;
  `);
}
