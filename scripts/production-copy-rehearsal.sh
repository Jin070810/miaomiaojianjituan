#!/usr/bin/env bash
# No production DB writes, no raw backup export, no production service restart.
set -euo pipefail
root="$(realpath -e "${1:?project}")" payload="$(realpath -e "${2:?payload}")"
domain="${3:?domain}" candidate="${4:?candidate SHA}" run_id="${5:?run ID}"
mode="${6:-always}"
[[ "$mode" =~ ^(always|if-changed)$ ]]
[[ "$domain" =~ ^[A-Za-z0-9][A-Za-z0-9.-]*$ && "$candidate" =~ ^[a-f0-9]{40}$ && "$run_id" =~ ^[1-9][0-9]*-[1-9][0-9]*$ ]]
cd "$root"
umask 077
[[ -f .production.lock && ! -L .production.lock ]]
exec 9<.production.lock
flock --exclusive --wait 15 9
private="$(mktemp -d /tmp/miaomiao-copy.XXXXXX)"
name="miaomiao-copy-$run_id"
created=false
reported=false
phase=preflight
printf '[]\n' > "$private/structure-differences.json"
finish() {
  local code=$?
  trap - EXIT INT TERM HUP
  set +e
  if [[ "$created" == true ]]; then
    timeout 20 docker rm -f "$name-prisma" "$name-db" >/dev/null 2>&1 || true
  fi
  if (( code != 0 )); then
    local removed=false preserved=false sqlstate=''
    # Only fixed SQLSTATE codes can leave private logs; SQL messages, contexts,
    # failing rows and statement text can contain original production data.
    sqlstate="$(sed -nE 's/^ERROR:  ([A-Z0-9]{5})$/\1/p' "$private"/*.log 2>/dev/null | head -1)"
    if timeout 15 docker ps --all --format '{{.Names}}' > "$private/remaining" &&
       ! grep -Fxq "$name-db" "$private/remaining" && ! grep -Fxq "$name-prisma" "$private/remaining"; then removed=true; fi
    if [[ -s "$private/before.jsonl" ]] && inventory > "$private/failure-after.jsonl" &&
       cmp -s "$private/before.jsonl" "$private/failure-after.jsonl" && health &&
       [[ "$(git rev-parse HEAD)" == "$source_sha" ]]; then preserved=true; fi
    printf 'Isolated copy rehearsal failed: phase=%s exit=%s sqlstate=%s removed=%s productionPreserved=%s\n' \
      "$phase" "$code" "$sqlstate" "$removed" "$preserved" >&2
    if [[ "$reported" == false ]]; then
      jq -n --arg candidate "$candidate" --arg phase "$phase" --arg sqlstate "$sqlstate" \
      --argjson removed "$removed" --argjson preserved "$preserved" \
      --slurpfile differences "$private/structure-differences.json" \
      '{qualified:false,candidateCommit:$candidate,phase:$phase,sqlstate:$sqlstate,rawDataExported:false,
        isolatedCopyRemoved:$removed,productionServicesPreserved:$preserved,structureDifferences:$differences[0]}'
    fi
  fi
  [[ "$private" == /tmp/miaomiao-copy.* ]] && rm -rf -- "$private"
  exit "$code"
}
trap finish EXIT
trap 'exit 143' TERM HUP
trap 'exit 130' INT
source_sha="$(git rev-parse HEAD)"
[[ "$source_sha" =~ ^[a-f0-9]{40}$ ]]
health() {
  curl --fail --silent --connect-timeout 3 --max-time 15 "https://$domain/api/health" |
    jq -e --arg sha "$source_sha" '.ok==true and .database=="ok" and .redis=="ok" and .worker=="ok"
      and .app.commit==$sha and .workerVersion.commit==$sha' >/dev/null
}
inventory() {
  local service id
  for service in app worker postgres redis nginx; do
    id="$(docker ps --no-trunc --filter label=com.docker.compose.project=miaomiao-points \
      --filter label=com.docker.compose.oneoff=False --filter "label=com.docker.compose.service=$service" --format '{{.ID}}')"
    [[ "$id" =~ ^[a-f0-9]{64}$ ]]
    docker inspect "$id" | jq -ce --arg service "$service" '.[0] | select(.State.Running==true) |
      {service:$service,Id,Image,StartedAt:.State.StartedAt}'
  done
}
health
[[ -d "$payload/prisma/migrations" && -f "$payload/prisma/schema.prisma" ]]
[[ -z "$(find "$payload/prisma" -type l -print -quit)" ]]
# Skip a repeated exercise only when schema and every migration are unchanged.
git diff --quiet -- prisma
git diff --cached --quiet -- prisma
if [[ "$mode" == if-changed ]] &&
   cmp -s prisma/schema.prisma "$payload/prisma/schema.prisma" &&
   diff -qr prisma/migrations "$payload/prisma/migrations" > "$private/schema-comparison.log"; then
  jq -n --arg candidate "$candidate" --arg source "$source_sha" --arg at "$(date -u +%FT%TZ)" \
    '{schemaVersion:1,candidateCommit:$candidate,productionCommit:$source,checkedAt:$at,
      qualified:true,rehearsalPerformed:false,reason:"unchanged_schema_and_migrations",rawDataExported:false}'
  exit 0
