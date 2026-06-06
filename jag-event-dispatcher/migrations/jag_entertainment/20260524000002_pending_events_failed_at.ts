import type { MigrationBuilder } from 'node-pg-migrate';

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.addColumn('pending_events', {
    failed_at: { type: 'timestamptz', notNull: false },
  });

  pgm.createIndex('pending_events', 'failed_at', { name: 'idx_pe_ent_failed_at' });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropIndex('pending_events', 'failed_at', { name: 'idx_pe_ent_failed_at' });
  pgm.dropColumn('pending_events', 'failed_at');
}
