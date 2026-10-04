#!/usr/bin/env bash
# A real BuildKit regression on a disposable CI runner, using only scratch data.
set -euo pipefail
[[ "${CI:-}" == true && "${GITHUB_RUN_ID:-}" =~ ^[1-9][0-9]*$ && -n "${RUNNER_TEMP:-}" ]]
fixture="$(mktemp -d "$RUNNER_TEMP/cache-filter.XXXXXX")"
tag="miaomiao-cache-filter:run-$GITHUB_RUN_ID"
finish() { docker image rm "$tag" >/dev/null 2>&1 || true; [[ "$fixture" == "$RUNNER_TEMP"/cache-filter.* ]] && rm -rf -- "$fixture"; }
trap finish EXIT
docker buildx du --builder default --format=json | jq -s 'map(.ID)' > "$fixture/before.json"
printf 'synthetic-cache-fixture-%s\n' "$GITHUB_RUN_ID" > "$fixture/payload"
printf 'FROM scratch AS stage\nCOPY payload /intermediate\nFROM scratch\nCOPY --from=stage /intermediate /final\n' > "$fixture/Dockerfile"
docker buildx build --builder default --load --tag "$tag" "$fixture" >/dev/null
docker image ls --all --quiet --no-trunc | sort -u > "$fixture/images-before"
docker buildx du --builder default --filter 'private=""' --format=json | jq -s '.' > "$fixture/private.json"
jq -e 'all(.[]; .Shared==false)' "$fixture/private.json" >/dev/null
jq --slurpfile before "$fixture/before.json" '[.[] | select(.Reclaimable==true and .Type=="regular") |
  .ID as $id | select(($before[0] | index($id))==null) | .ID]' "$fixture/private.json" > "$fixture/selected.json"
jq -e 'length>0 and all(.[]; test("^[a-z0-9]{10,64}$"))' "$fixture/selected.json" >/dev/null
selector="$(jq -r 'join("|") | "id~=^("+.+")$"' "$fixture/selected.json")"
# A new cache must NOT pass the production 7-day age guard.
docker buildx prune --builder default --force --filter "$selector" --filter until=168h --filter 'private=""' >/dev/null
docker buildx du --builder default --format=json | jq -s 'map(.ID)' > "$fixture/retained.json"
jq -s -e '.[0] as $selected | .[1] as $retained | all($selected[]; . as $id | $retained | index($id)!=null)' "$fixture/selected.json" "$fixture/retained.json" >/dev/null
# Only these freshly generated synthetic IDs are reclaimed in this test.
docker buildx prune --builder default --force --filter "$selector" --filter 'private=""' >/dev/null
docker buildx du --builder default --format=json | jq -s 'map(.ID)' > "$fixture/after.json"
jq -s -e '.[0] as $selected | .[1] as $after | any($selected[]; . as $id | $after | index($id)==null)' "$fixture/selected.json" "$fixture/after.json" >/dev/null
docker image ls --all --quiet --no-trunc | sort -u > "$fixture/images-after"
cmp "$fixture/images-before" "$fixture/images-after"
echo 'Real BuildKit: private presence filter, 7-day age guard, exact IDs and image preservation passed.'
