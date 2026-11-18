#!/usr/bin/env bash
# One-time move of the store's data to another Cloudflare account.
#   - copies the D1 database (products, admins, orders, settings, ...) from the OLD account
#   - creates the D1 database + R2 bucket in the NEW account if needed and imports the data
#   - copies every image the database references, downloaded from the old live site
# Env: OLD_TOKEN, NEW_TOKEN, NEW_ACCOUNT_ID, OLD_SITE_URL, FORCE ("true" to import into a non-empty DB),
#      IMAGES_ONLY ("true" to skip the database steps and only copy images)
#      OLD_ACCOUNT_ID / OLD_DB_ID (default: the original hosting account)
set -euo pipefail
: "${OLD_TOKEN:?}" "${NEW_TOKEN:?}" "${NEW_ACCOUNT_ID:?}" "${OLD_SITE_URL:?}"
DB=jeweler-db; BUCKET=jeweler-media
OLD_ACCOUNT_ID=${OLD_ACCOUNT_ID:-1719e73f690786576d110b1212e04645}
OLD_DB_ID=${OLD_DB_ID:-9dac0e49-59ca-411c-80c6-9195c5950a01}
REPO=$(pwd); WORK=$(mktemp -d); SUMMARY=${GITHUB_STEP_SUMMARY:-/dev/stdout}

# Run wrangler from an empty dir with explicit config files, so the repo's wrangler.toml
# (whichever account it points at) can never send a command to the wrong account.
W() { (cd "$WORK" && "$REPO/node_modules/.bin/wrangler" "$@"); }
# Pull JSON out of wrangler output (it can print notices first) and evaluate an expression on it as `j`.
json() {
  node -e '
    let s = ""; process.stdin.on("data", d => s += d).on("end", () => {
      const i = Math.min(...["[", "{"].map(c => { const k = s.indexOf(c); return k < 0 ? 1e9 : k; }));
      const j = JSON.parse(s.slice(i)); console.log(eval(process.argv[1]));
    })' "$1"
}

printf '{ "name": "migrate-old", "account_id": "%s", "compatibility_date": "2024-11-01",\n  "d1_databases": [{ "binding": "DB", "database_name": "%s", "database_id": "%s" }] }\n' \
  "$OLD_ACCOUNT_ID" "$DB" "$OLD_DB_ID" > "$WORK/old.json"
printf '{ "name": "migrate-new", "account_id": "%s", "compatibility_date": "2024-11-01" }\n' "$NEW_ACCOUNT_ID" > "$WORK/new-base.json"

echo "::group::1. Export database from the old account"
CLOUDFLARE_API_TOKEN=$OLD_TOKEN W d1 export $DB --remote --config "$WORK/old.json" --output="$WORK/dump.sql"
# D1-internal tables can't be imported; AUTOINCREMENT recovers from max(rowid) on its own.
grep -v -E 'sqlite_sequence|_cf_KV|_cf_METADATA|d1_migrations' "$WORK/dump.sql" > "$WORK/import.sql"
ROWS=$(grep -c '^INSERT' "$WORK/import.sql" || true)
echo "exported $ROWS rows"
echo "::endgroup::"

export CLOUDFLARE_API_TOKEN=$NEW_TOKEN

DB_ID="(unchanged)"
if [ "${IMAGES_ONLY:-false}" != "true" ]; then
echo "::group::2. Find or create the database in the new account"
DB_ID=$(W d1 list --json --config "$WORK/new-base.json" | json "(j.find(x => x.name === '$DB') || {}).uuid || ''")
if [ -z "$DB_ID" ]; then
  W d1 create $DB --config "$WORK/new-base.json"
  DB_ID=$(W d1 list --json --config "$WORK/new-base.json" | json "(j.find(x => x.name === '$DB') || {}).uuid || ''")
fi
[ -n "$DB_ID" ] || { echo "::error::Could not create or find $DB in the new account"; exit 1; }
echo "new database id: $DB_ID"
printf '{ "name": "migrate-new", "account_id": "%s", "compatibility_date": "2024-11-01",\n  "d1_databases": [{ "binding": "DB", "database_name": "%s", "database_id": "%s" }] }\n' \
  "$NEW_ACCOUNT_ID" "$DB" "$DB_ID" > "$WORK/new.json"
echo "::endgroup::"

echo "::group::3. Import data"
HAS=$(W d1 execute $DB --remote --config "$WORK/new.json" --json \
      --command "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='products'" | json "j[0].results[0].n")
if [ "$HAS" != "0" ] && [ "${FORCE:-false}" != "true" ]; then
  echo "::error::The new account's $DB already has tables. Re-run with 'force' checked only if it's safe to overwrite."
  exit 1
fi
if [ "$HAS" != "0" ]; then
  TABLES=$(grep -oE 'CREATE TABLE (IF NOT EXISTS )?"?[a-z_]+' "$WORK/import.sql" | awk '{print $NF}' | tr -d '"' | sort -u)
  for t in $TABLES; do W d1 execute $DB --remote --config "$WORK/new.json" -y --command "DROP TABLE IF EXISTS $t" >/dev/null; done
fi
W d1 execute $DB --remote --config "$WORK/new.json" -y --file "$WORK/import.sql"
echo "::endgroup::"
fi

echo "::group::4. Copy images"
if ! out=$(W r2 bucket create $BUCKET --config "$WORK/new-base.json" 2>&1); then
  if echo "$out" | grep -qi "already exists\|10004"; then echo "bucket $BUCKET already exists"
  else
    echo "$out"
    echo "::error::Could not create the R2 bucket in the new account. If the message mentions enabling R2: open the new account's dashboard → R2 Object Storage → enable it (accept terms / add a payment method; the free tier stays free), then re-run with 'images only' checked."
    exit 1
  fi
fi
KEYS=$( { grep -oE '/img/[A-Za-z0-9_./-]+\.(png|jpg|jpeg|webp|gif|avif)' "$WORK/import.sql" | sed 's#^/img/##' || true
          grep -oE "'(ads|ai|p|u)/[A-Za-z0-9_-]+\.(png|jpg|jpeg|webp|gif|avif)'" "$WORK/import.sql" | tr -d "'" || true; } | sort -u)
ok=0; fail=0
for k in $KEYS; do
  if curl -fsS -D "$WORK/h" -o "$WORK/f" "$OLD_SITE_URL/img/$k"; then
    ct=$(grep -i '^content-type:' "$WORK/h" | tail -1 | cut -d' ' -f2 | tr -d '\r'); ct=${ct:-image/jpeg}
    if out=$(W r2 object put "$BUCKET/$k" --file "$WORK/f" --ct "$ct" --remote --config "$WORK/new-base.json" 2>&1); then
      ok=$((ok+1))
    else
      fail=$((fail+1)); echo "upload failed: $k"
      [ $fail -eq 1 ] && echo "$out" | tail -15   # show the first error in full
    fi
  else fail=$((fail+1)); echo "download failed: $k"; fi
done
echo "images copied: $ok, failed: $fail"
[ $fail -eq 0 ] || echo "::warning::$fail images failed to copy — see messages above"
echo "::endgroup::"

{
  echo "## Migration finished"
  echo "- New account: \`$NEW_ACCOUNT_ID\`"
  echo "- New database_id: \`$DB_ID\`"
  [ "${IMAGES_ONLY:-false}" = "true" ] && echo "- Database: skipped (images only)" || echo "- Rows imported: $ROWS"
  echo "- Images copied: $ok (failed: $fail)"
} >> "$SUMMARY"
echo "NEW_DATABASE_ID=$DB_ID"
