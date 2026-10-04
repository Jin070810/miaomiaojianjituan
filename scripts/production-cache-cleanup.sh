#!/usr/bin/env bash
# Only old, unused, private BuildKit cache; never images, containers or volumes.
set -euo pipefail
root="$(realpath -e "${1:?missing project directory}")"
domain="${2:?missing domain}" mode="${3:-inspect}"
[[ "$root" == /* && "$domain" =~ ^[A-Za-z0-9][A-Za-z0-9.-]*$ && "$mode" =~ ^(inspect|clean)$ ]]
cd "$root"
umask 077
[[ ! -L .production.lock ]]
exec 9>.production.lock
flock --exclusive --wait 15 9
private="$(mktemp -d /tmp/miaomiao-cache-cleanup.XXXXXX)"
trap '[[ "$private" == /tmp/miaomiao-cache-cleanup.* ]] && rm -rf -- "$private"' EXIT
source_commit="$(git rev-parse HEAD)"
[[ "$source_commit" =~ ^[a-f0-9]{40}$ ]]
[[ "$(timeout 15 docker buildx inspect default | awk '$1=="Driver:" {print $2}')" == docker ]]
health() {
  curl --fail --silent --connect-timeout 3 --max-time 15 "https://$domain/api/health" |
    jq -e --arg sha "$source_commit" '.ok==true and .database=="ok" and .redis=="ok" and .worker=="ok"
      and .app.commit==$sha and .workerVersion.commit==$sha' >/dev/null
}
inventory() {
  local prefix="$1" service id
  : > "$prefix.containers"
  for service in app worker postgres redis nginx; do
    id="$(timeout 10 docker ps --no-trunc --filter label=com.docker.compose.project=miaomiao-points \
      --filter label=com.docker.compose.oneoff=False --filter "label=com.docker.compose.service=$service" --format '{{.ID}}')"
    [[ "$id" =~ ^[a-f0-9]{64}$ ]]
    timeout 10 docker inspect "$id" | jq -ce '.[0] | select(.State.Running==true and .State.OOMKilled==false) |
      {Id,Image,StartedAt:.State.StartedAt}' >> "$prefix.containers"
  done
  timeout 15 docker image ls --all --quiet --no-trunc | sort -u > "$prefix.images"
  timeout 15 docker volume ls --quiet | sort > "$prefix.volumes"
  find backups -maxdepth 1 -type f -printf '%P %s %T@\n' | sort | sha256sum | cut -d' ' -f1 > "$prefix.backups"
  df -B1 --output=avail . | tail -n 1 | tr -d ' ' > "$prefix.available"
}
health
inventory "$private/before"
timeout 30 docker buildx du --builder default --filter until=168h --filter inuse=false --filter shared=false --format=json |
  jq -s '[.[] | select(.Reclaimable==true and .Shared==false and (.Type=="regular" or .Type=="exec.cachemount")) |
    {id:.ID,size:.Size,type:.Type}]' > "$private/selected.json"
jq -e 'length<=500 and all(.[]; .id | test("^[a-z0-9]{10,64}$"))' "$private/selected.json" >/dev/null
prune_exit=0
if [[ "$mode" == clean && "$(jq length "$private/selected.json")" != 0 ]]; then
  selector="$(jq -r 'map(.id) | join("|") | "id~=^("+.+")$"' "$private/selected.json")"
  # Re-check age, active use and sharing inside BuildKit itself at deletion time.
  timeout --kill-after=10s 180s docker buildx prune --builder default --force \
    --filter "$selector" --filter until=168h --filter inuse=false --filter shared=false > "$private/prune.log" 2>&1 || prune_exit=$?
fi
inventory "$private/after"
preserved=true
for kind in containers images volumes backups; do cmp -s "$private/before.$kind" "$private/after.$kind" || preserved=false; done
healthy=true
health || healthy=false
[[ "$(git rev-parse HEAD)" == "$source_commit" ]] || preserved=false
jq -n --arg mode "$mode" --arg sha "$source_commit" --arg at "$(date -u +%FT%TZ)" \
  --argjson before "$(cat "$private/before.available")" --argjson after "$(cat "$private/after.available")" \
  --slurpfile selected "$private/selected.json" --argjson code "$prune_exit" --argjson preserved "$preserved" --argjson healthy "$healthy" \
  '{schemaVersion:1,mode:$mode,sourceCommit:$sha,checkedAt:$at,availableBeforeBytes:$before,availableAfterBytes:$after,
    selectedCache:$selected[0],pruneExitCode:$code,containersImagesVolumesBackupsPreserved:$preserved,healthy:$healthy,
    capacityAtLeast3GiB:($after>=3221225472)}'
[[ "$preserved" == true && "$healthy" == true && "$prune_exit" == 0 ]]
[[ "$mode" != clean ]] || (( $(cat "$private/after.available") >= 3221225472 ))
