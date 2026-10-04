#!/usr/bin/env bash
set -euo pipefail

base_url="${1:?missing base URL}"
release_commit="${2:?missing release SHA}"
[[ "$base_url" =~ ^https?://[^[:space:]]+$ ]]
[[ "$release_commit" =~ ^[0-9a-f]{40}$ ]]
# Every request and the retry count are bounded, including an unresponsive app.
for _ in {1..18}; do
  if health_json="$(curl --fail-with-body --silent --show-error --connect-timeout 3 --max-time 8 "${base_url%/}/api/health")"; then
    if jq -e --arg sha "$release_commit" '
      .ok == true and .database == "ok" and .redis == "ok" and .worker == "ok"
      and .app.commit == $sha and .workerVersion.commit == $sha
    ' <<<"$health_json" >/dev/null; then
      printf '%s\n' "$health_json"
      exit 0
    fi
  fi
  sleep 5
done
printf '%s' "${health_json:-}" | jq '{ok, database, redis, worker, app, workerVersion, issues}' >&2 || true
echo "候选 App/Worker 未在限定时间内通过同版本健康检查" >&2
exit 1
