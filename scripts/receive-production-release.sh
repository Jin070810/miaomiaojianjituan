#!/usr/bin/env bash
# Sent by the current main workflow, not read from the release being rolled back.
set -euo pipefail
project_dir="$(realpath "${1:?missing project directory}")"
[[ -d "$project_dir/.git" ]]
umask 077
exec 9>"$project_dir/.production.lock"
flock --exclusive --wait 120 9 || exit 75
payload="$(mktemp -d)"
cleanup() { rm -rf -- "$payload"; }
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM HUP
# Only the named regular files from this workflow are accepted. No source tree,
# database data or secrets are copied into the public release evidence directory.
timeout --signal=TERM --kill-after=10s 60s tar -xzf - --no-same-owner --no-same-permissions \
  -C "$payload" request.json manifest.json attestation.json production-lock.sh production-release.sh \
  production-preflight.sh pull-release-images.sh backup-db.sh verify-release-health.sh \
  release-lifecycle.sh nginx-release.conf verify-web-candidate.mjs legacy-queue-drain.cjs
for file in "$payload"/*; do [[ -f "$file" && ! -L "$file" ]]; done
timeout --signal=TERM --kill-after=30s 30m bash "$payload/production-release.sh" "$project_dir" "$payload"
