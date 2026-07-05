-- Migration 036: Contract — drop the legacy per-property maintenance table
-- Run only after 035's backfill into prop_maintenance_tickets has been verified.

-- prop_vendor_invoices.maintenance_request_id had a hard FK to the table being dropped.
-- No rows currently use it; convert to an unenforced soft reference (consistent with the
-- soft cross-DB/cross-module ref pattern used elsewhere, e.g. crm_contact_id) rather than
-- repointing it at prop_maintenance_tickets, since no linking UI exists for that yet.
ALTER TABLE prop_vendor_invoices DROP CONSTRAINT IF EXISTS prop_vendor_invoices_maintenance_request_id_fkey;

DROP TABLE IF EXISTS prop_maintenance_requests;
