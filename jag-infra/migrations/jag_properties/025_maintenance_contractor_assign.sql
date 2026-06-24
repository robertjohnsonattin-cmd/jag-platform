-- Migration 025 (jag_properties)
-- Add contractor assignment + scheduled visit time to maintenance tickets
-- Enables JAG_MNT_002 (contractor assigned template) trigger

ALTER TABLE prop_maintenance_tickets
  ADD COLUMN IF NOT EXISTS assigned_contractor_id  UUID REFERENCES prop_contractors(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS scheduled_visit_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS contractor_assigned_at   TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_mnt_contractor ON prop_maintenance_tickets(assigned_contractor_id)
  WHERE assigned_contractor_id IS NOT NULL;
