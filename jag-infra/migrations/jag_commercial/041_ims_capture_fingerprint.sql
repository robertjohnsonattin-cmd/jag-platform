-- Migration 041: IMS — capture_fingerprint, separating idempotency from SKU
-- STD-13 Step 1 (Expand only): additive, nullable, no existing data touched
-- until a SEPARATE, reviewed backfill step reassigns real SKUs.
--
-- Context: sku has been doing two unrelated jobs at once — (1) a human-facing
-- catalog code, and (2) the de-dup key the importer checks to avoid creating
-- the same item twice when a recording is re-parsed. Those need different
-- shapes: a catalog code should be short and meaningful ("JABCO-IT-00001"); a
-- de-dup key just needs to be a stable, collision-proof fingerprint of the
-- utterance that produced the row (what the existing CAP-<hash> value already
-- is). Splitting them lets sku become a real structured code without losing
-- idempotency for anything already imported under the old scheme.

ALTER TABLE ims_items
  ADD COLUMN IF NOT EXISTS capture_fingerprint varchar(64) NULL;

COMMENT ON COLUMN ims_items.capture_fingerprint IS
  'Import de-dup key only -- a hash of the recording/timestamp/name that produced
   this row. Never shown to a user, never meant to be meaningful on sight. Distinct
   from sku, which is the human-facing catalog code.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_ims_items_capture_fingerprint
  ON ims_items(capture_fingerprint) WHERE capture_fingerprint IS NOT NULL;
