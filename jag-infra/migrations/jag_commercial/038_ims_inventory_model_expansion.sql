-- Migration 038: IMS — nested locations, item ownership, lifecycle dates, stock thresholds
-- STD-13 Step 1 (Expand only): every change is additive and nullable. No column is
--   dropped, no NOT NULL is added, no existing value is rewritten. Safe to apply
--   while the platform is live; existing rows (7 vehicles, 1 location) are untouched.
-- STD-04: versioned migration, never run raw SQL on production.
--
-- Context: populating IMS with several hundred assets across multiple properties.
-- These columns must exist BEFORE the capture pass — retrofitting them afterwards
-- would mean physically re-visiting every property to fill them in.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. NESTED LOCATIONS — Building > Area > Container
--    Mirrors the existing ims_categories.parent_category_id self-reference
--    pattern rather than introducing a new one.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE ims_locations
  ADD COLUMN IF NOT EXISTS parent_location_id uuid NULL REFERENCES ims_locations(id),
  ADD COLUMN IF NOT EXISTS location_type      varchar(20) NULL;

COMMENT ON COLUMN ims_locations.parent_location_id IS
  'Self-ref for hierarchy e.g. 7 Tenth Street > Workshop > Tool cabinet 2. NULL = top level.';
COMMENT ON COLUMN ims_locations.location_type IS
  'BUILDING | AREA | CONTAINER — drives tree rendering and breadcrumbs. Advisory, not enforced.';

-- A location cannot be its own parent. (Deeper cycles are prevented in the API
-- layer; a full cycle check needs a recursive trigger, deliberately not added here.)
ALTER TABLE ims_locations
  DROP CONSTRAINT IF EXISTS chk_ims_locations_no_self_parent;
ALTER TABLE ims_locations
  ADD CONSTRAINT chk_ims_locations_no_self_parent
  CHECK (parent_location_id IS NULL OR parent_location_id <> id);

CREATE INDEX IF NOT EXISTS idx_ims_locations_parent ON ims_locations(parent_location_id);
CREATE INDEX IF NOT EXISTS idx_ims_locations_type   ON ims_locations(location_type);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. ITEM OWNERSHIP
--    ims_vehicles already carries owner_entity (added in migration 012) holding
--    values like 'JABCO', 'Personal — Robert', 'Phillip Johnson-Attin'. Items had
--    no equivalent, so there was nowhere to record that a drill belongs to JABCO
--    and a sofa to the household at the same address. Same type, same semantics.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE ims_items
  ADD COLUMN IF NOT EXISTS owner_entity varchar(100) NULL;

COMMENT ON COLUMN ims_items.owner_entity IS
  'Free-text owner label, same vocabulary as ims_vehicles.owner_entity. Ownership is a
   field, not a tenant — all IMS rows sit under the JAG_HOLDINGS umbrella tenant.';

CREATE INDEX IF NOT EXISTS idx_ims_items_owner_entity ON ims_items(owner_entity);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. LIFECYCLE DATES
--    Vehicles already track service/registration dates. General items tracked
--    none, which made perishable stock, warranties and lent tools untrackable.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE ims_items
  ADD COLUMN IF NOT EXISTS purchase_date          date NULL,
  ADD COLUMN IF NOT EXISTS warranty_expiry        date NULL,
  ADD COLUMN IF NOT EXISTS expiration_date        date NULL,
  ADD COLUMN IF NOT EXISTS last_maintenance_date  date NULL,
  ADD COLUMN IF NOT EXISTS next_maintenance_date  date NULL,
  ADD COLUMN IF NOT EXISTS loaned_date            date NULL,
  ADD COLUMN IF NOT EXISTS return_date            date NULL,
  ADD COLUMN IF NOT EXISTS last_stored_date       date NULL;

COMMENT ON COLUMN ims_items.expiration_date IS
  'Perishable stock (grocery, bar). Drives expiry alerting.';
COMMENT ON COLUMN ims_items.loaned_date IS
  'Set when an item leaves on loan; cleared on return. return_date = expected back.';

