#!/usr/bin/env bash
set -euo pipefail

project_dir="$(realpath "${1:?missing project directory}")"
payload="$(realpath "${2:?missing private payload directory}")"
# shellcheck source=scripts/production-lock.sh
source "$payload/production-lock.sh"
# shellcheck source=scripts/release-lifecycle.sh
source "$payload/release-lifecycle.sh"
production_lock "$project_dir"
cd "$project_dir"
umask 077
request="$payload/request.json"
manifest="$payload/manifest.json"
attestation="$payload/attestation.json"
[[ -s "$attestation" ]]
jq -e '.schemaVersion == 1 and (.id | test("^[1-9][0-9]*-[1-9][0-9]*$"))
  and (.commit | test("^[a-f0-9]{40}$")) and (.actor | test("^[a-zA-Z0-9_-]+(\\[bot\\])?$"))
  and (.version | test("^v[0-9]+\\.[0-9]+\\.[0-9]+$"))
  and (.domain | test("^[a-zA-Z0-9][a-zA-Z0-9.-]*$"))
  and (.recover | type == "boolean") and (.bootstrap | type == "boolean")
  and (.token | type == "string" and length > 0)' "$request" >/dev/null
release_id="$(jq -r .id "$request")"
commit="$(jq -r .commit "$request")"
actor="$(jq -r .actor "$request")"
domain="$(jq -r .domain "$request")"
repository="$(jq -r .repository "$request")"
[[ "$repository" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]]
jq -e --arg sha "$commit" --arg repo "${repository,,}" '
  .schemaVersion == 1 and .commit == $sha and (.repository | ascii_downcase) == $repo
  and .images.app.name == ("ghcr.io/" + $repo + "-app")
  and .images.worker.name == ("ghcr.io/" + $repo + "-worker")
  and all(.images[]; (.digest | test("^sha256:[a-f0-9]{64}$")) and (.configId | test("^sha256:[a-f0-9]{64}$")))
  and (.migrations | type == "array" and length > 0)
  and (.ci.runId | tostring | test("^[1-9][0-9]*$"))
  and (.ci.runAttempt | tostring | test("^[1-9][0-9]*$"))
' "$manifest" >/dev/null
candidate_id="$(jq -r '.ci | (.runId|tostring)+"-"+(.runAttempt|tostring)' "$manifest")"
retained="releases/$commit/candidates/$candidate_id"
if [[ -e "$retained" ]]; then
  cmp "$manifest" "$retained/release-candidate.json"
  cmp "$attestation" "$retained/release-candidate.sigstore.json"
fi

mkdir -p releases/attempts .release-private
chmod 700 .release-private
previous_recovery=null
if [[ -f releases/active.json ]] && ! jq -e '.status == "succeeded"' releases/active.json >/dev/null; then
  if ! jq -e '.recover == true' "$request" >/dev/null; then
    previous_recovery="$(release_verify_previous_recovery "$project_dir" "$domain")" || {
      echo '上一次发布尚未满足自动恢复校验；保留原记录，禁止继续发布。' >&2
      exit 1
    }
  fi
fi
record="releases/attempts/$release_id"
[[ ! -e "$record" ]] || { echo '发布尝试 ID 已使用，拒绝覆盖历史记录。' >&2; exit 1; }
mkdir "$record" ".release-private/$release_id"
private="$project_dir/.release-private/$release_id"
journal="$record/journal.json"
phase=accepted
config_committed=false
migrations_started=false
completed=false
gate_engaged=false
writers_touched=false
previous_healthy_sha=""
runtime="$project_dir/.release-runtime"
legacy_queue_state="$runtime/legacy-queues-before.json"
previous_commit="$(timeout 15 git rev-parse HEAD)"
cp "$manifest" "$record/manifest.json"
cp "$attestation" "$record/attestation.json"
jq -n --arg id "$release_id" --arg actor "$actor" --arg commit "$commit" --arg previous "$previous_commit" \
  --arg version "$(jq -r .version "$request")" --arg hash "$(sha256sum "$manifest" | cut -d' ' -f1)" \
  --arg at "$(date -u +%FT%TZ)" --argjson previousRecovery "$previous_recovery" \
  '{id:$id, actor:$actor, commit:$commit, version:$version, manifestSha256:$hash, previousCommit:$previous, startedAt:$at,
    previousRecovery:$previousRecovery,status:"running", phase:"accepted", configCommitted:false, migrationsStarted:false}' > "$journal"