fi
inventory > "$private/before.jsonl"
(( $(df -B1 --output=avail . | tail -1) >= 3221225472 ))
(( $(awk '/^MemAvailable:/ {print $2}' /proc/meminfo) >= 2097152 ))
backup="$(find backups -maxdepth 1 -type f -name 'miaomiao-*.dump' -printf '%T@ %p\n' | sort -nr | head -1 | cut -d' ' -f2-)"
[[ "$backup" =~ ^backups/miaomiao-[0-9-]+\.dump$ && -f "$backup.sha256" ]]
expected="$(awk 'NR==1 {print $1}' "$backup.sha256")"
[[ "$expected" =~ ^[a-f0-9]{64}$ && "$(sha256sum "$backup" | cut -d' ' -f1)" == "$expected" ]]
# Bounded first-upgrade rehearsal: the actual database is ~65 MB. Refuse larger
# copies rather than exhaust the production host's RAM. No anonymous volumes.
(( $(stat -c %s "$backup") <= 134217728 ))
pg_image="$(jq -sr '.[]|select(.service=="postgres")|.Image' "$private/before.jsonl")"
worker_image="$(jq -sr '.[]|select(.service=="worker")|.Image' "$private/before.jsonl")"
[[ "$pg_image" =~ ^sha256:[a-f0-9]{64}$ && "$worker_image" =~ ^sha256:[a-f0-9]{64}$ ]]
# Schema contains no production secrets. Keep its parent private on the host,
# but let the non-root image user read the mounted schema regardless of SSH UID.
chmod -R u=rwX,go=rX "$payload/prisma"
# Do not overwrite an earlier attempt or unrelated container.
if docker container inspect "$name-db" >/dev/null 2>&1 || docker container inspect "$name-prisma" >/dev/null 2>&1; then
  echo 'Rehearsal container name already exists; refusing to replace it.' >&2; exit 1
fi
created=true
phase=start_isolated_database
docker run -d --pull never --name "$name-db" --label miaomiao.copy-rehearsal="$run_id" \
  --network none --memory 1g --memory-swap 1g --cpus 0.5 --pids-limit 128 \
  --tmpfs /var/lib/postgresql/data:rw,nosuid,noexec,size=768m \
  --log-driver none -e POSTGRES_DB=miaomiao_rehearsal -e POSTGRES_USER=rehearsal \
  -e POSTGRES_HOST_AUTH_METHOD=trust "$pg_image" \
  postgres -c shared_buffers=32MB -c max_connections=10 -c log_statement=none \
  -c log_min_error_statement=panic -c log_min_messages=panic >/dev/null
for _ in {1..30}; do
  if docker exec "$name-db" pg_isready -U rehearsal -d miaomiao_rehearsal >/dev/null 2>&1; then break; fi
  sleep 1
