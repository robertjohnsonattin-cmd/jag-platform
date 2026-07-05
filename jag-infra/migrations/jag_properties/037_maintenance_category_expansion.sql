-- Migration 037: Expand maintenance ticket categories to a fuller rental/property
-- maintenance taxonomy (was a narrow 11-value set carried over from the tenant-facing
-- ticket system before consolidation with the per-property tab).

ALTER TABLE prop_maintenance_tickets DROP CONSTRAINT prop_maintenance_tickets_category_check;
ALTER TABLE prop_maintenance_tickets ADD CONSTRAINT prop_maintenance_tickets_category_check
  CHECK (category IN (
    'PLUMBING','ELECTRICAL','HVAC','APPLIANCE','STRUCTURAL','ROOFING','PAINTING',
    'FLOORING','DOORS_WINDOWS','LOCKS_KEYS','PEST','SECURITY','GARDEN','FENCING',
    'DRAINAGE','WASTE_DISPOSAL','SMOKE_DETECTOR','CLEANING','OTHER'
  ));