if [[ -f releases/current.json ]]; then cp releases/current.json "$record/previous.json"; fi
persist() {
  local status="$1" code="${2:-0}" temp
  temp="$(mktemp "$record/journal.XXXXXX")"
  jq --arg status "$status" --arg phase "$phase" --arg at "$(date -u +%FT%TZ)" \
    --argjson code "$code" --argjson config "$config_committed" --argjson migrated "$migrations_started" \
    --argjson gate "$gate_engaged" --argjson writers "$writers_touched" \
    '.status=$status | .phase=$phase | .updatedAt=$at | .exitCode=$code |
      .configCommitted=$config | .migrationsStarted=$migrated |
      .maintenanceEngaged=$gate | .writersTouched=$writers' "$journal" > "$temp"
  mv "$temp" "$journal"
  cp "$journal" "$private/active.json"
  mv "$private/active.json" releases/active.json
}
checkpoint() {
  phase="$1"
  persist running
  jq -cn --arg phase "$phase" --arg at "$(date -u +%FT%TZ)" '{phase:$phase,at:$at}' >> "$record/events.jsonl"
  printf 'release=%s phase=%s\n' "$release_id" "$phase"
}
finish() {
  local code=$? service id recovered=true
  trap - EXIT INT TERM HUP
  set +e
  if [[ "$completed" != true ]]; then
    (( code != 0 )) || code=1
    # Kill only named one-off containers owned by this attempt. Never leave a
    # detached migration or password reset running after its CLI was timed out.
    timeout --kill-after=5s 15s docker rm -f "miaomiao-release-$release_id-migrate" \
      "miaomiao-release-$release_id-admin" "miaomiao-release-$release_id-backup" \
      "miaomiao-release-$release_id-preflight" >/dev/null 2>&1 || true
    if [[ "$gate_engaged" == true ]]; then
      release_set_gate "$runtime" closed "$release_id" || recovered=false
    fi
    if [[ "$migrations_started" == false ]]; then
      if [[ "$config_committed" == true && -f "$private/env-before" ]]; then
        if cp "$private/env-before" "$private/env-restore" && mv "$private/env-restore" .env.production; then
          config_committed=false
        else
          recovered=false
        fi
      fi
      if ! timeout --kill-after=5s 30s git checkout --detach "$previous_commit" >/dev/null 2>&1; then
        echo '发布前源码恢复失败；以 journal 和运行中的容器为准。' >&2
        recovered=false
      fi
      if [[ "$writers_touched" == true ]]; then
        for service in app worker; do
          id="$(jq -r .Id "$record/previous-$service.json")" || recovered=false
          release_container_snapshot "$id" "$service" "$record/recovery-$service.json" &&
            timeout --kill-after=5s 30s docker start "$id" >/dev/null || recovered=false
        done
      fi
      # Recover only a version that was healthy at entry. In an acknowledged
      # already-failed release there may be no safe prior version to reopen.
      if [[ "$gate_engaged" == true && "$recovered" == true && -n "$previous_healthy_sha" ]]; then
        if [[ -f "$legacy_queue_state" ]]; then
          id="$(jq -r .Id "$record/previous-worker.json")"
          release_restore_legacy_queues "$id" "$payload/legacy-queue-drain.cjs" "$legacy_queue_state" \
            "$record/recovery-queues.json" || recovered=false
        fi
        if [[ "$recovered" == true ]] && timeout --kill-after=5s 250s bash "$payload/verify-release-health.sh" \
          http://127.0.0.1:3000 "$previous_healthy_sha" > "$record/recovery-health.json" &&
          timeout 15 "${compose[@]}" --profile production exec -T nginx nginx -c /etc/nginx/release/nginx.conf -s reload &&
          timeout --kill-after=5s 250s bash "$payload/verify-release-health.sh" \
            "https://$domain" "$previous_healthy_sha" > "$record/recovery-public-health.json"; then
          release_set_gate "$runtime" open "$release_id" && gate_engaged=false
        fi
      fi
    elif [[ "$gate_engaged" == true ]]; then
      # Migration may have changed compatibility. Retain maintenance and stop
      # only this stack's current writers; never auto-downgrade DB or images.
      for service in app worker; do
        id="$(timeout 15 docker ps -a --no-trunc --filter label=com.docker.compose.project=miaomiao-points \
          --filter "label=com.docker.compose.service=$service" --filter label=com.docker.compose.oneoff=False --format '{{.ID}}')" || continue
        [[ "$id" =~ ^[a-f0-9]{64}$ ]] || continue
        release_drain_container "$id" "$service" "$record/failure-drain-$service.json" || true
      done
    fi
    persist failed "$code" || true
    echo "发布失败，阶段=$phase；证据=$journal。迁移开始后不会自动回退数据库或应用。" >&2
  fi
  exit "$code"
}
trap finish EXIT
trap 'exit 130' INT
trap 'exit 143' TERM HUP
checkpoint verify_host
[[ -f .env.production && ! -L .env.production ]]
timeout 15 git diff --quiet
timeout 15 git diff --cached --quiet
cp .env.production "$private/env-before"
chmod 600 "$private/env-before"
# Capture actual running image IDs, even on the legacy host without a manifest.
# This is recovery evidence, not a substitute for CI provenance verification.
for service in app worker nginx; do
  ids="$(timeout 15 docker ps -a --no-trunc --filter label=com.docker.compose.project=miaomiao-points \
    --filter "label=com.docker.compose.service=$service" --filter label=com.docker.compose.oneoff=False --format '{{.ID}}')"
  if [[ -n "$ids" ]]; then
    [[ "$ids" != *$'\n'* ]]
    timeout 15 docker inspect --format '{{json .}}' "$ids" |
      jq '{Id,Image,State:{Status:.State.Status},revision:.Config.Labels["org.opencontainers.image.revision"]}' \
      > "$record/previous-$service.json"
  fi
