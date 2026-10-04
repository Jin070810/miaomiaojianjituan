#!/usr/bin/env bash
# Disposable runner only: original v1.11 images, synthetic data, no production access.
set -euo pipefail
[[ "${CI:-}" == true && "${GITHUB_RUN_ID:-}" =~ ^[1-9][0-9]*$ && -n "${RUNNER_TEMP:-}" ]]
# shellcheck source=scripts/release-lifecycle.sh
source scripts/release-lifecycle.sh
legacy_sha=752b084ec220ce5c827609611e51ce718b28b92d
app_ref=ghcr.io/jin070810/miaomiaojianjituan-app@sha256:609d72450c2dfec9105302b2368979cac4853c9ab7c55b8af69021307385eca6
worker_ref=ghcr.io/jin070810/miaomiaojianjituan-worker@sha256:21ae3d56522cf9cd02e249b9804c747b2288195b4bd66bcc2b63a8a9c8ceda71
nginx_ref=nginx@sha256:65645c7bb6a0661892a8b03b89d0743208a18dd2f3f17a54ef4b76fb8e2f2a10
prefix="miaomiao-legacy-$GITHUB_RUN_ID"
private="$(mktemp -d "$RUNNER_TEMP/legacy-qualification.XXXXXX")"
evidence="$(pwd)/output/legacy-qualification"
mkdir -p "$evidence"
umask 077
pending_pid="" blocker_pid="" worker_stop_pid="" app_stop_pid=""
phase=original_images
checkpoint() { phase="$1"; printf 'legacy-qualification phase=%s\n' "$phase"; }
finish() {
  local code=$?
  trap - EXIT INT TERM
  set +e
  jq -n --arg phase "$phase" --argjson exitCode "$code" --arg at "$(date -u +%FT%TZ)" \
    '{phase:$phase,exitCode:$exitCode,finishedAt:$at}' > "$evidence/execution.json"
  if [[ -s "$private/health.json" ]]; then
    jq '{ok,issues,database,redis,worker,appCommit:.app.commit,workerCommit:.workerVersion.commit}' "$private/health.json" > "$evidence/last-health.json"
  fi
  if (( code != 0 )); then
    # Only this disposable stack has synthetic credentials; Actions masks all
    # four generated values. Raw logs are never included in uploaded artifacts.
    for service in app worker; do timeout 10 docker logs --tail 20 "$prefix-$service" >&2; done
  fi
  for pid in "$pending_pid" "$blocker_pid" "$worker_stop_pid" "$app_stop_pid"; do
    [[ -z "$pid" ]] || kill "$pid" 2>/dev/null
  done
  for service in app worker postgres redis nginx migration seed request; do
    timeout 15 docker rm -f "$prefix-$service" >/dev/null 2>&1
  done
  timeout 15 docker network rm "$prefix" >/dev/null 2>&1
  [[ "$private" == "$RUNNER_TEMP"/legacy-qualification.* ]] && rm -rf -- "$private"
  exit "$code"
}
trap finish EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
for ref in "$app_ref" "$worker_ref"; do
  timeout --kill-after=10s 360s docker pull "$ref" >/dev/null
  [[ "$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$ref")" == "$legacy_sha" ]]
done
app_id="$(docker image inspect --format '{{.Id}}' "$app_ref")"
worker_id="$(docker image inspect --format '{{.Id}}' "$worker_ref")"
jq -n --arg sha "$legacy_sha" --arg app "$app_ref" --arg worker "$worker_ref" --arg appId "$app_id" --arg workerId "$worker_id" \
  '{sourceCommit:$sha,sourceDeployRun:36514915183,images:{app:{ref:$app,id:$appId},worker:{ref:$worker,id:$workerId}},rebuilt:false}' > "$evidence/original-images.json"

password="$(openssl rand -hex 24)"
admin_password="Legacy-$(openssl rand -hex 24)"
session="$(openssl rand -hex 32)"
phone="$(openssl rand -hex 32)"
for secret in "$password" "$admin_password" "$session" "$phone"; do printf '::add-mask::%s\n' "$secret"; done
printf 'POSTGRES_USER=legacy\nPOSTGRES_DB=miaomiao_legacy\nPOSTGRES_PASSWORD=%s\n' "$password" > "$private/postgres.env"
printf 'DATABASE_URL=postgresql://legacy:%s@db:5432/miaomiao_legacy?schema=public\nREDIS_URL=redis://cache:6379\nSESSION_SECRET=%s\nPHONE_ENCRYPTION_KEY=%s\nHOSTNAME=0.0.0.0\nSESSION_COOKIE_SECURE=false\nADMIN_KUAISHOU_IDS=legacy-synthetic-admin\nADMIN_NICKNAME=Legacy Fixture\nADMIN_PASSWORD=%s\n' \
  "$password" "$session" "$phone" "$admin_password" > "$private/app.env"
checkpoint isolated_dependencies
docker network create --internal "$prefix" >/dev/null
docker run -d --name "$prefix-postgres" --network "$prefix" --network-alias db --env-file "$private/postgres.env" postgres:16-alpine >/dev/null
docker run -d --name "$prefix-redis" --network "$prefix" --network-alias cache redis:7-alpine >/dev/null
for _ in {1..30}; do
  if docker exec "$prefix-postgres" pg_isready -U legacy -d miaomiao_legacy >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec "$prefix-postgres" pg_isready -U legacy -d miaomiao_legacy >/dev/null
checkpoint original_migrations
timeout --kill-after=10s 120s docker run --rm --name "$prefix-migration" --network "$prefix" --env-file "$private/app.env" \
  "$worker_ref" ./node_modules/.bin/prisma migrate deploy > "$private/migration.log" 2>&1
timeout --kill-after=10s 60s docker run --rm --name "$prefix-seed" --network "$prefix" --env-file "$private/app.env" \
  "$worker_ref" ./node_modules/.bin/tsx scripts/seed-admin.ts > "$private/seed.log" 2>&1
checkpoint original_startup
docker run -d --name "$prefix-worker" --network "$prefix" --env-file "$private/app.env" \
  --label com.docker.compose.project=miaomiao-points --label com.docker.compose.service=worker "$worker_ref" >/dev/null
docker run -d --name "$prefix-app" --network "$prefix" --network-alias app --env-file "$private/app.env" \
  --label com.docker.compose.project=miaomiao-points --label com.docker.compose.service=app \
  --health-cmd='wget -qO- -T 4 -t 1 http://127.0.0.1:3000/api/health' \
  --health-interval=15s --health-timeout=5s --health-retries=5 --health-start-period=30s "$app_ref" >/dev/null
for _ in {1..40}; do
  if timeout 8 docker exec "$prefix-app" node -e '(async()=>{const r=await fetch("http://127.0.0.1:3000/api/health",{signal:AbortSignal.timeout(5000)});process.stdout.write(await r.text());process.exitCode=r.ok?0:1})().catch(()=>process.exit(1))' > "$private/health.json" &&
    jq -e --arg sha "$legacy_sha" '.ok == true and .app.commit == $sha and .workerVersion.commit == $sha' "$private/health.json" >/dev/null; then break; fi
  sleep 2
done
jq -e --arg sha "$legacy_sha" '.ok == true and .app.commit == $sha and .workerVersion.commit == $sha' "$private/health.json" >/dev/null
jq '{ok,database,redis,worker,appCommit:.app.commit,workerCommit:.workerVersion.commit}' "$private/health.json" > "$evidence/initial-health.json"

# The old proxy forwarded arbitrary Upgrade headers to an application without
# WebSocket endpoints. A disconnected unknown upgrade can remain CLOSE_WAIT in
# the original Next server. Prove the failure with the old two header settings,
# then verify the production template prevents it; no original image is rebuilt.
checkpoint legacy_upgrade_regression
internal_private="/tmp/$(basename "$private")"
app_container="$(docker inspect --format '{{.Id}}' "$prefix-app")"
timeout 15 openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj /CN=legacy.test \
  -keyout "$private/privkey.pem" -out "$private/fullchain.pem" > "$private/cert.log" 2>&1
# shellcheck disable=SC2016 # Keep the Nginx variable literal in the negative control.
sed 's/proxy_set_header Upgrade "";/proxy_set_header Upgrade $http_upgrade;/;s/proxy_set_header Connection "";/proxy_set_header Connection "upgrade";/' \
  scripts/nginx-release.conf > "$private/proxy.conf"
grep -qF 'proxy_set_header Connection "upgrade";' "$private/proxy.conf"
start_proxy() {
  docker run -d --name "$prefix-nginx" --network "$prefix" --network-alias nginx \
    --mount "type=bind,source=$private/proxy.conf,target=/etc/nginx/nginx.conf,readonly" \
    --mount "type=bind,source=$private,target=/etc/nginx/certs,readonly" "$nginx_ref" >/dev/null
  for _ in {1..20}; do
    if timeout 5 docker exec "$prefix-nginx" wget -qO- --no-check-certificate https://127.0.0.1/api/health >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  return 1
}
upgrade_client() {
  docker run --rm --name "$prefix-request" --network "$prefix" -e CI=true -e RUNNER_TEMP=/tmp \
    -e LEGACY_INTERNAL_NETWORK=true --mount "type=bind,source=$private,target=$internal_private" \
    --mount "type=bind,source=$(pwd)/scripts/test-legacy-upgrade-client.mjs,target=/tmp/upgrade-client.mjs,readonly" \
    "$worker_ref" node /tmp/upgrade-client.mjs "$internal_private" "$1"
  cp "$private/upgrade-$1.json" "$evidence/upgrade-$1.json"
}
web_close_waits() {
  docker exec "$prefix-app" node -e 'const fs=require("fs");let n=0;for(const file of ["/proc/net/tcp","/proc/net/tcp6"]) {for(const line of fs.readFileSync(file,"utf8").trim().split("\n").slice(1)) {const p=line.trim().split(/\s+/);if(p[1].endsWith(":0BB8")&&p[3]==="08")n++;}} console.log(n)'
}
timeout --kill-after=10s 180s docker pull "$nginx_ref" >/dev/null
start_proxy
upgrade_client legacy
legacy_close_waits="$(web_close_waits)"
[[ "$legacy_close_waits" =~ ^[1-9][0-9]*$ ]]
if release_drain_container "$app_container" app "$evidence/legacy-upgrade-app.json"; then
  echo 'Expected the isolated legacy Upgrade regression to block shutdown' >&2; exit 1
fi
jq -e '.state.ExitCode==137 and (.state.OOMKilled|not)' "$evidence/legacy-upgrade-app.json" >/dev/null
docker rm -f "$prefix-nginx" >/dev/null
cp scripts/nginx-release.conf "$private/proxy.conf"
docker start "$prefix-app" >/dev/null
start_proxy
upgrade_client protected
protected_close_waits="$(web_close_waits)"
[[ "$protected_close_waits" == 0 ]]
jq -n --argjson before "$legacy_close_waits" --argjson after "$protected_close_waits" \
  '{isolatedSyntheticData:true,historicalRequestIdentified:false,legacyCloseWaitSockets:$before,protectedCloseWaitSockets:$after,
    legacyForcedStopRejected:true}' > "$evidence/upgrade-regression.json"

