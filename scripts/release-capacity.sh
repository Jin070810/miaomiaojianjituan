#!/usr/bin/env bash
# Read-only capacity gate, before source/image changes and again before downtime.
set -euo pipefail
project="$(realpath -e "${1:?missing project}")"
report="${2:?missing report path}"
[[ "$project" == /* && -d "$project" ]]
postgres="$(timeout 10 docker ps --no-trunc --filter label=com.docker.compose.project=miaomiao-points --filter label=com.docker.compose.service=postgres --filter label=com.docker.compose.oneoff=False --format '{{.ID}}')"
[[ "$postgres" =~ ^[a-f0-9]{64}$ ]]
host_available="$(df -B1 --output=avail "$project" | tail -n 1 | tr -d ' ')"
host_inodes="$(df --output=iavail "$project" | tail -n 1 | tr -d ' ')"
# The persistent DB container's root reports the image snapshot filesystem.
# This also works during recovery with App/Worker stopped, without requiring the
# SSH user to traverse root-owned Docker/containerd directories.
image_available="$(timeout 10 docker exec "$postgres" df -Pk / | awk 'END {printf "%.0f", $4*1024}')"
image_inodes="$(timeout 10 docker exec "$postgres" df -Pi / | awk 'END {print $4}')"
database_available="$(timeout 10 docker exec "$postgres" df -Pk /var/lib/postgresql/data | awk 'END {printf "%.0f", $4*1024}')"
# shellcheck disable=SC2016
database_size="$(timeout --kill-after=5s 15s docker exec \
  -e 'PGOPTIONS=-c default_transaction_read_only=on -c statement_timeout=5000' "$postgres" sh -c \
  'exec psql -X -qAt -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT pg_database_size(current_database())"')"
for value in "$host_available" "$host_inodes" "$image_available" "$image_inodes" "$database_available" "$database_size"; do
  [[ "$value" =~ ^[0-9]{1,15}$ ]] || exit 1
done
# Operational headroom: at least 3GiB; larger databases reserve 3x their size
# plus 1GiB for backup, migration/WAL and runtime growth. Recheck after pulls.
required=$((database_size * 3 + 1073741824))
(( required >= 3221225472 )) || required=3221225472
jq -n --argjson host "$host_available" --argjson hostInodes "$host_inodes" \
  --argjson images "$image_available" --argjson imageInodes "$image_inodes" --argjson database "$database_available" \
  --argjson databaseSize "$database_size" --argjson required "$required" \
  '{projectAvailableBytes:$host,imageStoreAvailableBytes:$images,databaseAvailableBytes:$database,
    databaseSizeBytes:$databaseSize,requiredBytes:$required,projectFreeInodes:$hostInodes,imageStoreFreeInodes:$imageInodes,
    ok:($host >= $required and $images >= $required and $database >= $required and $hostInodes>=50000 and $imageInodes>=50000)}' > "$report"
jq -e '.ok==true' "$report" >/dev/null || {
  echo '发布前磁盘空间或 inode 不足；保留当前服务，禁止继续发布。' >&2
  exit 1
}