done
# This controller updates an existing installation. Initial empty-host setup
# must be qualified separately, not treated as a successful drain of no writers.
for service in app worker; do
  jq -e '.Id | test("^[a-f0-9]{64}$")' "$record/previous-$service.json" >/dev/null
done
if health="$(curl --fail --silent --show-error --connect-timeout 5 --max-time 15 http://127.0.0.1:3000/api/health)" &&
  jq -e '.ok == true and .database == "ok" and .redis == "ok" and .worker == "ok"
    and (.app.commit | test("^[a-f0-9]{40}$")) and .app.commit == .workerVersion.commit' <<<"$health" >/dev/null; then
  previous_healthy_sha="$(jq -r .app.commit <<<"$health")"
fi
if ! jq -e '.recover == true' "$request" >/dev/null; then
  health="$(curl --fail --silent --show-error --connect-timeout 5 --max-time 15 "https://$domain/api/health")"
  jq -e '.ok == true and .database == "ok" and .redis == "ok" and .worker == "ok"
    and .app.commit == .workerVersion.commit' <<<"$health" >/dev/null
fi

checkpoint capacity_before_pull
timeout --kill-after=5s 60s bash "$payload/release-capacity.sh" "$project_dir" "$record/capacity-before-pull.json"
checkpoint source
export GIT_TERMINAL_PROMPT=0
timeout --kill-after=10s 120s git fetch --no-tags origin main
timeout 15 git cat-file -e "$commit^{commit}"
timeout 15 git merge-base --is-ancestor "$commit" origin/main
timeout --kill-after=5s 30s git checkout --detach "$commit"