# The actual failed release drained Web first, with its healthcheck enabled.
# Exercise a fully loaded page before shutdown, not only an untouched server.
checkpoint production_order_web_drain
internal_private="/tmp/$(basename "$private")"
docker run --rm --name "$prefix-request" --network "container:$prefix-app" -e CI=true -e RUNNER_TEMP=/tmp \
  -e LEGACY_INTERNAL_NETWORK=true --mount "type=bind,source=$private,target=$internal_private" \
  --mount "type=bind,source=$(pwd)/scripts/test-legacy-web-runtime.mjs,target=/app/test-legacy-web-runtime.mjs,readonly" \
  "$worker_ref" node /app/test-legacy-web-runtime.mjs "$internal_private"
cp "$private/web-runtime.json" "$evidence/web-runtime.json"
for _ in {1..40}; do
  [[ "$(docker inspect --format '{{.State.Health.Status}}' "$prefix-app")" != healthy ]] || break
  sleep 1
done
[[ "$(docker inspect --format '{{.State.Health.Status}}' "$prefix-app")" == healthy ]]
app_container="$(docker inspect --format '{{.Id}}' "$prefix-app")"
release_drain_container "$app_container" app "$evidence/production-order-app.json"
[[ "$(docker inspect --format '{{.State.Running}}' "$prefix-worker")" == true ]]
docker start "$prefix-app" >/dev/null
for _ in {1..40}; do
  if timeout 8 docker exec "$prefix-app" node -e '(async()=>{const r=await fetch("http://127.0.0.1:3000/api/health",{signal:AbortSignal.timeout(5000)});process.stdout.write(await r.text());process.exitCode=r.ok?0:1})().catch(()=>process.exit(1))' > "$private/health.json"; then break; fi
  sleep 1