-- Partial indexes — the vast majority of rows will have NULL in these columns,
-- so index only the rows that actually carry a date. Keeps alert queries fast
-- without paying index cost on every consumable.
CREATE INDEX IF NOT EXISTS idx_ims_items_expiration
  ON ims_items(expiration_date)       WHERE expiration_date       IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ims_items_warranty
  ON ims_items(warranty_expiry)       WHERE warranty_expiry       IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ims_items_next_maintenance
  ON ims_items(next_maintenance_date) WHERE next_maintenance_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ims_items_return
  ON ims_items(return_date)           WHERE return_date           IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. THREE-TIER STOCK THRESHOLDS
--    reorder_point (single value) is KEPT and untouched — the existing
--    /items/low-stock endpoint still reads it. These are additional bands that
--    let the UI colour-code a quantity badge red/amber/green.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE ims_items
  ADD COLUMN IF NOT EXISTS quantity_critical  numeric NULL,
  ADD COLUMN IF NOT EXISTS quantity_low       numeric NULL,
  ADD COLUMN IF NOT EXISTS quantity_desirable numeric NULL;

COMMENT ON COLUMN ims_items.quantity_critical IS
  'At or below = critical (red), requires restocking now.';
COMMENT ON COLUMN ims_items.quantity_low IS
  'At or below = low (amber), will soon require restocking.';
COMMENT ON COLUMN ims_items.quantity_desirable IS
  'Usual target quantity after restocking (green).';

-- Bands must be coherent when supplied. NULLs always pass.
ALTER TABLE ims_items
  DROP CONSTRAINT IF EXISTS chk_ims_items_qty_bands;
ALTER TABLE ims_items
  ADD CONSTRAINT chk_ims_items_qty_bands CHECK (
    (quantity_critical IS NULL OR quantity_low       IS NULL OR quantity_critical <= quantity_low)
    AND
    (quantity_low      IS NULL OR quantity_desirable IS NULL OR quantity_low      <= quantity_desirable)
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. RECEIPT PHOTOS
--    ims_photos could not distinguish a photo OF the item from a photo of its
--    receipt — which is the evidence an insurer actually asks for.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE ims_photos
  ADD COLUMN IF NOT EXISTS photo_type varchar(20) NOT NULL DEFAULT 'ITEM';

COMMENT ON COLUMN ims_photos.photo_type IS
  'ITEM | RECEIPT | SERIAL_PLATE. Existing rows default to ITEM, which is what they are.';

ALTER TABLE ims_photos
  DROP CONSTRAINT IF EXISTS chk_ims_photos_type;
ALTER TABLE ims_photos
  ADD CONSTRAINT chk_ims_photos_type
  CHECK (photo_type IN ('ITEM', 'RECEIPT', 'SERIAL_PLATE'));

CREATE INDEX IF NOT EXISTS idx_ims_photos_type ON ims_photos(item_id, photo_type);

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. REFERENCE LINKS
--    Manuals, supplier product pages, spec sheets.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE ims_items
  ADD COLUMN IF NOT EXISTS links jsonb NULL;

COMMENT ON COLUMN ims_items.links IS
  'Array of {label, url} objects e.g. [{"label":"Manual","url":"https://..."}].';

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. TAG HIERARCHY
--    ims_categories already nests; ims_tags did not. Enables filtering by a
--    parent tag to automatically include its children (Condition > Broken/New/Used).
--    ims_tags.color already exists — only parent and icon are new.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE ims_tags
  ADD COLUMN IF NOT EXISTS parent_tag_id uuid        NULL REFERENCES ims_tags(id),
  ADD COLUMN IF NOT EXISTS icon          varchar(50) NULL;

COMMENT ON COLUMN ims_tags.parent_tag_id IS
  'Self-ref for tag hierarchy. Filtering by a parent should include descendants.';

ALTER TABLE ims_tags
  DROP CONSTRAINT IF EXISTS chk_ims_tags_no_self_parent;
ALTER TABLE ims_tags
  ADD CONSTRAINT chk_ims_tags_no_self_parent
  CHECK (parent_tag_id IS NULL OR parent_tag_id <> id);

CREATE INDEX IF NOT EXISTS idx_ims_tags_parent ON ims_tags(parent_tag_id);
