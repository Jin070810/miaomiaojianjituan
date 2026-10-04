#!/usr/bin/env bash
set -euo pipefail
root="$(realpath -e "${1:?project}")" payload="$(realpath -e "${2:?payload}")"
domain="${3:?domain}" mode="${4:-inspect}"
[[ "$domain" =~ ^[A-Za-z0-9][A-Za-z0-9.-]*$ && "$mode" =~ ^(inspect|clean)$ ]]
cd "$root"
umask 077
[[ -f .production.lock && ! -L .production.lock ]]
exec 9<.production.lock
flock --exclusive --wait 15 9
private="$(mktemp -d /tmp/miaomiao-image-retention.XXXXXX)"
trap '[[ "$private" == /tmp/miaomiao-image-retention.* ]] && rm -rf -- "$private"' EXIT
source_sha="$(git rev-parse HEAD)"
[[ "$source_sha" =~ ^[a-f0-9]{40}$ ]]
health() {
  curl --fail --silent --connect-timeout 3 --max-time 15 "https://$domain/api/health" |
    jq -e --arg sha "$source_sha" '.ok==true and .database=="ok" and .redis=="ok" and .worker=="ok"
      and .app.commit==$sha and .workerVersion.commit==$sha' >/dev/null
}
inventory() {
  local prefix="$1" id
  : > "$prefix.containers"
  timeout 15 docker ps --all --quiet --no-trunc | sort > "$prefix.container-ids"
  while IFS= read -r id; do
    [[ "$id" =~ ^[a-f0-9]{64}$ ]]
    timeout 10 docker inspect "$id" | jq -ce '.[0]|{Id,Image,Status:.State.Status,StartedAt:.State.StartedAt}' >> "$prefix.containers"
  done < "$prefix.container-ids"
  [[ -s "$prefix.containers" ]]
  timeout 15 docker image ls --all --quiet --no-trunc | sort -u > "$prefix.images"
  timeout 15 docker volume ls --quiet | sort > "$prefix.volumes"
  find backups -maxdepth 1 -type f -printf '%P %s %T@\n' | sort | sha256sum | cut -d' ' -f1 > "$prefix.backups"
  df -B1 --output=avail . | tail -1 | tr -d ' ' > "$prefix.available"
}
health
available="$(df -B1 --output=avail . | tail -1 | tr -d ' ')"
[[ "$available" =~ ^[0-9]+$ ]]
if [[ "$mode" == clean ]] && (( available >= 6442450944 )); then
  # A normal release needs only capacity and health checks. Avoid inventory and
  # remote registry round trips when there is no reason to remove an image.
  jq -n --arg sha "$source_sha" --arg at "$(date -u +%FT%TZ)" --argjson available "$available" \
    '{schemaVersion:1,mode:"clean",productionCommit:$sha,checkedAt:$at,maintenanceSkipped:true,
      reason:"sufficient_capacity",removedIds:[],availableBeforeBytes:$available,availableAfterBytes:$available,
      protectedResourcesPreserved:true,healthy:true,capacityAtLeast6GiB:true}'
  exit 0
fi
inventory "$private/before"
while IFS= read -r id; do
  [[ "$id" =~ ^sha256:[a-f0-9]{64}$ ]]
  timeout 10 docker image inspect "$id" | jq -ce -f "$payload/image-retention-metadata.jq"
done < "$private/before.images" | jq -s '.' > "$private/images.json"
jq -s 'map(.Image)|unique' "$private/before.containers" > "$private/used.json"
jq --arg cutoff "$(date -u -d '14 days ago' +%FT%TZ)" --slurpfile used "$private/used.json" \
  -f "$payload/select-retired-images.jq" "$private/images.json" > "$private/selection.json"
jq -e '.selected|length<=100 and all(.[]; (.id|test("^sha256:[a-f0-9]{64}$")) and (.immutableRefs|length)>0)' "$private/selection.json" >/dev/null
export DOCKER_CONFIG="$private/docker"
mkdir -m 700 "$DOCKER_CONFIG"
actor="$(jq -er '.actor|select(test("^[A-Za-z0-9_-]+(\\[bot\\])?$"))' "$payload/registry.json")"
jq -er '.token|select(type=="string" and length>0)' "$payload/registry.json" |
  timeout 30 docker login ghcr.io --username "$actor" --password-stdin > "$private/auth.log" 2>&1
