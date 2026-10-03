#!/usr/bin/env bash
set -euo pipefail

# This intentionally stops dependencies. Only the isolated CI staging job may
# opt in; never invoke it from production maintenance/deployment scripts.
[[ "${CI:-}" == true && "${STAGING_HEALTH_FAULT_TESTS:-}" == 1 && "${POSTGRES_DB:-}" == miaomiao_staging ]] || {
  echo 'Health fault tests require the isolated CI staging environment' >&2
  exit 1
}
[[ "${GITHUB_SHA:-}" =~ ^[0-9a-f]{40}$ ]]
response_file="$(mktemp)"
cleanup() {
  local status=$?
  trap - EXIT
  timeout 45s docker compose up -d --no-deps --no-build --pull never postgres redis worker >/dev/null || true
  rm -f "$response_file"
  exit "$status"
}
trap cleanup EXIT

wait_status() {
  local route="$1" expected="$2" attempts="${3:-20}" code attempt
  for ((attempt=0; attempt<attempts; attempt++)); do
    code="$(curl --silent --show-error --connect-timeout 2 --max-time 5 --output "$response_file" --write-out '%{http_code}' "http://127.0.0.1:3000$route")" || code=000
    if [[ "$code" == "$expected" ]]; then return 0; fi
    sleep 1
  done
  echo "Unexpected health status for $route: $code (expected $expected)" >&2
  cat "$response_file" >&2
  return 1
}

verify_complete_health() {
  wait_status /api/health 200
  jq -e --arg sha "$GITHUB_SHA" '.ok == true and .app.commit == $sha and .workerVersion.commit == $sha' "$response_file" >/dev/null
}

verify_complete_health
timeout 45s docker compose stop --timeout 15 worker
wait_status /api/health/live 200
wait_status /api/health/ready 200
# An abruptly stopped legacy Worker can retain its 45-second heartbeat. Allow
# that lease plus the health probe cache to expire without changing Redis data.
wait_status /api/health 503 60
jq -e '.worker != "ok" and .database == "ok" and .redis == "ok"' "$response_file" >/dev/null
# The migration ran as a removed one-off container. Restore only the tested
# service; Compose start may otherwise try to resolve that missing dependency.
timeout 45s docker compose up -d --no-deps --no-build --pull never worker
verify_complete_health

timeout 45s docker compose stop --timeout 15 redis
wait_status /api/health/ready 503
jq -e '.redis != "ok" and .database == "ok"' "$response_file" >/dev/null
wait_status /api/health/live 200
timeout 45s docker compose up -d --no-deps --no-build --pull never redis
wait_status /api/health/ready 200
verify_complete_health

timeout 45s docker compose stop --timeout 15 postgres
wait_status /api/health/ready 503
jq -e '.database != "ok"' "$response_file" >/dev/null
wait_status /api/health/live 200
timeout 45s docker compose up -d --no-deps --no-build --pull never postgres
wait_status /api/health/ready 200
verify_complete_health
echo 'PASS: Worker, Redis and PostgreSQL failures have independent health boundaries and recover'
