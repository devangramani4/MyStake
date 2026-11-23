#!/usr/bin/env bash
# Consistent, compressed (optionally encrypted) MySQL backup with retention.
# Schedule via cron/systemd timer, e.g. every 6h:  0 */6 * * * /opt/betx/backup.sh
#   DATABASE_HOST DATABASE_USER DATABASE_PASSWORD DATABASE_NAME  — connection
#   BACKUP_DIR (default /var/backups/betx)  RETENTION_DAYS (default 14)
#   BACKUP_GPG_RECIPIENT  — if set, the dump is encrypted for this key
#   BACKUP_UPLOAD_CMD     — optional, e.g. 'aws s3 cp "$FILE" s3://bucket/betx/'
set -euo pipefail
: "${DATABASE_HOST:?}" "${DATABASE_USER:?}" "${DATABASE_PASSWORD:?}" "${DATABASE_NAME:?}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/betx}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
mkdir -p "$BACKUP_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="$BACKUP_DIR/${DATABASE_NAME}-${STAMP}.sql.gz"

# --single-transaction gives a consistent InnoDB snapshot without locking writes.
MYSQL_PWD="$DATABASE_PASSWORD" mysqldump -h "$DATABASE_HOST" -u "$DATABASE_USER" \
  --single-transaction --quick --routines --triggers --set-gtid-purged=OFF --hex-blob \
  "$DATABASE_NAME" | gzip -9 > "$FILE"

if [[ -n "${BACKUP_GPG_RECIPIENT:-}" ]]; then
  gpg --batch --yes --trust-model always -r "$BACKUP_GPG_RECIPIENT" -o "$FILE.gpg" -e "$FILE"
  rm -f "$FILE"
  FILE="$FILE.gpg"
fi
sha256sum "$FILE" > "$FILE.sha256"
if [[ -n "${BACKUP_UPLOAD_CMD:-}" ]]; then FILE="$FILE" bash -c "$BACKUP_UPLOAD_CMD"; fi
find "$BACKUP_DIR" -name "${DATABASE_NAME}-*" -mtime +"$RETENTION_DAYS" -delete
echo "backup ok: $FILE"