done
jq -e --arg sha "$legacy_sha" '.ok == true and .app.commit == $sha and .workerVersion.commit == $sha' "$private/health.json" >/dev/null

# A real job waits on a real isolated PostgreSQL lock. It references no member
# and cannot fetch a platform URL or award points because the video does not exist.
checkpoint active_worker_drain
# An already paused queue must stay paused after a failed-release recovery.
docker exec "$prefix-worker" node -e 'const {Queue}=require("bullmq"); (async()=>{const q=new Queue("weekly-challenges",{connection:{host:"cache",port:6379}}); await q.pause(); await q.close()})().catch(()=>process.exit(1))'
docker exec -i -e PGAPPNAME=legacy-drain-blocker "$prefix-postgres" psql -X -qAt -v ON_ERROR_STOP=1 -U legacy -d miaomiao_legacy > "$private/blocker.log" 2>&1 <<'SQL' &
BEGIN;
SET LOCAL statement_timeout = '25s';
LOCK TABLE "VideoSubmission" IN ACCESS EXCLUSIVE MODE;
SELECT pg_sleep(15);
ROLLBACK;
SQL
blocker_pid=$!
for _ in {1..50}; do
  locked="$(docker exec "$prefix-postgres" psql -X -qAt -U legacy -d miaomiao_legacy -c "SELECT count(*) FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid WHERE a.application_name='legacy-drain-blocker' AND l.mode='AccessExclusiveLock' AND l.granted")"
  [[ "$locked" == 0 ]] || break
  sleep 0.1
