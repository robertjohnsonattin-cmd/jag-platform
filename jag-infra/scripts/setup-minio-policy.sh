#!/usr/bin/env bash
# JAG Holdings — MinIO IAM bucket policy setup (run once)
#
# Creates the 'jag-app-buckets' policy restricting the jag_app access key
# to only the 4 authorised buckets. Works for both MinIO users and service accounts.
#
# USAGE:
#   MINIO_ROOT_PASSWORD=<password> JAG_APP_ACCESS_KEY=aVl4SrRl0YtilT55zCNe \
#     bash /opt/jag/jag-infra/scripts/setup-minio-policy.sh
#
# ENV VARS:
#   MINIO_ROOT_PASSWORD  — required; MinIO root password
#   JAG_APP_ACCESS_KEY   — required; the access key to restrict (aVl4SrRl0YtilT55zCNe)
#   MINIO_ROOT_USER      — optional; defaults to jag_minio_admin
#   MINIO_ENDPOINT       — optional; defaults to http://localhost:9000

set -euo pipefail

MINIO_ROOT_USER="${MINIO_ROOT_USER:-jag_minio_admin}"
MINIO_ROOT_PASSWORD="${MINIO_ROOT_PASSWORD:?MINIO_ROOT_PASSWORD env var is required}"
JAG_APP_ACCESS_KEY="${JAG_APP_ACCESS_KEY:?JAG_APP_ACCESS_KEY env var is required}"
MINIO_ENDPOINT="${MINIO_ENDPOINT:-http://localhost:9000}"
POLICY_NAME="jag-app-buckets"
POLICY_FILE="/tmp/jag-app-policy.json"
MC_ALIAS="jagadmin_setup"

log() {
  printf '{"timestamp":"%s","entity":"MINIO_POLICY","action":"%s","severity":"%s"}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" "$2"
}

# ── mc must be installed ───────────────────────────────────────────────────────
if ! command -v mc &>/dev/null; then
  echo "ERROR: mc (MinIO client) not found. Install: curl -O https://dl.min.io/client/mc/release/linux-amd64/mc && chmod +x mc && sudo mv mc /usr/local/bin/"
  exit 1
fi

# ── Configure alias ───────────────────────────────────────────────────────────
mc alias set "$MC_ALIAS" "$MINIO_ENDPOINT" "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" \
  --api S3v4 -q

# ── Write policy JSON ─────────────────────────────────────────────────────────
cat > "$POLICY_FILE" << 'POLICY'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject",
        "s3:GetObjectAttributes"
      ],
      "Resource": [
        "arn:aws:s3:::jag-bank-statements/*",
        "arn:aws:s3:::jag-receipts/*",
        "arn:aws:s3:::jag-documents/*",
        "arn:aws:s3:::jag-photos/*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:ListBucket",
        "s3:GetBucketLocation",
        "s3:CreateBucket"
      ],
      "Resource": [
        "arn:aws:s3:::jag-bank-statements",
        "arn:aws:s3:::jag-receipts",
        "arn:aws:s3:::jag-documents",
        "arn:aws:s3:::jag-photos"
      ]
    }
  ]
}
POLICY

# ── Create policy in MinIO ────────────────────────────────────────────────────
if mc admin policy info "$MC_ALIAS" "$POLICY_NAME" &>/dev/null; then
  mc admin policy create "$MC_ALIAS" "$POLICY_NAME" "$POLICY_FILE"
  log "policy_updated" "INFO"
else
  mc admin policy create "$MC_ALIAS" "$POLICY_NAME" "$POLICY_FILE"
  log "policy_created" "INFO"
fi

# ── Attach to user or service account ────────────────────────────────────────
# Try direct MinIO user first; fall back to service account.
if mc admin user info "$MC_ALIAS" "$JAG_APP_ACCESS_KEY" &>/dev/null 2>&1; then
  mc admin policy attach "$MC_ALIAS" "$POLICY_NAME" --user "$JAG_APP_ACCESS_KEY"
  log "policy_attached_user" "INFO"
  echo "Policy '$POLICY_NAME' attached to MinIO user '$JAG_APP_ACCESS_KEY'."
else
  # Service account: embed policy inline
  mc admin user svcacct edit "$MC_ALIAS" "$JAG_APP_ACCESS_KEY" --policy "$POLICY_FILE"
  log "policy_attached_svcacct" "INFO"
  echo "Policy '$POLICY_NAME' applied to service account '$JAG_APP_ACCESS_KEY'."
fi

rm -f "$POLICY_FILE"
log "setup_complete" "INFO"
echo "Done. The jag_app access key is now restricted to the 4 JAG buckets."
