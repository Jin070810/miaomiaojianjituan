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
      memoryLimitBytes:.HostConfig.Memory,startedAt:.State.StartedAt,restartCount:.RestartCount,
      initEnabled:(.HostConfig.Init // false),
      entrypointKind:(if .Path=="docker-entrypoint.sh" then "node-entrypoint" elif (.Path=="node" or .Path=="/usr/local/bin/node") then "node" else "other" end),
      standaloneArguments:(.Args==["node","server.js"] or .Args==["server.js"]),
      healthIntervalNs:(.Config.Healthcheck.Interval // null),
      stopSignal:(.Config.StopSignal // "SIGTERM" | if test("^(SIG[A-Z0-9]+|[0-9]+)$") then . else "custom" end),
      manualSignalHandler:any(.Config.Env[]?; startswith("NEXT_MANUAL_SIG_HANDLE=") and (ltrimstr("NEXT_MANUAL_SIG_HANDLE=")|length>0)),
      customNodeOptions:any(.Config.Env[]?; startswith("NODE_OPTIONS=") and (ltrimstr("NODE_OPTIONS=")|length>0))}' > "$private/container.json"
  image_id="$(jq -r .imageId "$private/container.json")"
  timeout 10 docker image inspect "$image_id" | jq '.[0] | {sizeBytes:.Size,
    registryDigests:[.RepoDigests[]? | select(test("^(ghcr.io/jin070810/miaomiaojianjituan-(app|worker)|postgres|redis|nginx)@sha256:[a-f0-9]{64}$"))]}' > "$private/image.json"
  jq -s '.[0] + [ (.[1] + .[2]) ]' "$private/containers.json" "$private/container.json" "$private/image.json" > "$private/next.json"
  mv "$private/next.json" "$private/containers.json"
  [[ "$service" != app ]] || app_container="$id"
  [[ "$service" != postgres ]] || postgres="$id"
done
[[ -n "${postgres:-}" ]]
# Capacity triage is metadata only; never run prune/rm or touch database volumes.
timeout 30 docker system df --format '{{json .}}' | jq -s 'map({Type,TotalCount,Active,Size,Reclaimable})' > "$private/docker-space.json"
timeout 15 docker version --format '{{json .Server}}' | jq '{Version,ApiVersion,Os,Arch}' > "$private/docker-version.json"
timeout 15 docker info --format '{{json .}}' | jq '{Driver,DriverStatus,DockerRootDir}' > "$private/docker-storage.json"
timeout 30 docker image ls --all --no-trunc --digests --format '{{json .}}' | jq -s \
  '[.[] | select(.Repository | test("^(ghcr.io/jin070810/miaomiaojianjituan-(app|worker)|miaomiao-points-(app|worker))$"))
    | {repository:.Repository,id:.ID,tag:.Tag,digest:.Digest,size:.Size,createdAt:.CreatedAt}]' > "$private/project-images.json"
if timeout 30 docker buildx du --format=json > "$private/cache-raw.json" 2>/dev/null; then
  jq -s '{available:true,entries:map({ID,Size,Reclaimable,Shared,LastUsedAt,Type})}' "$private/cache-raw.json" > "$private/build-cache.json"
else
  printf '{"available":false,"entries":[]}\n' > "$private/build-cache.json"
fi
printf '[]\n' > "$private/directories.json"
for label in project backups sourceDependencies sourceBuild docker systemLogs aptCache; do
  case "$label" in
    project) directory="$root" ;;
    backups) directory="$root/backups" ;;
    sourceDependencies) directory="$root/node_modules" ;;
    sourceBuild) directory="$root/.next" ;;
    docker) directory=/var/lib/docker ;;
    systemLogs) directory=/var/log ;;
    aptCache) directory=/var/cache/apt/archives ;;
  esac
  size=null
  if [[ -d "$directory" ]] && timeout 25 du -x -B1 -s "$directory" > "$private/du.txt" 2>/dev/null; then
    size="$(awk '{print $1}' "$private/du.txt")"
    [[ "$size" =~ ^[0-9]+$ ]] || exit 1
  fi
  jq --arg label "$label" --argjson bytes "$size" '. + [{category:$label,bytes:$bytes}]' "$private/directories.json" > "$private/next.json"
  mv "$private/next.json" "$private/directories.json"