done
[[ "${locked:-0}" != 0 ]]
docker exec "$prefix-worker" node -e 'const {Queue}=require("bullmq"); (async()=>{const q=new Queue("kuaishou-video",{connection:{host:"cache",port:6379}}); await q.add("legacy-qualification",{videoId:"legacy-drain-missing-video"},{jobId:"legacy-drain-check"}); await q.close()})().catch(()=>process.exit(1))'
for _ in {1..50}; do
  active="$(docker exec "$prefix-redis" redis-cli --raw LRANGE bull:kuaishou-video:active 0 -1)"
  [[ "$active" != legacy-drain-check ]] || break
  sleep 0.1
done
[[ "${active:-}" == legacy-drain-check ]]
# Both wrapper and direct-child TERM interrupted work in the original tsx image.
# Pause consumption first; an active task must finish before any stop is sent.
worker_container="$(docker inspect --format '{{.Id}}' "$prefix-worker")"
release_drain_container "$worker_container" worker "$evidence/controller-worker.json" \
  "$(pwd)/scripts/legacy-queue-drain.cjs" "$private/queues-before.json" &
worker_stop_pid=$!
sleep 1
worker_waited="$(docker inspect --format '{{.State.Running}}' "$prefix-worker")"
[[ "$(docker exec "$prefix-redis" redis-cli --raw LRANGE bull:kuaishou-video:active 0 -1)" == legacy-drain-check ]]
[[ ! -s "$evidence/controller-worker.json.queues-drained" ]]
wait "$blocker_pid"
blocker_pid=""
wait "$worker_stop_pid"
worker_stop_pid=""
cp "$private/queues-before.json" "$evidence/queues-before.json"
cp "$evidence/controller-worker.json.queues-drained" "$evidence/queues-drained.json"
completed="$(docker exec "$prefix-redis" redis-cli --raw ZSCORE bull:kuaishou-video:completed legacy-drain-check)"
worker_completed=false
[[ -z "$completed" ]] || worker_completed=true
docker inspect "$prefix-worker" | jq '.[0].State | {Status,ExitCode,OOMKilled}' > "$evidence/worker-exit.json"