checkpoint config_validate
candidate_env="$private/env-candidate"
cp "$private/env-before" "$candidate_env"
keys='["DEEPSEEK_BASE_URL","DEEPSEEK_API_KEY","DEEPSEEK_MODEL","ALERT_WEBHOOK_URL","ALERT_EMAIL_TO","ALERT_EMAIL_FROM","ALERT_SMTP_HOST","ALERT_SMTP_PORT","ALERT_SMTP_USER","ALERT_SMTP_PASSWORD","ALERT_SMTP_SECURE","ALERTS_DEFERRED","BACKUP_STORAGE_MODE","OSS_BUCKET","OSS_ENDPOINT","OSS_ECS_ROLE_NAME","OSS_PREFIX","LOCAL_BACKUP_RETENTION_DAYS"]'
jq -e --argjson keys "$keys" '.config | type == "object" and (keys | sort) == ($keys | sort)
  and all(.[]; type == "string" and index("\r") == null and index("\n") == null
    and index("\u0000") == null and index("\u0027") == null)' "$request" >/dev/null
while IFS= read -r key; do
  value="$(jq -r --arg key "$key" '.config[$key]' "$request")"
  # Values are quoted literals for Compose. Never source the environment file.
  awk -v key="$key" '$0 !~ "^[[:space:]]*(export[[:space:]]+)?" key "[[:space:]]*="' "$candidate_env" > "$private/env-next"
  printf "%s='%s'\n" "$key" "$value" >> "$private/env-next"
  mv "$private/env-next" "$candidate_env"
done < <(jq -r '.config | keys[]' "$request")
timeout --kill-after=5s 60s bash "$payload/production-preflight.sh" "$candidate_env" "$project_dir"

checkpoint images
jq -r .token "$request" | PULL_RELEASE_NO_TAG=1 timeout --kill-after=15s 720s bash "$payload/pull-release-images.sh" \
  "$actor" "$(jq -r .images.app.name "$manifest")" "$(jq -r .images.app.digest "$manifest")" \
  "$(jq -r .images.worker.name "$manifest")" "$(jq -r .images.worker.digest "$manifest")" \
  "$commit" "$(jq -r .images.app.configId "$manifest")" "$(jq -r .images.worker.configId "$manifest")"
checkpoint capacity_after_pull
timeout --kill-after=5s 60s bash "$payload/release-capacity.sh" "$project_dir" "$record/capacity-after-pull.json"
jq --arg runtime "$runtime" '{services:{app:{image:(.images.app.name+"@"+.images.app.digest)},
  worker:{image:(.images.worker.name+"@"+.images.worker.digest)},
  migrate:{image:(.images.worker.name+"@"+.images.worker.digest)},
  nginx:{command:["nginx","-c","/etc/nginx/release/nginx.conf","-g","daemon off;"],
    volumes:[{type:"bind",source:$runtime,target:"/etc/nginx/release",read_only:true}]}}}' "$manifest" > "$private/images.json"
compose=(docker compose --env-file "$candidate_env" -f "$project_dir/docker-compose.yml" -f "$private/images.json")
checkpoint dependencies
timeout --kill-after=10s 120s "${compose[@]}" up -d --wait --wait-timeout 90 postgres redis

checkpoint migration_check
# Values expand inside the postgres container, not on the host.
# shellcheck disable=SC2016
has_migrations="$(timeout --kill-after=5s 15s "${compose[@]}" exec -T postgres sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" "$POSTGRES_DB" -At' <<'SQL'
SELECT to_regclass('public._prisma_migrations') IS NOT NULL;
SQL
)"
if [[ "$has_migrations" == t ]]; then
  # shellcheck disable=SC2016
  timeout --kill-after=5s 30s "${compose[@]}" exec -T postgres sh -c \
    'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" "$POSTGRES_DB" -At' > "$record/migrations-before.json" <<'SQL'
SELECT COALESCE(json_agg(json_build_object('name', migration_name, 'checksum', checksum)), '[]')
FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL;
SQL
else
  [[ "$has_migrations" == f ]]
  printf '[]\n' > "$record/migrations-before.json"
fi
# An older image may be incompatible with later database migrations. A reviewed
# application rollback needs an explicit compatibility assessment, never a DB downgrade.
jq --slurpfile target "$manifest" --slurpfile aliases "$payload/legacy-migration-checksums.json" \
  -f "$payload/migration-history.jq" "$record/migrations-before.json" > "$record/migration-history-check.json"
