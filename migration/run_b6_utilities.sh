#!/usr/bin/env bash
# JAG Phase B6 — Utility Accounts Migration Runner
# Approved by: Robert Johnson-Attin — 2026-06-11
#
# Usage:
#   JAG_PASSWORD=<password> bash migration/run_b6_utilities.sh
#
# JAG_CLIENT_SECRET defaults to the jag-api client secret below;
# override with env var if rotated.

set -e

export JAG_CLIENT_SECRET="${JAG_CLIENT_SECRET:-FIjMqEPT35gr3TRvh6FDdCTnMAX2FAGMjTVHuljqcBU}"

RUNNER="npx ts-node --compiler-options {\"module\":\"commonjs\"} migration/migrate.ts"

run_migration() {
  npx ts-node --compiler-options '{"module":"commonjs"}' migration/migrate.ts \
    --staging "$1" \
    --env production
}

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║  JAG Phase B6 — Utility Accounts Migration   ║"
echo "║  Approved: Robert Johnson-Attin 2026-06-11   ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

# ── Batch 1: Residential utility accounts (37 records) ───────────────────────

echo ">>> BATCH 1: Residential utility accounts (37 records)"
run_migration migration/staging/utility_accounts_2026-06-11_0900.json
echo ""

# ── Batch 2: 62 Ariapita Avenue (JAG Entertainment) ──────────────────────────

echo ">>> BATCH 2 STEP 1: Create 62 Ariapita Avenue property"
run_migration migration/staging/ariapita_property_only.json

ARIAPITA_UUID=$(node migration/extract_uuid.js --module properties --ref "62 Ariapita")
if [ -z "$ARIAPITA_UUID" ]; then
  echo "ERROR: Could not extract UUID for 62 Ariapita. Check migration/audit/. Aborting."
  exit 1
fi
echo "  62 Ariapita property UUID: $ARIAPITA_UUID"

ARIAPITA_UTIL_FILE="migration/staging/ariapita_utilities_run.json"
node migration/inject_uuid.js \
  --source migration/staging/jag_entertainment_property_utilities_2026-06-11_1200.json \
  --placeholder ARIAPITA_PROPERTY_ID \
  --uuid "$ARIAPITA_UUID" \
  --step 2 \
  --output "$ARIAPITA_UTIL_FILE"

echo ">>> BATCH 2 STEP 2: Post 62 Ariapita utility accounts"
run_migration "$ARIAPITA_UTIL_FILE"
echo ""

# ── Batch 3: JAG Properties Management ───────────────────────────────────────

echo ">>> BATCH 3 STEP 1: Create JAG Properties Management property"
run_migration migration/staging/jagprop_mgmt_property_only.json

MGMT_UUID=$(node migration/extract_uuid.js --module properties --ref "JAG Properties Management")
if [ -z "$MGMT_UUID" ]; then
  echo "ERROR: Could not extract UUID for JAG Properties Management. Check migration/audit/. Aborting."
  exit 1
fi
echo "  JAG Properties Management UUID: $MGMT_UUID"

MGMT_UTIL_FILE="migration/staging/jagprop_mgmt_utility_run.json"
node migration/inject_uuid.js \
  --source migration/staging/jag_properties_mgmt_2026-06-11_1300.json \
  --placeholder JAGPROP_MGMT_ID \
  --uuid "$MGMT_UUID" \
  --step 2 \
  --output "$MGMT_UTIL_FILE"

echo ">>> BATCH 3 STEP 2: Post JAG Properties Management utility accounts"
run_migration "$MGMT_UTIL_FILE"

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║  Phase B6 Migration Complete                 ║"
echo "╚══════════════════════════════════════════════╝"
