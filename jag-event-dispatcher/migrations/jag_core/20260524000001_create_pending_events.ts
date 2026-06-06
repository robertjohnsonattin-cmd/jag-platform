import type { MigrationBuilder } from 'node-pg-migrate';

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable('pending_events', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    aggregate_type: {
      type: 'varchar',
      notNull: true,
      comment: 'e.g. User, Tenant, Notification',
    },
    aggregate_id: { type: 'uuid', notNull: true },
    event_type: {
      type: 'varchar',
      notNull: true,
      comment: 'e.g. user.created, tenant.suspended',
    },
    payload: { type: 'jsonb', notNull: true },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
    processed_at: { type: 'timestamptz', notNull: false },
    retry_count: { type: 'integer', notNull: true, default: 0 },
    last_error: { type: 'text', notNull: false },
  });

  pgm.createIndex('pending_events', 'processed_at', { name: 'idx_pe_core_processed_at' });
  pgm.createIndex('pending_events', 'created_at', { name: 'idx_pe_core_created_at' });
  pgm.createIndex('pending_events', ['aggregate_type', 'aggregate_id'], {
    name: 'idx_pe_core_aggregate',
  });

  pgm.sql(`COMMENT ON TABLE pending_events IS 'Append-only outbox. Never UPDATE or DELETE from application code.'`);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable('pending_events');
}