done
df -B1 --output=size,used,avail . | tail -n 1 | awk '{printf "{\"totalBytes\":%s,\"usedBytes\":%s,\"availableBytes\":%s}\n",$1,$2,$3}' > "$private/filesystem.json"
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
# Capture only the already-whitelisted lifecycle snapshots of the latest attempt.
# Never copy previous-*.json: those contain full Docker configuration and secrets.
printf '{"available":false}\n' > "$private/release.json"
if [[ -f releases/active.json ]]; then
  [[ ! -L releases/active.json && "$(stat -c %s releases/active.json)" -le 16384 ]]
  release_id="$(jq -er '.id | select(test("^[1-9][0-9]*-[1-9][0-9]*$"))' releases/active.json)"
  attempt_dir="$(realpath -e "releases/attempts/$release_id")"
  [[ "$attempt_dir" == "$root/releases/attempts/$release_id" ]]
  jq '{available:true,id,commit,previousCommit,status,phase,startedAt,updatedAt,exitCode,migrationsStarted,maintenanceEngaged,snapshots:[]}' \
    releases/active.json > "$private/release.json"
  for name in drain-app.json.before drain-app.json drain-worker.json.before drain-worker.json recovery-app.json recovery-worker.json; do
    file="$attempt_dir/$name"
    [[ -e "$file" ]] || continue
    [[ -f "$file" && ! -L "$file" && "$(stat -c %s "$file")" -le 16384 ]]
    jq --arg name "$name" '{name:$name,id,image,service,revision,state:(.state|{Status,Running,Restarting,Paused,OOMKilled,ExitCode,StartedAt,FinishedAt})}' \
      "$file" > "$private/snapshot.json"
    jq -s '.[0] + {snapshots:(.[0].snapshots + [.[1]])}' "$private/release.json" "$private/snapshot.json" > "$private/next.json"
    mv "$private/next.json" "$private/release.json"
  done
  # Only fixed error counts and framework stack locations leave the host.
  # Bound both the historical interval and bytes; never export raw log lines.
  log_start="$(jq -r '.startedAt // ""' "$private/release.json")"
  log_end="$(jq -r '.updatedAt // ""' "$private/release.json")"
  if [[ "$log_start" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:]{8}Z$ && "$log_end" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:]{8}Z$ ]]; then
    log_status=0
    timeout --kill-after=3s 12s docker logs --since "$log_start" --until "$log_end" --tail 200 "$app_container" \
      2>&1 | head -c 1048576 > "$private/drain-logs.txt" || log_status=$?
    jq -Rs --argjson status "$log_status" '
      {available:($status==0 or $status==141),truncated:(length>=1048576),
       markers:(["EACCES","ENOSPC","ENOMEM","ECONNRESET","ETIMEDOUT","ERR_STREAM_DESTROYED","uncaughtException","unhandledRejection","start-server process cleanup"] |
         map(. as $marker | {key:$marker,value:0}) | from_entries)} as $report |
      . as $text | $report | .markers |= with_entries(.key as $marker | .value=([$text|scan($marker)]|length)) |
      .stackLocations=([$text|scan("/app/(?:node_modules/next/dist|\\.next/server)/[A-Za-z0-9_./-]+:[0-9]+:[0-9]+")]|unique|.[0:20])
    ' "$private/drain-logs.txt" > "$private/log-summary.json"
    jq -s '.[0] + {applicationLogSummary:.[1]}' "$private/release.json" "$private/log-summary.json" > "$private/next.json"
    mv "$private/next.json" "$private/release.json"
  fi
fi
jq -n --slurpfile containers "$private/containers.json" --slurpfile db "$private/database.json" \
  --slurpfile backup "$private/backup.json" --slurpfile health "$private/health.json" \
  --slurpfile dockerSpace "$private/docker-space.json" --slurpfile dockerVersion "$private/docker-version.json" \
  --slurpfile dockerStorage "$private/docker-storage.json" --slurpfile projectImages "$private/project-images.json" \
  --slurpfile buildCache "$private/build-cache.json" --slurpfile directories "$private/directories.json" --slurpfile filesystem "$private/filesystem.json" \
  --slurpfile release "$private/release.json" \
  --arg at "$(date -u +%FT%TZ)" --arg source "$(git rev-parse HEAD)" --argjson locked "$locked" \
  --argjson availableMemoryBytes "$available_memory" --argjson availableDiskBytes "$disk_available" \
  '{schemaVersion:1,checkedAt:$at,sourceCommit:$source,sharedLock:$locked,
    resources:{availableMemoryBytes:$availableMemoryBytes,availableDiskBytes:$availableDiskBytes},
    containers:$containers[0],database:$db[0],latestBackup:$backup[0],health:$health[0],latestRelease:$release[0],
    capacity:{filesystem:$filesystem[0],dockerSpace:$dockerSpace[0],dockerVersion:$dockerVersion[0],dockerStorage:$dockerStorage[0],
      projectImages:$projectImages[0],buildCache:$buildCache[0],directories:$directories[0]}}'
