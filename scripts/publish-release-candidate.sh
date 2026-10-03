#!/usr/bin/env bash
set -euo pipefail

[[ "${GITHUB_EVENT_NAME:-}" == push && "${GITHUB_REF:-}" == refs/heads/main ]]
[[ "${GITHUB_SHA:-}" =~ ^[0-9a-f]{40}$ ]]
[[ "${GITHUB_RUN_ID:-}" =~ ^[1-9][0-9]*$ && "${GITHUB_RUN_ATTEMPT:-}" =~ ^[1-9][0-9]*$ ]]
[[ "${GITHUB_REPOSITORY:-}" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]]
for expected in "${APP_CONFIG_ID:-}" "${WORKER_CONFIG_ID:-}"; do
  [[ "$expected" =~ ^sha256:[0-9a-f]{64}$ ]]
done
jq -e --arg sha "$GITHUB_SHA" --arg app "$APP_CONFIG_ID" --arg worker "$WORKER_CONFIG_ID" --arg time "$APP_BUILD_TIME" '
  .commit == $sha and .appId == $app and .workerId == $worker and .buildTime == $time
  and .e2e == true and .staging == true
' output/release/staging-proof.json >/dev/null

export APP_IMAGE="ghcr.io/${GITHUB_REPOSITORY,,}-app"
export WORKER_IMAGE="ghcr.io/${GITHUB_REPOSITORY,,}-worker"
tag="$GITHUB_SHA-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
# Verify both images before publishing either. There is deliberately no build command.
for kind in app worker; do
  local_image="miaomiao-points-$kind:production"
  expected="$APP_CONFIG_ID"
  if [[ "$kind" == worker ]]; then expected="$WORKER_CONFIG_ID"; fi
  [[ "$(docker image inspect --format '{{.Id}}' "$local_image")" == "$expected" ]]
  [[ "$(docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$local_image")" == "$GITHUB_SHA" ]]
done
docker tag miaomiao-points-app:production "$APP_IMAGE:$tag"
docker tag miaomiao-points-worker:production "$WORKER_IMAGE:$tag"
docker push "$APP_IMAGE:$tag"
docker push "$WORKER_IMAGE:$tag"

digest_for() {
  docker image inspect --format '{{json .RepoDigests}}' "$1:$tag" |
    jq -er --arg prefix "$1@" '[.[] | select(startswith($prefix)) | split("@")[1]] | unique | if length == 1 then .[0] else error("ambiguous registry digest") end'
}
APP_DIGEST="$(digest_for "$APP_IMAGE")"
WORKER_DIGEST="$(digest_for "$WORKER_IMAGE")"
export APP_DIGEST WORKER_DIGEST
node scripts/release-manifest.mjs create output/release/release-candidate.json
