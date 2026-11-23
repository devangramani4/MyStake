#!/usr/bin/env bash
# Restore a dump produced by backup.sh into a database (default: a NEW database
# so the restore can be verified before cut-over).
#   ./restore.sh /var/backups/betx/betx-20260101T000000Z.sql.gz [target_db]
set -euo pipefail
FILE="${1:?backup file required}"
TARGET="${2:-${DATABASE_NAME}_restore}"
: "${DATABASE_HOST:?}" "${DATABASE_USER:?}" "${DATABASE_PASSWORD:?}"
sha256sum -c "$FILE.sha256"
export MYSQL_PWD="$DATABASE_PASSWORD"
mysql -h "$DATABASE_HOST" -u "$DATABASE_USER" -e "CREATE DATABASE IF NOT EXISTS \`$TARGET\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
if [[ "$FILE" == *.gpg ]]; then gpg --batch -d "$FILE" | gunzip | mysql -h "$DATABASE_HOST" -u "$DATABASE_USER" "$TARGET"
else gunzip -c "$FILE" | mysql -h "$DATABASE_HOST" -u "$DATABASE_USER" "$TARGET"; fi
# Sanity checks: ledger must reconcile with wallet balances.
mysql -h "$DATABASE_HOST" -u "$DATABASE_USER" "$TARGET" -e "
  SELECT COUNT(*) AS wallets_out_of_balance FROM user_wallets w
   WHERE w.balance <> COALESCE((SELECT SUM(amount) FROM wallet_transactions t WHERE t.wallet_id = w.id), 0)
      OR w.exposure <> COALESCE((SELECT SUM(exposure_change) FROM wallet_transactions t WHERE t.wallet_id = w.id), 0);"
echo "restored into $TARGET"