printf '[]\n' > "$private/verified.json"
printf '[]\n' > "$private/removed.json"
unavailable=0
# Verify all remote immutable refs before any deletion. Unrecoverable local
# images remain untouched; tags alone are insufficient restoration evidence.
while IFS= read -r item; do
  available=true
  while IFS= read -r ref; do
    if ! timeout 25 docker manifest inspect "$ref" > "$private/remote.json" 2> "$private/remote.log" ||
       ! jq -e '.schemaVersion==2 and (.manifests!=null or .config.digest!=null)' "$private/remote.json" >/dev/null; then available=false; break; fi
  done < <(jq -r '.immutableRefs[]' <<< "$item")
  if [[ "$available" == true ]]; then
    jq --argjson item "$item" '.+[$item]' "$private/verified.json" > "$private/next.json"
    mv "$private/next.json" "$private/verified.json"
  else unavailable=$((unavailable+1)); fi
done < <(jq -c '.selected[]' "$private/selection.json")
jq -c '.[]' "$private/verified.json" > "$private/verified.jsonl"
if [[ "$mode" == clean ]]; then
  while IFS= read -r item; do
    (( $(df -B1 --output=avail . | tail -1) < 6442450944 )) || break
    id="$(jq -r .id <<< "$item")"
    timeout 15 docker ps --all --quiet --filter "ancestor=$id" > "$private/references"
    [[ ! -s "$private/references" ]] || continue
    while IFS= read -r ref; do
      timeout 15 docker image ls --all --quiet --no-trunc > "$private/current-images"
      # Removing the last tag can also remove its digest aliases.
      grep -Fxq "$id" "$private/current-images" || break
      # Recheck that each name still identifies the planned image. Docker itself
      # refuses a referenced image, and --no-prune preserves unrelated parents.
      [[ "$(timeout 10 docker image inspect --format '{{.Id}}' "$ref")" == "$id" ]]
      timeout --kill-after=5s 60s docker image rm --no-prune "$ref" > "$private/remove.log" 2>&1
    done < <(jq -r '.refs[]' <<< "$item")
    timeout 15 docker image ls --all --quiet --no-trunc > "$private/current-images"
    if grep -Fxq "$id" "$private/current-images"; then echo 'Image still referenced; stopping retention.' >&2; exit 1; fi
    jq --arg id "$id" '.+[$id]' "$private/removed.json" > "$private/next.json"
    mv "$private/next.json" "$private/removed.json"
  done < "$private/verified.jsonl"
fi
inventory "$private/after"
preserved=true
for kind in containers volumes backups; do cmp -s "$private/before.$kind" "$private/after.$kind" || preserved=false; done
jq -Rn '[inputs]' < "$private/before.images" > "$private/before-images.json"
jq -Rn '[inputs]' < "$private/after.images" > "$private/after-images.json"
jq -e --slurpfile after "$private/after-images.json" --slurpfile removed "$private/removed.json" \
  '(. - $removed[0] | sort)==($after[0]|sort)' "$private/before-images.json" >/dev/null || preserved=false
health
[[ "$(git rev-parse HEAD)" == "$source_sha" ]]
jq -n --arg mode "$mode" --arg sha "$source_sha" --arg at "$(date -u +%FT%TZ)" \
  --slurpfile selection "$private/selection.json" --slurpfile verified "$private/verified.json" --slurpfile removed "$private/removed.json" \
  --argjson unavailable "$unavailable" --argjson preserved "$preserved" \
  --argjson before "$(cat "$private/before.available")" --argjson after "$(cat "$private/after.available")" \
  '{schemaVersion:1,mode:$mode,productionCommit:$sha,checkedAt:$at,retainedVersions:$selection[0].retainedVersions,
    excludedProjectImages:$selection[0].excludedProjectImages,
    recoverableCandidates:$verified[0],unavailableImagesPreserved:$unavailable,removedIds:$removed[0],
    availableBeforeBytes:$before,availableAfterBytes:$after,protectedResourcesPreserved:$preserved,healthy:true,capacityAtLeast6GiB:($after>=6442450944)}'
[[ "$preserved" == true ]]
[[ "$mode" != clean ]] || (( $(cat "$private/after.available") >= 6442450944 ))
