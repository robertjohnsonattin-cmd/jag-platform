#!/usr/bin/env bash
set -e
export JAG_CLIENT_SECRET="${JAG_CLIENT_SECRET:-FIjMqEPT35gr3TRvh6FDdCTnMAX2FAGMjTVHuljqcBU}"
npx ts-node --compiler-options '{"module":"commonjs"}' migration/migrate.ts \
  --staging migration/staging/vehicles_initial_load_2026-06-11.json \
  --env production
