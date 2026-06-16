-- Migration 019: Maintenance Tickets + Contractors

CREATE TABLE prop_contractors (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id         UUID NOT NULL,
  name             VARCHAR(200) NOT NULL,
  trade            VARCHAR(50) NOT NULL CHECK (trade IN ('PLUMBING','ELECTRICAL','STRUCTURAL','PEST_CONTROL','APPLIANCE','PAINTING','GENERAL','OTHER')),
  phone            VARCHAR(30),
  whatsapp         VARCHAR(30),
  email            VARCHAR(200),
  rate_description TEXT,
  is_active        BOOLEAN DEFAULT TRUE,
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE prop_contractors ENABLE ROW LEVEL SECURITY;
CREATE POLICY prop_contractors_owner ON prop_contractors
  USING (owner_id = NULLIF(current_setting('app.current_owner_id', true), '')::uuid);

CREATE TABLE prop_maintenance_tickets (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id                  UUID NOT NULL,
  unit_id                   UUID NOT NULL REFERENCES prop_units(id) ON DELETE CASCADE,
  property_id               UUID REFERENCES prop_properties(id) ON DELETE SET NULL,
  lease_id                  UUID REFERENCES prop_lease_agreements(id) ON DELETE SET NULL,
  ticket_ref                VARCHAR(20) UNIQUE NOT NULL,
  reported_by_name          VARCHAR(200),
  reported_by_phone         VARCHAR(30),
  report_channel            VARCHAR(20) CHECK (report_channel IN ('WHATSAPP','SMS','PORTAL','PHONE','EMAIL')),
  category                  VARCHAR(30) NOT NULL CHECK (category IN ('PLUMBING','ELECTRICAL','STRUCTURAL','PEST','APPLIANCE','OTHER')),
  description               TEXT NOT NULL,
  photo_urls                JSONB DEFAULT '[]',
  -- P1=Emergency P2=Urgent P3=Routine P4=Planned
  priority                  VARCHAR(2) NOT NULL DEFAULT 'P3' CHECK (priority IN ('P1','P2','P3','P4')),
  priority_auto_suggested   VARCHAR(2),
  priority_confirmed_by     UUID,
  status                    VARCHAR(20) NOT NULL DEFAULT 'OPEN'
    CHECK (status IN ('OPEN','ASSIGNED','IN_PROGRESS','PENDING_PARTS','RESOLVED','CLOSED','CANCELLED')),
  sla_hours                 INT,
  sla_breach_at             TIMESTAMPTZ,
  sla_breached              BOOLEAN DEFAULT FALSE,
  contractor_id             UUID REFERENCES prop_contractors(id) ON DELETE SET NULL,
  contractor_notified_at    TIMESTAMPTZ,
  estimated_visit_at        TIMESTAMPTZ,
  resolution_notes          TEXT,
  completion_photo_urls     JSONB DEFAULT '[]',
  resolved_at               TIMESTAMPTZ,
  cost_ttd                  NUMERIC(12,2),
  expense_id                UUID,
  tenant_satisfied          BOOLEAN,
  tenant_feedback           TEXT,
  ack_sent_at               TIMESTAMPTZ,
  tenant_visit_notified_at  TIMESTAMPTZ,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE prop_maintenance_tickets ENABLE ROW LEVEL SECURITY;
CREATE POLICY prop_maintenance_tickets_owner ON prop_maintenance_tickets
  USING (owner_id = NULLIF(current_setting('app.current_owner_id', true), '')::uuid);

CREATE INDEX idx_prop_tickets_status   ON prop_maintenance_tickets(status);
CREATE INDEX idx_prop_tickets_unit     ON prop_maintenance_tickets(unit_id);
CREATE INDEX idx_prop_tickets_priority ON prop_maintenance_tickets(priority);
CREATE INDEX idx_prop_tickets_ref      ON prop_maintenance_tickets(ticket_ref);

CREATE TABLE prop_ticket_updates (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id             UUID NOT NULL,
  ticket_id            UUID NOT NULL REFERENCES prop_maintenance_tickets(id) ON DELETE CASCADE,
  status_from          VARCHAR(20),
  status_to            VARCHAR(20),
  note                 TEXT,
  updated_by           UUID,
  wa_notification_sent BOOLEAN DEFAULT FALSE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE prop_ticket_updates ENABLE ROW LEVEL SECURITY;
CREATE POLICY prop_ticket_updates_owner ON prop_ticket_updates
  USING (owner_id = NULLIF(current_setting('app.current_owner_id', true), '')::uuid);