done
psql_copy() { timeout 60 docker exec -i "$name-db" psql -X -qAt -v ON_ERROR_STOP=1 -v VERBOSITY=sqlstate -U rehearsal -d miaomiao_rehearsal; }
# A guard absent from every production database; sanitizer refuses without it.
printf 'CREATE SCHEMA rehearsal_guard; CREATE TABLE rehearsal_guard.authorized_copy (id integer);\n' | psql_copy > "$private/initialize.log" 2>&1
timeout 180 docker exec -i "$name-db" pg_restore --exit-on-error --no-owner --no-privileges \
  -U rehearsal -d miaomiao_rehearsal < "$backup" > "$private/restore.log" 2>&1
phase=restored_aggregates
psql_copy < "$payload/rehearsal-aggregate.sql" > "$private/restored.json" 2> "$private/sql.log"
phase=restored_balance_check
jq -e '.accountBalanceMismatches==0' "$private/restored.json" >/dev/null
phase=sanitize_copy
psql_copy < "$payload/sanitize-rehearsal.sql" > "$private/sanitize.log" 2>&1
phase=sanitized_aggregates
psql_copy < "$payload/rehearsal-aggregate.sql" > "$private/sanitized.json" 2> "$private/sql.log"
phase=sanitized_aggregate_equality
cmp -s "$private/restored.json" "$private/sanitized.json"
phase=migration_history
printf 'SELECT json_agg(json_build_object('\''name'\'',migration_name,'\''checksum'\'',checksum,'\''finished'\'',finished_at IS NOT NULL,'\''rolledBack'\'',rolled_back_at IS NOT NULL)) FROM "_prisma_migrations";\n' |
  psql_copy > "$private/before-migrations.json" 2> "$private/sql.log"
jq -e 'all(.[]; .finished==true or .rolledBack==true)' "$private/before-migrations.json" >/dev/null
phase=migration_checksums
printf '[]\n' > "$private/checksum-differences.json"
while IFS=$'\t' read -r migration checksum; do
  [[ "$migration" =~ ^[0-9]{12,14}_[a-z0-9_]+$ && "$checksum" =~ ^[a-f0-9]{64}$ ]]
  actual="$(sha256sum "$payload/prisma/migrations/$migration/migration.sql" | cut -d' ' -f1)"
  if [[ "$actual" != "$checksum" ]]; then
    jq --arg name "$migration" --arg recorded "$checksum" --arg target "$actual" \
      '.+[{name:$name,recorded:$recorded,target:$target}]' "$private/checksum-differences.json" > "$private/next.json"
    mv "$private/next.json" "$private/checksum-differences.json"
  fi
done < <(jq -r '.[]|select(.rolledBack==false)|[.name,.checksum]|@tsv' "$private/before-migrations.json")
# A mismatch still prevents qualification. Continue only inside the isolated
# copy to gather structural evidence; never resolve or rewrite migration rows.
# New SQL/schema only; never start Worker or import candidate application code.
# The existing Prisma CLI has no host mounts except read-only schema, and shares
# the copy's network NONE namespace: it cannot reach production or the Internet.
prisma_copy() {
  timeout --kill-after=5s 180s docker run --rm --pull never --name "$name-prisma" \
    --label miaomiao.copy-rehearsal="$run_id" --network "container:$name-db" \
    --memory 384m --memory-swap 384m --cpus 0.5 --pids-limit 64 --log-driver none \
    --read-only --tmpfs /tmp:rw,nosuid,size=64m \
    --mount "type=bind,source=$payload/prisma,target=/rehearsal/prisma,readonly" \
    -e DATABASE_URL=postgresql://rehearsal@127.0.0.1:5432/miaomiao_rehearsal?schema=public \
    --entrypoint node "$worker_image" /app/node_modules/prisma/build/index.js "$@"
}
phase=migrate_copy
prisma_copy migrate deploy --schema /rehearsal/prisma/schema.prisma > "$private/migrate.log" 2>&1
phase=repeat_migration
prisma_copy migrate deploy --schema /rehearsal/prisma/schema.prisma > "$private/repeat.log" 2>&1
phase=schema_drift
prisma_copy migrate diff --from-url postgresql://rehearsal@127.0.0.1:5432/miaomiao_rehearsal?schema=public \
  --to-schema-datamodel /rehearsal/prisma/schema.prisma --exit-code > "$private/drift.log" 2>&1
