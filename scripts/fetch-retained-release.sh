#!/usr/bin/env bash
set -euo pipefail
commit="${1:?missing release SHA}"
run_id="${2:?missing original CI run ID}"
attempt="${3:?missing original CI attempt}"
destination="${4:?missing destination directory}"
[[ "$commit" =~ ^[a-f0-9]{40}$ && "$run_id" =~ ^[1-9][0-9]*$ && "$attempt" =~ ^[1-9][0-9]*$ ]]
[[ -n "${PRODUCTION_PATH:-}" && -n "${PRODUCTION_HOST:-}" && -n "${PRODUCTION_USER:-}" ]]
umask 077
temp="$(mktemp -d)"
trap 'rm -rf -- "$temp"' EXIT
remote_script="$(cat <<'REMOTE'
set -euo pipefail
root="$(realpath "$1")"
directory="$root/releases/$2/candidates/$3-$4"
file="$directory/$5"
[[ "$(realpath "$directory")" == "$directory" && -f "$file" && ! -L "$file" ]]
[[ "$(stat -c '%s' "$file")" -le "$6" ]]
head -c "$(($6 + 1))" -- "$file"
REMOTE
)"
for file in release-candidate.json release-candidate.sigstore.json; do
  limit=2097152
  if [[ "$file" == release-candidate.sigstore.json ]]; then limit=10485760; fi
  remote="$(printf 'bash -c %q -- %q %q %q %q %q %q' "$remote_script" \
    "$PRODUCTION_PATH" "$commit" "$run_id" "$attempt" "$file" "$limit")"
  # Read-only access: no checkout, lock, secrets or production configuration changes.
  timeout --signal=TERM --kill-after=5s 45s ssh -o ConnectTimeout=10 -o ServerAliveInterval=15 \
    -o ServerAliveCountMax=3 "$PRODUCTION_USER@$PRODUCTION_HOST" "$remote" > "$temp/$file"
  [[ -s "$temp/$file" ]]
  [[ "$(stat -c '%s' "$temp/$file")" -le "$limit" ]]
done
mkdir -p "$destination"
cp "$temp/release-candidate.json" "$temp/release-candidate.sigstore.json" "$destination/"
echo '已读取主机留存副本；仍必须通过签名、原 CI attempt 和 migration 校验。'
