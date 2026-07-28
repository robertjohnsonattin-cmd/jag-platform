-- Migration 063: backfill tenant_id on tenancy records that never got one.
--
-- Migrations 052-055 added tenant_id to prop_deposits, prop_applications,
-- prop_maintenance_tickets and prop_handover_checklists, but only ever
-- populated it going forward, and only along paths that assume a lease or an
-- application exists:
--
--   deposits            tenant_id set only when lease_id was supplied
--   maintenance tickets tenant_id resolved from the unit's ACTIVE lease
--   handover checklists same as maintenance tickets
--
-- With the portfolio between tenancies (every unit VACANT, all leases EXPIRED)
-- neither path resolves, so records recorded against a real tenant sat with
-- tenant_id NULL and were invisible on the Tenant record -- the report that
-- started this work was a deposit visible under Tenancy Ops but absent from
-- the tenant who paid it.
--
-- Resolution order per row, most reliable first:
--   1. via application_id  -> prop_applications.tenant_id   (deposits only)
--   2. via lease_id        -> prop_lease_agreements.tenant_id
--   3. via unit_id         -> that unit's most recent lease, any status
--
-- Rows that still cannot be resolved are left NULL and reported at the end;
-- they are genuinely ambiguous (no application, no lease ever on the unit) and
-- must be linked by hand from the deposit/ticket form.
--
-- NOTE: prop_applications and prop_maintenance_tickets are not owned by
-- jag_app -- run this as `sudo -u postgres psql -d jag_properties -f ...`,
-- exactly as 053 and 054 were, then hand-register it in __migrations.
-- Nothing on this project auto-applies migrations on container start.

BEGIN;

-- "Whose unit is this?" -- one row per unit, carrying the tenant from that unit's
-- most relevant lease: the ACTIVE one if there is one, otherwise the most recently
-- started lease of any status.
--
-- Written as a view rather than a LATERAL subquery in each UPDATE's FROM clause:
-- PostgreSQL will not let a LATERAL item in UPDATE ... FROM reference the update
-- target ("invalid reference to FROM-clause entry"), and this computes the
-- per-unit answer once instead of once per row.

CREATE TEMP VIEW unit_latest_tenant AS
SELECT DISTINCT ON (unit_id)
       unit_id,
       tenant_id
FROM   prop_lease_agreements
WHERE  unit_id IS NOT NULL
ORDER  BY unit_id, (status = 'ACTIVE') DESC, start_date DESC;

-- ── 1. Deposits ──────────────────────────────────────────────────────────────

UPDATE prop_deposits d
SET    tenant_id = a.tenant_id
FROM   prop_applications a
WHERE  d.tenant_id IS NULL
  AND  d.application_id = a.id
  AND  a.tenant_id IS NOT NULL;

UPDATE prop_deposits d
SET    tenant_id = la.tenant_id
FROM   prop_lease_agreements la
WHERE  d.tenant_id IS NULL
  AND  d.lease_id = la.id;

UPDATE prop_deposits d
SET    tenant_id = ult.tenant_id
FROM   unit_latest_tenant ult
WHERE  d.tenant_id IS NULL
  AND  d.unit_id = ult.unit_id;

-- ── 2. Maintenance tickets ───────────────────────────────────────────────────

UPDATE prop_maintenance_tickets t
SET    tenant_id = la.tenant_id
FROM   prop_lease_agreements la
WHERE  t.tenant_id IS NULL
  AND  t.lease_id = la.id;

UPDATE prop_maintenance_tickets t
SET    tenant_id = ult.tenant_id
FROM   unit_latest_tenant ult
WHERE  t.tenant_id IS NULL
  AND  t.unit_id = ult.unit_id;

-- ── 3. Handover checklists ───────────────────────────────────────────────────

UPDATE prop_handover_checklists h
SET    tenant_id = la.tenant_id
FROM   prop_lease_agreements la
WHERE  h.tenant_id IS NULL
  AND  h.lease_id = la.id;

UPDATE prop_handover_checklists h
SET    tenant_id = ult.tenant_id
FROM   unit_latest_tenant ult
WHERE  h.tenant_id IS NULL
  AND  h.unit_id = ult.unit_id;

-- ── 4. Report what is still unresolved ───────────────────────────────────────
-- These need a tenant picked by hand; the deposit and ticket forms now offer one.

DO $$
DECLARE
  d_left INT;
  t_left INT;
  h_left INT;
BEGIN
  SELECT count(*) INTO d_left FROM prop_deposits             WHERE tenant_id IS NULL;
  SELECT count(*) INTO t_left FROM prop_maintenance_tickets  WHERE tenant_id IS NULL;
  SELECT count(*) INTO h_left FROM prop_handover_checklists  WHERE tenant_id IS NULL;
  RAISE NOTICE 'Unresolved after backfill -- deposits: %, maintenance tickets: %, handover checklists: %',
    d_left, t_left, h_left;
END $$;

COMMIT;