phase=reference_schema
printf 'CREATE DATABASE miaomiao_reference;\n' | psql_copy > "$private/reference.log" 2>&1
psql_reference() { timeout 90 docker exec -i "$name-db" psql -X -qAt -v ON_ERROR_STOP=1 -v VERBOSITY=sqlstate -U rehearsal -d miaomiao_reference; }
for migration_file in "$payload"/prisma/migrations/*/migration.sql; do
  psql_reference < "$migration_file" >> "$private/reference.log" 2>&1
done
phase=structural_equivalence
psql_copy < "$payload/rehearsal-structure.sql" > "$private/copy-structure.json" 2> "$private/sql.log"
psql_reference < "$payload/rehearsal-structure.sql" > "$private/reference-structure.json" 2> "$private/sql.log"
jq --slurpfile expected "$private/reference-structure.json" \
  '(. - $expected[0]) + ($expected[0] - .) | map({kind,key}) | unique' \
  "$private/copy-structure.json" > "$private/structure-differences.json"
jq -e 'length==0' "$private/structure-differences.json" >/dev/null
psql_copy < "$payload/rehearsal-aggregate.sql" > "$private/after.json" 2> "$private/sql.log"
cmp -s "$private/sanitized.json" "$private/after.json"
jq -e '.accountBalanceMismatches==0' "$private/after.json" >/dev/null
printf 'SELECT json_agg(json_build_object('\''name'\'',migration_name,'\''checksum'\'',checksum,'\''finished'\'',finished_at IS NOT NULL,'\''rolledBack'\'',rolled_back_at IS NOT NULL) ORDER BY migration_name) FROM "_prisma_migrations";\n' |
  psql_copy > "$private/migrations.json" 2> "$private/sql.log"
jq -e 'all(.[]; .finished==true or .rolledBack==true)' "$private/migrations.json" >/dev/null
[[ "$(jq '[.[]|select(.rolledBack==false)]|length' "$private/migrations.json")" == "$(find "$payload/prisma/migrations" -mindepth 2 -maxdepth 2 -name migration.sql -type f | wc -l)" ]]
phase=verify_production_preserved
inventory > "$private/after.jsonl"
cmp -s "$private/before.jsonl" "$private/after.jsonl"
health
[[ "$(git rev-parse HEAD)" == "$source_sha" && "$(sha256sum "$backup" | cut -d' ' -f1)" == "$expected" ]]
phase=remove_isolated_copy
timeout 20 docker rm -f "$name-db" >/dev/null
if docker container inspect "$name-db" >/dev/null 2>&1 || docker container inspect "$name-prisma" >/dev/null 2>&1; then exit 1; fi
created=false
history_matches="$(jq 'length==0' "$private/checksum-differences.json")"
jq -n --arg candidate "$candidate" --arg source "$source_sha" --arg at "$(date -u +%FT%TZ)" \
  --arg backup "$(basename "$backup")" --slurpfile aggregates "$private/after.json" --slurpfile migrations "$private/migrations.json" \
  --slurpfile differences "$private/checksum-differences.json" --argjson history "$history_matches" \
  '{schemaVersion:1,candidateCommit:$candidate,productionCommit:$source,checkedAt:$at,backup:$backup,
    backupChecksumVerified:true,networkIsolated:true,rawDataExported:false,sanitizedBeforeMigration:true,
    repeatMigrationPassed:true,schemaDrift:false,aggregatesPreserved:true,productionServicesPreserved:true,
    isolatedCopyRemoved:true,aggregates:$aggregates[0],migrations:$migrations[0],structuralEquivalence:true,
    historicalChecksumMatches:$history,checksumDifferences:$differences[0],qualified:$history,rehearsalPerformed:true}'
reported=true
phase=historical_checksum_differences
[[ "$history_matches" == true ]]