jq -e '.validChecksums' "$record/migration-history-check.json" >/dev/null || {
  echo '已执行 migration 的校验和与目标版本不同，禁止部署。' >&2; exit 1;
}
if ! jq -e '.missingMigrations|length==0' "$record/migration-history-check.json" >/dev/null; then
  jq -e '.migrationCompatibilityNote | type == "string" and length >= 20 and length <= 2000' "$request" >/dev/null || {
    echo '数据库含目标版本之外的迁移或校验差异；需要应用回滚兼容性评估，拒绝继续。' >&2; exit 1;
  }
  jq '{migrationCompatibilityNote}' "$request" > "$record/migration-review.json"
fi

checkpoint candidate_preflight
timeout --kill-after=5s 45s "${compose[@]}" run -d --no-deps --pull never \
  --name "miaomiao-release-$release_id-preflight" app >/dev/null
timeout --kill-after=5s 210s docker exec -i "miaomiao-release-$release_id-preflight" \
  node --input-type=module - "$commit" < "$payload/verify-web-candidate.mjs" > "$record/candidate-preflight.json"
timeout --kill-after=5s 20s docker rm -f "miaomiao-release-$release_id-preflight" >/dev/null

checkpoint maintenance
gate_engaged=true
release_prepare_ingress "$runtime" "$payload/nginx-release.conf" "$release_id"
timeout --kill-after=10s 120s "${compose[@]}" --profile production up -d --no-deps --no-build nginx
timeout 15 "${compose[@]}" --profile production exec -T nginx nginx -c /etc/nginx/release/nginx.conf -t
timeout 15 "${compose[@]}" --profile production exec -T nginx nginx -c /etc/nginx/release/nginx.conf -s reload
release_verify_gate "$domain" "$record/maintenance-headers.txt"
checkpoint drain
writers_touched=true
persist running
for service in app worker; do
  release_drain_container "$(jq -r .Id "$record/previous-$service.json")" "$service" "$record/drain-$service.json" \
    "$payload/legacy-queue-drain.cjs" "$legacy_queue_state"
done
checkpoint database_quiescence
# Fail on any other client, including an idle connection that might start work.
# This does not terminate unrelated sessions or assume a lock blocks all SQL.
for _ in {1..5}; do
  # Let already-closing sockets (or a short postgres health probe) disappear;
  # persistent idle clients still block the release after this bounded wait.
  # shellcheck disable=SC2016
  timeout --kill-after=5s 15s "${compose[@]}" exec -T postgres sh -c \
  'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" "$POSTGRES_DB" -At' > "$record/database-quiescence.json" <<'SQL'
SELECT json_build_object('otherClients', count(*)) FROM pg_stat_activity
WHERE datname=current_database() AND pid<>pg_backend_pid()
  AND (backend_type='client backend' OR backend_type IS NULL);
SQL
  if jq -e '.otherClients==0' "$record/database-quiescence.json" >/dev/null; then break; fi
  sleep 1
done
jq -e '.otherClients==0' "$record/database-quiescence.json" >/dev/null

checkpoint backup
BACKUP_RESULT_FILE="$project_dir/$record/backup.json" timeout --kill-after=15s 600s \
  bash "$payload/backup-db.sh" "$project_dir/backups" "$candidate_env"
[[ -s "$record/backup.json" ]]
if jq -e '.config.BACKUP_STORAGE_MODE == "oss"' "$request" >/dev/null; then
  checkpoint offsite_backup
  backup_name="$(basename "$(jq -r .file "$record/backup.json")")"
  timeout --kill-after=15s 300s "${compose[@]}" run --rm --no-deps --pull never -T \
    --name "miaomiao-release-$release_id-backup" worker npm run ops:upload-backup \
    -- --file "/app/backups/$backup_name" > "$record/offsite-backup.log"
fi

checkpoint config_commit
cp "$candidate_env" "$private/env-commit"
config_committed=true
mv "$private/env-commit" .env.production
checkpoint migrate
migrations_started=true
persist running
timeout --kill-after=15s 300s "${compose[@]}" run --rm --no-deps --pull never -T \
  --name "miaomiao-release-$release_id-migrate" migrate
