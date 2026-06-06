-- jag_entertainment — Migration 005
-- STD-13 Expand-and-Contract Step 5: enforce NOT NULL on ent_tabs.venue.
-- Safe to run after migration 004 has backfilled all existing rows to 'BAR'
-- and application code (v after 004) always supplies venue on INSERT.

ALTER TABLE ent_tabs ALTER COLUMN venue SET NOT NULL;
