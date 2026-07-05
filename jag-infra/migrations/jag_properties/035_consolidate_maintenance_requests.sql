-- Migration 035: Consolidate legacy per-property maintenance log into prop_maintenance_tickets
-- prop_maintenance_requests (per-property tab) is being retired in favour of the portfolio-wide
-- tenancy maintenance ticket system (prop_maintenance_tickets), which is the one wired into
-- WhatsApp, contractors, and SLA tracking. Building/property-level issues (no specific unit)
-- are now represented as a ticket with unit_id = NULL.

-- Expand: allow property-level tickets with no unit
ALTER TABLE prop_maintenance_tickets ALTER COLUMN unit_id DROP NOT NULL;

-- Expand: legacy categories not covered by the ticket system's narrower enum
ALTER TABLE prop_maintenance_tickets DROP CONSTRAINT prop_maintenance_tickets_category_check;
ALTER TABLE prop_maintenance_tickets ADD CONSTRAINT prop_maintenance_tickets_category_check
  CHECK (category IN ('PLUMBING','ELECTRICAL','STRUCTURAL','PEST','APPLIANCE','HVAC','SECURITY','GARDEN','PAINTING','ROOFING','OTHER'));

-- Backfill: carry every existing legacy request into the ticket table
INSERT INTO prop_maintenance_tickets
  (owner_id, unit_id, property_id, lease_id, ticket_ref, category, description,
   priority, status, resolution_notes, cost_ttd, resolved_at, created_at, last_updated_at)
SELECT
  r.owner_id,
  NULL,
  r.property_id,
  r.lease_id,
  'MNT-LEGACY-' || LPAD(ROW_NUMBER() OVER (ORDER BY r.created_at)::text, 4, '0'),
  r.category,
  r.description
    || COALESCE(' (Est. cost: TTD ' || r.estimated_cost || ')', '')
    || COALESCE(' [Legacy — assigned to: ' || r.assigned_to || ']', ''),
  CASE r.priority
    WHEN 'URGENT' THEN 'P1' WHEN 'HIGH' THEN 'P2' WHEN 'MEDIUM' THEN 'P3' ELSE 'P4'
  END,
  CASE r.status
    WHEN 'OPEN' THEN 'OPEN' WHEN 'ASSIGNED' THEN 'ASSIGNED' WHEN 'IN_PROGRESS' THEN 'IN_PROGRESS'
    WHEN 'AWAITING_PARTS' THEN 'PENDING_PARTS' WHEN 'COMPLETED' THEN 'RESOLVED'
    WHEN 'CLOSED' THEN 'CLOSED' WHEN 'CANNOT_REPRODUCE' THEN 'CANCELLED' ELSE 'OPEN'
  END,
  r.completion_notes,
  r.actual_cost,
  CASE WHEN r.completed_date IS NOT NULL THEN r.completed_date::timestamptz ELSE NULL END,
  r.created_at,
  r.updated_at
FROM prop_maintenance_requests r;
