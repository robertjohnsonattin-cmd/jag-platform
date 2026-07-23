#!/usr/bin/env bash
# fdw-rotate-password.sh — update FDW USER MAPPING passwords after a jag_app credential change
#
# Run whenever the jag_app PostgreSQL role password is rotated.
# Requires DATABASE_URL_FAMILY_SUPERUSER and JAG_APP_PASSWORD to be set in the environment.
#
# Usage:
#   JAG_APP_PASSWORD=<new-password> DATABASE_URL_FAMILY_SUPERUSER=<superuser-url> \
#     bash jag-infra/scripts/fdw-rotate-password.sh
#
# On the VM (via SSH tunnel to localhost:5432):
#   export DATABASE_URL_FAMILY_SUPERUSER="postgresql://postgres:<pg-superuser-pw>@localhost:5432/jag_family"
#   export JAG_APP_PASSWORD="<new-jag_app-password>"
#   bash /opt/jag/jag-infra/scripts/fdw-rotate-password.sh

set -euo pipefail

: "${DATABASE_URL_FAMILY_SUPERUSER:?DATABASE_URL_FAMILY_SUPERUSER must be set}"
: "${JAG_APP_PASSWORD:?JAG_APP_PASSWORD must be set}"

echo "Rotating FDW USER MAPPING passwords in jag_family..."

psql "$DATABASE_URL_FAMILY_SUPERUSER" \
  --variable="JAG_APP_PASSWORD=$JAG_APP_PASSWORD" \
  <<'SQL'
ALTER USER MAPPING FOR jag_app
  SERVER jag_commercial_fdw
  OPTIONS (SET password :'JAG_APP_PASSWORD');

ALTER USER MAPPING FOR jag_app
  SERVER jag_entertainment_fdw
  OPTIONS (SET password :'JAG_APP_PASSWORD');
SQL

echo "Done. FDW connections re-validated:"
psql "$DATABASE_URL_FAMILY_SUPERUSER" -c "SELECT * FROM pg_user_mappings WHERE srvname LIKE '%fdw%';"
