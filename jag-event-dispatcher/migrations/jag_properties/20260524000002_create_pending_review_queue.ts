import type { MigrationBuilder } from 'node-pg-migrate';

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createType('pending_review_status', ['PENDING', 'RESOLVED', 'DISMISSED']);

  pgm.createTable('prop_pending_review_queue', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    owner_id: {
      type: 'uuid',
      notNull: true,
      comment: 'cross-db ref: jag_core.users.id',
    },
    idempotency_key: {
      type: 'uuid',
      notNull: true,
    },
    source: {
      type: 'varchar',
      notNull: true,
      comment: 'e.g. WIPAY_WEBHOOK',
    },
    raw_payload: { type: 'jsonb', notNull: true },
    received_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
    status: {
      type: 'pending_review_status',
      notNull: true,
      default: 'PENDING',
    },
    resolution_notes: { type: 'text', notNull: false },
    resolved_at: { type: 'timestamptz', notNull: false },
    resolved_by: {
      type: 'uuid',
      notNull: false,
      comment: 'cross-db ref: jag_core.users.id',
    },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
    updated_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  });

  pgm.addConstraint('prop_pending_review_queue', 'prop_pending_review_queue_idempotency_key_key', {
    unique: ['idempotency_key'],
  });

  pgm.createIndex('prop_pending_review_queue', 'owner_id', { name: 'idx_prq_owner' });
  pgm.createIndex('prop_pending_review_queue', 'status', { name: 'idx_prq_status' });
  pgm.createIndex('prop_pending_review_queue', 'idempotency_key', {
    name: 'idx_prq_idempotency',
    unique: true,
  });
  pgm.createIndex('prop_pending_review_queue', 'received_at', { name: 'idx_prq_received_at' });

  pgm.sql(`
    COMMENT ON TABLE prop_pending_review_queue IS
    'Stores inbound webhook events that could not be matched to a booking record.
     WiPay non-success payments and unmatched success events are queued here for manual review.
     Handler returns 202 Accepted so WiPay does not retry. Decision locked PRE-5.'
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable('prop_pending_review_queue');
  pgm.dropType('pending_review_status');
}
