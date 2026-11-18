#!/usr/bin/env bash
# One-time move of the store's data to another Cloudflare account.
#   - copies the D1 database (products, admins, orders, settings, ...) from the OLD account
#   - creates the D1 database + R2 bucket in the NEW account if needed and imports the data
#   - copies every image the database references, downloaded from the old live site
# Env: OLD_TOKEN, NEW_TOKEN, NEW_ACCOUNT_ID, OLD_SITE_URL, FORCE ("true" to import into a non-empty DB)
set -euo pipefail
: "${OLD_TOKEN:?}" "${NEW_TOKEN:?}" "${NEW_ACCOUNT_ID:?}" "${OLD_SITE_URL:?}"
DB=jeweler-db; BUCKET=jeweler-media
WORK=$(mktemp -d); SUMMARY=${GITHUB_STEP_SUMMARY:-/dev/stdout}
W() { npx wrangler "$@"; }

echo "::group::1. Export database from the current (old) account"
CLOUDFLARE_API_TOKEN=$OLD_TOKEN W d1 export $DB --remote --output="$WORK/dump.sql"
# D1-internal tables can't be imported; AUTOINCREMENT recovers from max(rowid) on its own.
grep -v -E 'sqlite_sequence|_cf_KV|_cf_METADATA|d1_migrations' "$WORK/dump.sql" > "$WORK/import.sql"
echo "exported $(grep -c '^INSERT' "$WORK/import.sql") rows"
echo "::endgroup::"

export CLOUDFLARE_API_TOKEN=$NEW_TOKEN CLOUDFLARE_ACCOUNT_ID=$NEW_ACCOUNT_ID

echo "::group::2. Find or create the database in the new account"
DB_ID=$(W d1 list --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);const d=j.find(x=>x.name==="'$DB'");process.stdout.write(d?d.uuid:"")})')
if [ -z "$DB_ID" ]; then
  W d1 create $DB
  DB_ID=$(W d1 list --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);process.stdout.write(j.find(x=>x.name==="'$DB'").uuid)})')
fi
echo "new database id: $DB_ID"
cat > "$WORK/wrangler.json" <<EOF
{ "name": "migrate-tmp", "account_id": "$NEW_ACCOUNT_ID", "compatibility_date": "2024-11-01",
  "d1_databases": [{ "binding": "DB", "database_name": "$DB", "database_id": "$DB_ID" }] }
EOF
echo "::endgroup::"

echo "::group::3. Import data"
HAS=$(W d1 execute $DB --remote --config "$WORK/wrangler.json" --json \
      --command "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='products'" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{process.stdout.write(String(JSON.parse(s)[0].results[0].n))})')
if [ "$HAS" != "0" ] && [ "${FORCE:-false}" != "true" ]; then
  echo "::error::The new account's $DB already has tables. Re-run with 'force' checked only if it's safe to overwrite."
  exit 1
fi
if [ "$HAS" != "0" ]; then
  # force: drop existing tables first so the import starts clean
  TABLES=$(grep -oE 'CREATE TABLE (IF NOT EXISTS )?"?[a-z_]+' "$WORK/import.sql" | awk '{print $NF}' | tr -d '"' | sort -u)
  for t in $TABLES; do W d1 execute $DB --remote --config "$WORK/wrangler.json" -y --command "DROP TABLE IF EXISTS $t" >/dev/null; done
fi
W d1 execute $DB --remote --config "$WORK/wrangler.json" -y --file "$WORK/import.sql"
echo "::endgroup::"

echo "::group::4. Copy images"
W r2 bucket create $BUCKET 2>&1 | tail -2 || true
KEYS=$( { grep -oE '/img/[A-Za-z0-9_./-]+\.(png|jpg|jpeg|webp|gif|avif)' "$WORK/import.sql" | sed 's#^/img/##'
          grep -oE "'(ads|ai|p|u)/[A-Za-z0-9_-]+\.(png|jpg|jpeg|webp|gif|avif)'" "$WORK/import.sql" | tr -d "'"; } | sort -u)
ok=0; fail=0
for k in $KEYS; do
  if curl -fsS -D "$WORK/h" -o "$WORK/f" "$OLD_SITE_URL/img/$k"; then
    ct=$(grep -i '^content-type:' "$WORK/h" | tail -1 | cut -d' ' -f2 | tr -d '\r'); ct=${ct:-image/jpeg}
    if W r2 object put "$BUCKET/$k" --file "$WORK/f" --ct "$ct" --remote --config "$WORK/wrangler.json" >/dev/null 2>&1; then ok=$((ok+1)); else fail=$((fail+1)); echo "upload failed: $k"; fi
  else fail=$((fail+1)); echo "download failed: $k"; fi
done
echo "images copied: $ok, failed: $fail"
echo "::endgroup::"

{
  echo "## Migration finished"
  echo "- New account: \`$NEW_ACCOUNT_ID\`"
  echo "- New database_id: \`$DB_ID\`"
  echo "- Rows imported: $(grep -c '^INSERT' "$WORK/import.sql")"
  echo "- Images copied: $ok (failed: $fail)"
} >> "$SUMMARY"
echo "NEW_DATABASE_ID=$DB_ID"
