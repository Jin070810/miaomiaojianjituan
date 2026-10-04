#!/usr/bin/env bash
set -euo pipefail
test_root="$(mktemp -d)"
trap 'rm -rf -- "$test_root"' EXIT
mkdir -p "$test_root/bin" "$test_root/project/releases/attempts/999-1"
export OBS_SHA OBS_HEALTH_SHA OBS_ROOT OBS_WORKER_SHA OBS_ERRORS=false
OBS_SHA="$(printf 'a%.0s' {1..40})"
OBS_HEALTH_SHA="$OBS_SHA"
OBS_WORKER_SHA="$OBS_SHA"
OBS_ROOT="$test_root/project"
touch "$OBS_ROOT/.production.lock"
jq -cn --arg sha "$OBS_SHA" '{commit:$sha}' > "$OBS_ROOT/releases/current.json"
hash="$(sha256sum "$OBS_ROOT/releases/current.json" | cut -d' ' -f1)"
jq -cn --arg sha "$OBS_SHA" --arg hash "$hash" '{id:"999-1",commit:$sha,status:"succeeded",exitCode:0,maintenanceEngaged:false,manifestSha256:$hash}' > "$OBS_ROOT/releases/attempts/999-1/journal.json"
cp "$OBS_ROOT/releases/attempts/999-1/journal.json" "$OBS_ROOT/releases/active.json"
cat > "$test_root/bin/curl" <<'FAKE'
#!/usr/bin/env bash
if [[ "${@: -1}" == */login ]]; then printf 200; exit 0; fi
jq -cn --arg sha "$OBS_HEALTH_SHA" '{ok:true,database:"ok",redis:"ok",worker:"ok",app:{commit:$sha},workerVersion:{commit:$sha}}'
FAKE
cat > "$test_root/bin/docker" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$OBS_ROOT/docker-commands.log"
case "${1:-}" in
  ps) printf 'aaaaaaaaaaaa\n' ;;
  inspect) printf '%s\n' "$OBS_WORKER_SHA" ;;
  exec)
    [[ "$*" == 'exec aaaaaaaaaaaa timeout -s TERM 90 node --import tsx scripts/reconcile-data.ts' ]]
    jq -cn --argjson errors "$OBS_ERRORS" '{hasErrors:$errors,accounts:[{privateField:"must-not-be-published"}]}'
    [[ "$OBS_ERRORS" == false ]] ;;
  *) exit 99 ;;
esac
FAKE
chmod +x "$test_root/bin/"*
export PATH="$test_root/bin:$PATH"
probe() { bash scripts/probe-production-release.sh "$OBS_ROOT" "$OBS_SHA" 999-1 example.test "${1:-health}"; }
probe | jq -e '.state == "healthy" and .integrity == null' >/dev/null
probe integrity > "$test_root/result.json"
jq -e '.state == "healthy" and .integrity == true' "$test_root/result.json" >/dev/null
if grep -q 'must-not-be-published' "$test_root/result.json"; then exit 1; fi
[[ -z "$(find "$OBS_ROOT/releases" -name '.observation-private.*' -print -quit)" ]]
OBS_ERRORS=true
if probe integrity > "$test_root/result.json"; then echo 'Bad reconciliation accepted' >&2; exit 1; fi
jq -e '.reason == "integrity_check_failed"' "$test_root/result.json" >/dev/null
if grep -q 'must-not-be-published' "$test_root/result.json"; then exit 1; fi
[[ -z "$(find "$OBS_ROOT/releases" -name '.observation-private.*' -print -quit)" ]]
OBS_ERRORS=false
OBS_HEALTH_SHA="$(printf 'b%.0s' {1..40})"
if probe > "$test_root/result.json"; then echo 'Wrong live version accepted' >&2; exit 1; fi
OBS_HEALTH_SHA="$OBS_SHA"
OBS_WORKER_SHA="$(printf 'b%.0s' {1..40})"
if probe integrity > "$test_root/result.json"; then echo 'Wrong Worker accepted' >&2; exit 1; fi
OBS_WORKER_SHA="$OBS_SHA"
# A concurrent host operation yields; the observer never holds a write lock.
exec 8>"$OBS_ROOT/.production.lock"
flock --exclusive 8
probe | jq -e '.state == "busy"' >/dev/null
flock --unlock 8
# Another attempt owns production; no queries, stop, rollback, or maintenance writes.
jq '.id="1000-1" | .status="failed"' "$OBS_ROOT/releases/active.json" > "$test_root/next.json"
mv "$test_root/next.json" "$OBS_ROOT/releases/active.json"
: > "$OBS_ROOT/docker-commands.log"
probe integrity | jq -e '.state == "superseded" and .successor == "1000-1" and .successorStatus == "failed"' >/dev/null
[[ ! -s "$OBS_ROOT/docker-commands.log" ]]
echo 'Observation privacy, version, reconciliation, lock and supersession tests passed.'