if jq -e '.bootstrap == true' "$request" >/dev/null; then
  checkpoint administrator
  export ADMIN_KUAISHOU_IDS ADMIN_PASSWORD ADMIN_NICKNAME
  ADMIN_KUAISHOU_IDS="$(jq -r .admin.ids "$request")"
  ADMIN_PASSWORD="$(jq -r .admin.password "$request")"
  ADMIN_NICKNAME="$(jq -r .admin.nickname "$request")"
  [[ -n "$ADMIN_KUAISHOU_IDS" && "${#ADMIN_PASSWORD}" -ge 8 ]]
  timeout --kill-after=10s 120s "${compose[@]}" run --rm --no-deps --pull never -T \
    --name "miaomiao-release-$release_id-admin" -e ADMIN_KUAISHOU_IDS -e ADMIN_PASSWORD -e ADMIN_NICKNAME worker npm run seed:admin
  unset ADMIN_KUAISHOU_IDS ADMIN_PASSWORD ADMIN_NICKNAME
fi
checkpoint application
timeout --kill-after=15s 180s "${compose[@]}" up -d --no-deps --no-build --pull never app worker
checkpoint local_health
timeout --kill-after=5s 250s bash "$payload/verify-release-health.sh" http://127.0.0.1:3000 "$commit" > "$record/local-health.json"
checkpoint ingress
timeout --kill-after=10s 120s "${compose[@]}" --profile production up -d --no-deps --no-build nginx
timeout 15 "${compose[@]}" --profile production exec -T nginx nginx -c /etc/nginx/release/nginx.conf -t
timeout 15 "${compose[@]}" --profile production exec -T nginx nginx -c /etc/nginx/release/nginx.conf -s reload
checkpoint public_health
timeout --kill-after=5s 250s bash "$payload/verify-release-health.sh" "https://$domain" "$commit" > "$record/public-health.json"
if jq -e '.config.ALERTS_DEFERRED == "true"' "$request" >/dev/null; then
  jq -e '.weeklyChallenges.enabled == false' "$record/public-health.json" >/dev/null
fi

checkpoint reopen
if [[ -f "$legacy_queue_state" ]]; then
  id="$(timeout 15 docker ps --no-trunc --filter label=com.docker.compose.project=miaomiao-points \
    --filter label=com.docker.compose.service=worker --filter label=com.docker.compose.oneoff=False --format '{{.ID}}')"
  release_restore_legacy_queues "$id" "$payload/legacy-queue-drain.cjs" "$legacy_queue_state" "$record/restored-queues.json"
fi
release_verify_gate "$domain" "$record/maintenance-final-headers.txt"
release_set_gate "$runtime" open "$release_id"
# Keep the flag true until the complete release record commits, so any later
# error re-closes ingress and leaves the failed candidate quarantined.
[[ "$(curl --silent --show-error --connect-timeout 3 --max-time 8 --output /dev/null \
  --write-out '%{http_code}' "https://$domain/login")" == 200 ]]

checkpoint record
for kind in app worker; do
  ref="$(jq -r --arg kind "$kind" '.images[$kind] | .name+"@"+.digest' "$manifest")"
  timeout 15 docker tag "$ref" "miaomiao-points-$kind:production"
done
mkdir -p "releases/$commit"
if [[ ! -d "$retained" ]]; then
  mkdir -p "releases/$commit/candidates" "$private/retained"
  cp "$manifest" "$private/retained/release-candidate.json"
  cp "$attestation" "$private/retained/release-candidate.sigstore.json"
  mv "$private/retained" "$retained"
fi
cp "$manifest" "releases/$commit/deploy-$release_id.json"
if [[ -f "$record/previous.json" ]]; then cp "$record/previous.json" "releases/$commit/previous.json"; fi
cp "$manifest" "$private/current.json"
mv "$private/current.json" releases/current.json
checkpoint completed
gate_engaged=false
persist succeeded
completed=true
printf '发布完成：%s；发布记录：%s\n' "$commit" "$journal"
