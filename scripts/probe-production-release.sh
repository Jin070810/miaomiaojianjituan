#!/usr/bin/env bash
# Read-only bounded observation. Never export account rows, secrets, or raw logs.
set -euo pipefail
root="$(realpath -e "${1:?missing project}")"
commit="${2:?missing commit}"
release_id="${3:?missing release ID}"
domain="${4:?missing domain}"
mode="${5:-health}"
[[ "$commit" =~ ^[a-f0-9]{40}$ && "$release_id" =~ ^[1-9][0-9]*-[1-9][0-9]*$ ]]
[[ "$domain" =~ ^[a-zA-Z0-9][a-zA-Z0-9.-]*$ && "$mode" =~ ^(health|integrity)$ ]]
cd "$root"
umask 077
private=""
finish() { [[ -z "$private" ]] || rm -f -- "$private"; }
trap finish EXIT
trap 'printf "{\"state\":\"unhealthy\",\"reason\":\"probe_failed\"}\n"; exit 1' ERR
exec 9<.production.lock
if ! flock --shared --nonblock 9; then
  printf '{"state":"busy"}\n'
  exit 0
fi
expected="releases/attempts/$release_id/journal.json"
jq -e --arg id "$release_id" --arg sha "$commit" \
  '.id == $id and .commit == $sha and .status == "succeeded" and .exitCode == 0' "$expected" >/dev/null
if ! jq -e --arg id "$release_id" '.id == $id' releases/active.json >/dev/null; then
  # A different host-locked deployment has taken ownership. Its success or
  # failure belongs to that attempt; never certify or interrupt it here.
  jq -e '.id | test("^[1-9][0-9]*-[1-9][0-9]*$")' releases/active.json >/dev/null
  jq -c '{state:"superseded",successor:.id,successorStatus:.status}' releases/active.json
  exit 0
fi
jq -e --arg id "$release_id" '.id == $id and .status == "succeeded" and .maintenanceEngaged == false' releases/active.json >/dev/null
jq -e --arg sha "$commit" '.commit == $sha' releases/current.json >/dev/null
[[ "$(sha256sum releases/current.json | cut -d' ' -f1)" == "$(jq -r .manifestSha256 "$expected")" ]]
for base in http://127.0.0.1:3000 "https://$domain"; do
  health="$(curl --fail --silent --connect-timeout 3 --max-time 8 "$base/api/health")"
  jq -e --arg sha "$commit" '.ok == true and .database == "ok" and .redis == "ok" and .worker == "ok"
    and .app.commit == $sha and .workerVersion.commit == $sha' <<<"$health" >/dev/null
done
code="$(curl --silent --output /dev/null --write-out '%{http_code}' --connect-timeout 3 --max-time 8 "https://$domain/login")"
[[ "$code" == 200 ]]
integrity=null
if [[ "$mode" == integrity ]]; then
  worker="$(docker ps --filter label=com.docker.compose.project=miaomiao-points --filter label=com.docker.compose.service=worker --format '{{.ID}}')"
  [[ "$worker" =~ ^[a-f0-9]{12,64}$ ]]
  [[ "$(docker inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$worker")" == "$commit" ]]
  private="$(mktemp "releases/attempts/$release_id/.observation-private.XXXXXX")"
  # Timeout inside the container prevents orphaned queries if the SSH client dies.
  if timeout --kill-after=5s 100s docker exec "$worker" timeout -s TERM 90 \
    node --import tsx scripts/reconcile-data.ts > "$private" 2>/dev/null; then
    jq -e '.hasErrors == false' "$private" >/dev/null
    integrity=true
  else
    printf '{"state":"unhealthy","reason":"integrity_check_failed"}\n'
    exit 1
  fi
fi
jq -cn --arg sha "$commit" --argjson integrity "$integrity" '{state:"healthy",commit:$sha,integrity:$integrity}'
