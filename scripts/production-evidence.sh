#!/usr/bin/env bash
# Read-only bootstrap diagnostic. No restart, pull, migration, dump or data export.
set -euo pipefail
root="$(realpath -e "${1:?missing project directory}")"
domain="${2:?missing public domain}"
[[ "$root" == /* && "$domain" =~ ^[A-Za-z0-9][A-Za-z0-9.-]*$ ]]
cd "$root"
umask 077
private="$(mktemp -d /tmp/miaomiao-evidence.XXXXXX)"
finish() { [[ "$private" == /tmp/miaomiao-evidence.* && -d "$private" ]] && rm -rf -- "$private"; }
trap finish EXIT
locked=false
if [[ -f .production.lock ]]; then
  exec 9<.production.lock
  flock --shared --wait 5 9
  locked=true
fi
printf '[]\n' > "$private/containers.json"
for service in app worker postgres redis nginx; do
  id="$(timeout 10 docker ps --all --filter label=com.docker.compose.project=miaomiao-points --filter label=com.docker.compose.oneoff=False --filter "label=com.docker.compose.service=$service" --format '{{.ID}}')"
  [[ "$id" =~ ^[a-f0-9]{12,64}$ ]]
  timeout 10 docker inspect "$id" | jq --arg service "$service" \
    '.[0] | {service:$service,imageId:.Image,revision:.Config.Labels["org.opencontainers.image.revision"],
      state:.State.Status,health:(.State.Health.Status // null),oom:.State.OOMKilled,
      memoryLimitBytes:.HostConfig.Memory,startedAt:.State.StartedAt}' > "$private/container.json"
  image_id="$(jq -r .imageId "$private/container.json")"
  timeout 10 docker image inspect "$image_id" | jq '.[0] | {sizeBytes:.Size,
    registryDigests:[.RepoDigests[]? | select(test("^(ghcr.io/jin070810/miaomiaojianjituan-(app|worker)|postgres|redis|nginx)@sha256:[a-f0-9]{64}$"))]}' > "$private/image.json"
  jq -s '.[0] + [ (.[1] + .[2]) ]' "$private/containers.json" "$private/container.json" "$private/image.json" > "$private/next.json"
  mv "$private/next.json" "$private/containers.json"
  [[ "$service" != postgres ]] || postgres="$id"
done
[[ -n "${postgres:-}" ]]
# Only aggregate sizing and migration identifiers/checksums leave the server.
# shellcheck disable=SC2016 # These variables belong to the PostgreSQL container.
timeout --kill-after=5s 25s docker exec -i \
  -e 'PGOPTIONS=-c default_transaction_read_only=on -c statement_timeout=5000 -c lock_timeout=500' \
  "$postgres" sh -c 'exec psql -X -qAt -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' > "$private/database.json" <<'SQL'
BEGIN TRANSACTION READ ONLY;
SELECT json_build_object(
  'sizeBytes', pg_database_size(current_database()),
  'estimatedRows', (SELECT COALESCE(json_object_agg(relname,n_live_tup),'{}'::json) FROM pg_stat_user_tables),
  'migrations', (SELECT COALESCE(json_agg(json_build_object('name',migration_name,'checksum',checksum,'finished',finished_at IS NOT NULL,'rolledBack',rolled_back_at IS NOT NULL) ORDER BY migration_name),'[]'::json) FROM "_prisma_migrations"),
  'videoRecentStatusCounts', (SELECT COALESCE(json_object_agg(status,n),'{}'::json) FROM (SELECT status, count(*) AS n FROM (SELECT status FROM "VideoSubmission" ORDER BY "submittedAt" DESC LIMIT 100) recent GROUP BY status) counts)
);
ROLLBACK;
SQL
jq -e 'type == "object" and (.migrations | type == "array")' "$private/database.json" >/dev/null
backup="$(find backups -maxdepth 1 -type f -name 'miaomiao-*.dump' -printf '%T@ %p\n' | sort -nr | head -n 1 | cut -d' ' -f2-)"
[[ "$backup" =~ ^backups/miaomiao-[0-9-]+\.dump$ && -f "$backup.sha256" ]]
expected="$(awk 'NR == 1 {print $1}' "$backup.sha256")"
[[ "$expected" =~ ^[a-f0-9]{64}$ ]]
actual="$(timeout 45 sha256sum "$backup" | cut -d' ' -f1)"
[[ "$actual" == "$expected" ]]
jq -n --arg name "$(basename "$backup")" --argjson size "$(stat -c %s "$backup")" \
  --argjson modified "$(stat -c %Y "$backup")" '{name:$name,sizeBytes:$size,modifiedUnix:$modified,checksumVerified:true}' > "$private/backup.json"
curl --fail --silent --connect-timeout 3 --max-time 15 "https://$domain/api/health" | jq \
  '{ok,database,redis,worker,appCommit:.app.commit,workerCommit:.workerVersion.commit}' > "$private/health.json"
available_memory="$(awk '/^MemAvailable:/ {print $2 * 1024}' /proc/meminfo)"
disk_available="$(df -B1 --output=avail . | tail -n 1 | tr -d ' ')"
jq -n --slurpfile containers "$private/containers.json" --slurpfile db "$private/database.json" \
  --slurpfile backup "$private/backup.json" --slurpfile health "$private/health.json" \
  --arg at "$(date -u +%FT%TZ)" --arg source "$(git rev-parse HEAD)" --argjson locked "$locked" \
  --argjson availableMemoryBytes "$available_memory" --argjson availableDiskBytes "$disk_available" \
  '{schemaVersion:1,checkedAt:$at,sourceCommit:$source,sharedLock:$locked,
    resources:{availableMemoryBytes:$availableMemoryBytes,availableDiskBytes:$availableDiskBytes},
    containers:$containers[0],database:$db[0],latestBackup:$backup[0],health:$health[0]}'
