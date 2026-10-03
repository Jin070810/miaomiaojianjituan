#!/usr/bin/env bash
set -euo pipefail
root="$(mktemp -d)"
trap 'rm -rf -- "$root"' EXIT
mkdir "$root/bin"
export LIFECYCLE_TEST_ROOT="$root" LIFECYCLE_EXIT=0 LIFECYCLE_OOM=false LIFECYCLE_PROJECT=miaomiao-points LIFECYCLE_SERVICE=worker
cat > "$root/bin/docker" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$LIFECYCLE_TEST_ROOT/commands"
if [[ "$1" == stop ]]; then touch "$LIFECYCLE_TEST_ROOT/stopped"; exit 0; fi
[[ "$1" == inspect ]]
running=true
[[ ! -f "$LIFECYCLE_TEST_ROOT/stopped" ]] || running=false
jq -n --arg id "${@: -1}" --arg project "$LIFECYCLE_PROJECT" --arg service "$LIFECYCLE_SERVICE" \
  --argjson running "$running" --argjson code "$LIFECYCLE_EXIT" --argjson oom "$LIFECYCLE_OOM" \
  '{Id:$id,Image:"sha256:synthetic",Config:{Env:["PRIVATE=never-record"],Labels:{"com.docker.compose.project":$project,"com.docker.compose.service":$service}},
    State:{Status:(if $running then "running" else "exited" end),Running:$running,Restarting:false,Paused:false,OOMKilled:$oom,ExitCode:$code,FinishedAt:"2026-10-04T00:00:00Z"}}'
FAKE
chmod +x "$root/bin/docker"
export PATH="$root/bin:$PATH"
source scripts/release-lifecycle.sh
container_id="$(printf 'a%.0s' {1..64})"
release_drain_container "$container_id" worker "$root/normal.json"
jq -e '.state.ExitCode==0 and .state.Running==false and .service=="worker"' "$root/normal.json" >/dev/null
if grep -q PRIVATE "$root/normal.json"; then exit 1; fi
for result in 137 143 1; do
  rm -f "$root/stopped"
  LIFECYCLE_EXIT="$result"
  if release_drain_container "$container_id" worker "$root/failed.json"; then
    echo "Accepted unsafe shutdown exit $result" >&2; exit 1
  fi
done
rm -f "$root/stopped"
LIFECYCLE_SERVICE=app LIFECYCLE_EXIT=143
release_drain_container "$container_id" app "$root/next.json"
rm -f "$root/stopped"
LIFECYCLE_EXIT=137
if release_drain_container "$container_id" app "$root/killed-web.json"; then exit 1; fi
LIFECYCLE_SERVICE=worker
rm -f "$root/stopped"
LIFECYCLE_EXIT=0 LIFECYCLE_OOM=true
if release_drain_container "$container_id" worker "$root/oom.json"; then exit 1; fi
rm -f "$root/stopped" "$root/commands"
LIFECYCLE_OOM=false LIFECYCLE_PROJECT=unrelated
if release_drain_container "$container_id" worker "$root/wrong.json"; then exit 1; fi
if grep -q '^stop ' "$root/commands"; then exit 1; fi
if release_drain_container 'invalid-container-id' worker "$root/invalid.json"; then exit 1; fi
release_prepare_ingress "$root/runtime" scripts/nginx-release.conf 123-1
cmp "$root/runtime/nginx.conf" scripts/nginx-release.conf
[[ "$(cat "$root/runtime/maintenance")" == 123-1 ]]
release_set_gate "$root/runtime" open 123-1
[[ ! -e "$root/runtime/maintenance" ]]
ln -s "$root/normal.json" "$root/runtime/maintenance"
if release_set_gate "$root/runtime" closed 123-1; then exit 1; fi
if release_set_gate "$root/runtime" open 123-1; then exit 1; fi
jq -e '.state.ExitCode==0' "$root/normal.json" >/dev/null
cat > "$root/bin/curl" <<'FAKE'
#!/usr/bin/env bash
while (( $# )); do
  if [[ "$1" == --dump-header ]]; then shift; headers="$1"; fi
  shift
done
printf 'HTTP/2 503\r\nX-Miaomiao-Maintenance: %s\r\nCache-Control: no-store\r\n\r\n' "${LIFECYCLE_GATE_HEADER:-1}" > "$headers"
printf '%s' "${LIFECYCLE_GATE_STATUS:-503}"
FAKE
chmod +x "$root/bin/curl"
release_verify_gate example.invalid "$root/headers"
if LIFECYCLE_GATE_STATUS=200 release_verify_gate example.invalid "$root/headers"; then exit 1; fi
if LIFECYCLE_GATE_HEADER=0 release_verify_gate example.invalid "$root/headers"; then exit 1; fi
echo 'Release drain rejects forced stops, OOM and wrong containers; HTTP gate requires 503 and its own headers.'
