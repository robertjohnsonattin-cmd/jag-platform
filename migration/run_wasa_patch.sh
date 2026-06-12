#!/usr/bin/env bash
# Run ONLY after WASA confirms the 5 account transfers are complete.
set -e
export JAG_CLIENT_SECRET="${JAG_CLIENT_SECRET:-FIjMqEPT35gr3TRvh6FDdCTnMAX2FAGMjTVHuljqcBU}"
npx ts-node --compiler-options '{"module":"commonjs"}' migration/migrate.ts \
  --staging migration/staging/wasa_account_name_patch_2026-06-11.json \
  --env production