checkpoint active_web_drain
internal_private="/tmp/$(basename "$private")"
docker run --rm --name "$prefix-request" --network "$prefix" -e CI=true -e RUNNER_TEMP=/tmp \
  -e LEGACY_INTERNAL_NETWORK=true --mount "type=bind,source=$private,target=$internal_private" \
  --mount "type=bind,source=$(pwd)/scripts/test-legacy-pending-request.mjs,target=/tmp/request.mjs,readonly" \
  "$worker_ref" node /tmp/request.mjs "$internal_private" &
pending_pid=$!
for _ in {1..50}; do [[ ! -f "$private/pending-ready" ]] || break; sleep 0.1; done
[[ -f "$private/pending-ready" ]]
docker stop --time 75 "$prefix-app" >/dev/null &
app_stop_pid=$!
sleep 1
app_waited="$(docker inspect --format '{{.State.Running}}' "$prefix-app")"
touch "$private/pending-release"
app_completed=true
wait "$pending_pid" || app_completed=false
pending_pid=""
wait "$app_stop_pid"
app_stop_pid=""
docker inspect "$prefix-app" | jq '.[0].State | {Status,ExitCode,OOMKilled}' > "$evidence/app-exit.json"
checkpoint database_quiescence
clients="$(docker exec "$prefix-postgres" psql -X -qAt -U legacy -d miaomiao_legacy -c "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND backend_type='client backend' AND pid<>pg_backend_pid()")"
jq -n --slurpfile worker "$evidence/worker-exit.json" --slurpfile app "$evidence/app-exit.json" \
  --arg at "$(date -u +%FT%TZ)" --argjson workerWaited "$worker_waited" --argjson workerCompleted "$worker_completed" \
  --argjson appWaited "$app_waited" --argjson appCompleted "$app_completed" --argjson clients "$clients" \
  '{checkedAt:$at,isolatedSyntheticData:true,workerWaitedForActiveJob:$workerWaited,workerJobCompleted:$workerCompleted,
    workerDrainStrategy:"pause-consumption-before-stop",originalDockerStopQualified:false,
    appWaitedForRequest:$appWaited,appRequestCompleted:$appCompleted,remainingDatabaseClients:$clients,worker:$worker[0],app:$app[0]}
    | .qualified=(.workerWaitedForActiveJob and .workerJobCompleted and .appWaitedForRequest and .appRequestCompleted
      and .remainingDatabaseClients==0 and .worker.Status=="exited" and (.worker.ExitCode==0 or .worker.ExitCode==143) and (.worker.OOMKilled|not)
      and .app.Status=="exited" and (.app.ExitCode==0 or .app.ExitCode==143) and (.app.OOMKilled|not))' > "$evidence/qualification.json"
cat "$evidence/qualification.json"
jq -e '.qualified == true' "$evidence/qualification.json" >/dev/null
# Recovery must restore only queues that were previously unpaused. The original
# image restarts while paused and cannot consume until this explicit restoration.
checkpoint queue_recovery
docker start "$prefix-worker" >/dev/null
for _ in {1..30}; do
  if docker exec -i -e LEGACY_QUEUE_ACTION=inspect "$prefix-worker" node < scripts/legacy-queue-drain.cjs > "$private/paused.json"; then break; fi
  sleep 1
done
jq -e 'all(.queues[]; .paused and .active==0)' "$private/paused.json" >/dev/null
release_restore_legacy_queues "$worker_container" "$(pwd)/scripts/legacy-queue-drain.cjs" \
  "$private/queues-before.json" "$evidence/queues-recovered.json"
[[ ! -e "$private/queues-before.json" ]]
jq -s -e '([.[0].queues[].paused] == [.[1].queues[].paused])' \
  "$evidence/queues-before.json" "$evidence/queues-recovered.json" >/dev/null
docker stop --time 75 "$prefix-worker" >/dev/null
checkpoint completed
