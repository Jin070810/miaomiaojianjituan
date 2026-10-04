#!/usr/bin/env bash
set -euo pipefail
[[ "${CI:-}" == true && "${GITHUB_RUN_ID:-}" =~ ^[1-9][0-9]*$ && -n "${RUNNER_TEMP:-}" ]]
fixture="$(mktemp -d "$RUNNER_TEMP/copy-sanitization.XXXXXX")"
container="miaomiao-sanitization-$GITHUB_RUN_ID"
created=false
finish() {
  [[ "$created" != true ]] || docker rm -f "$container" >/dev/null 2>&1
  [[ "$fixture" == "$RUNNER_TEMP"/copy-sanitization.* ]] && rm -rf -- "$fixture"
}
trap finish EXIT
if docker container inspect "$container" >/dev/null 2>&1; then exit 1; fi
created=true
docker run -d --name "$container" --network none --memory 512m --memory-swap 512m \
  --tmpfs /var/lib/postgresql/data:rw,nosuid,size=256m --log-driver none \
  -e POSTGRES_DB=miaomiao_rehearsal -e POSTGRES_USER=rehearsal -e POSTGRES_HOST_AUTH_METHOD=trust postgres:16-alpine >/dev/null
for _ in {1..30}; do
  if docker exec "$container" pg_isready -U rehearsal -d miaomiao_rehearsal >/dev/null 2>&1; then break; fi
  sleep 1
done
sql() { docker exec -i "$container" psql -X -qAt -v ON_ERROR_STOP=1 -U rehearsal -d miaomiao_rehearsal; }
for migration in prisma/migrations/*/migration.sql; do sql < "$migration" > "$fixture/migrate.log" 2>&1; done
sql > "$fixture/seed.log" <<'SQL'
INSERT INTO "User" (id,"kuaishouId",nickname,"passwordHash","boundPhoneEnc","updatedAt")
VALUES ('fixture_user_a','SENSITIVE_SENTINEL_HANDLE','SENSITIVE_SENTINEL_NAME','SENSITIVE_SENTINEL_PASSWORD','SENSITIVE_SENTINEL_PHONE',now());
INSERT INTO "Session" (id,"userId","expiresAt") VALUES ('SENSITIVE_SENTINEL_SESSION','fixture_user_a',now()+interval '1 day');
INSERT INTO "PointAccount" (id,"userId",balance,"updatedAt") VALUES ('fixture_account','fixture_user_a',100,now());
INSERT INTO "PointLedger" (id,"accountId",type,amount,"balanceAfter",note,"idempotencyKey")
VALUES ('fixture_ledger','fixture_account','ADMIN_ADJUSTMENT',100,100,'SENSITIVE_SENTINEL_NOTE','SENSITIVE_SENTINEL_KEY');
INSERT INTO "RecipientProfile" (id,"userId","recipientName","phoneEnc","addressEnc","cashQrCodeUrl","updatedAt")
VALUES ('fixture_recipient','fixture_user_a','SENSITIVE_SENTINEL_NAME','SENSITIVE_SENTINEL_PHONE','SENSITIVE_SENTINEL_ADDRESS','SENSITIVE_SENTINEL_QR',now());
INSERT INTO "AuditLog" (id,action,entity,"beforeValue","afterValue",ip,reason)
VALUES ('fixture_audit','fixture','fixture','{"private":"SENSITIVE_SENTINEL_BEFORE"}','{"private":"SENSITIVE_SENTINEL_AFTER"}','SENSITIVE_SENTINEL_IP','SENSITIVE_SENTINEL_REASON');
INSERT INTO "LegacyImport" (id,"sourceTable","sourceId","rawValue")
VALUES ('fixture_import','fixture','SENSITIVE_SENTINEL_SOURCE','{"private":"SENSITIVE_SENTINEL_RAW"}');
SQL
if sql < scripts/sanitize-rehearsal.sql > "$fixture/guard.log" 2>&1; then echo 'Missing guard was accepted' >&2; exit 1; fi
[[ "$(printf 'SELECT count(*) FROM "Session";\n' | sql)" == 1 ]]
printf 'CREATE SCHEMA rehearsal_guard; CREATE TABLE rehearsal_guard.authorized_copy (id integer);\n' | sql >/dev/null
sql < scripts/rehearsal-aggregate.sql > "$fixture/before.json"
# Restore can reparse redundant AND/BETWEEN parentheses. Compare PostgreSQL's
# canonical display without weakening the actual operator/boundary checks.
printf 'CREATE TABLE "RehearsalConstraintFixture" (a int,b int,CHECK (a BETWEEN 1 AND 10 AND b BETWEEN 2 AND 20));\n' | sql
sql < scripts/rehearsal-structure.sql > "$fixture/structure-before.json"
docker exec "$container" pg_dump --schema-only --format=custom -U rehearsal -d miaomiao_rehearsal > "$fixture/schema.dump"
printf 'CREATE DATABASE miaomiao_restored;\n' | sql
docker exec -i "$container" pg_restore --exit-on-error --no-owner --no-privileges -U rehearsal -d miaomiao_restored < "$fixture/schema.dump"
docker exec -i "$container" psql -X -qAt -v ON_ERROR_STOP=1 -U rehearsal -d miaomiao_restored < scripts/rehearsal-structure.sql > "$fixture/structure-restored.json"
cmp "$fixture/structure-before.json" "$fixture/structure-restored.json"
sql < scripts/sanitize-rehearsal.sql > "$fixture/sanitize.log" 2>&1
sql < scripts/rehearsal-structure.sql > "$fixture/structure-after.json"
cmp "$fixture/structure-before.json" "$fixture/structure-after.json"
sql < scripts/rehearsal-aggregate.sql > "$fixture/after.json"
cmp "$fixture/before.json" "$fixture/after.json"
jq -e '.users==1 and .accounts==1 and .balanceTotal==100 and .ledgerTotal==100 and .accountBalanceMismatches==0' "$fixture/after.json" >/dev/null
docker exec "$container" pg_dump --data-only -U rehearsal -d miaomiao_rehearsal > "$fixture/sanitized.sql"
if grep -q SENSITIVE_SENTINEL "$fixture/sanitized.sql"; then echo 'Sensitive fixture survived sanitization' >&2; exit 1; fi
[[ "$(printf 'SELECT count(*) FROM "Session";\n' | sql)" == 0 ]]
printf 'DROP INDEX "User_kuaishouId_lower_key";\n' | sql
sql < scripts/rehearsal-structure.sql > "$fixture/missing-index.json"
if cmp -s "$fixture/structure-before.json" "$fixture/missing-index.json"; then echo 'Missing uniqueness enforcement was invisible' >&2; exit 1; fi
echo 'Rehearsal guard, PII/token/JSON removal, full schema constraints and financial aggregate preservation passed.'
