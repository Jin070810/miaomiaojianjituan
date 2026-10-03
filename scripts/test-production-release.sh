#!/usr/bin/env bash
set -euo pipefail
test_root="$(mktemp -d)"
trap 'rm -rf -- "$test_root"' EXIT
export REAL_GIT REAL_SLEEP
REAL_GIT="$(command -v git)"
REAL_SLEEP="$(command -v sleep)"
mkdir "$test_root/bin"
cat > "$test_root/bin/git" <<'FAKE'
#!/usr/bin/env bash
if [[ "${1:-}" == fetch ]]; then exit 0; fi
exec "$REAL_GIT" "$@"
FAKE
cat > "$test_root/bin/openssl" <<'FAKE'
#!/usr/bin/env bash
[[ "${1:-}" == x509 ]]
FAKE
cat > "$test_root/bin/sleep" <<'FAKE'
#!/usr/bin/env bash
exit 0
FAKE
cat > "$test_root/bin/curl" <<'FAKE'
#!/usr/bin/env bash
phase="$(jq -r .phase "$TEST_PROJECT/releases/active.json" 2>/dev/null || true)"
[[ "$phase" != "${FAIL_PHASE:-none}" ]] || exit 42
jq -n --arg sha "$TEST_SHA" '{ok:true,database:"ok",redis:"ok",worker:"ok",app:{commit:$sha},workerVersion:{commit:$sha},weeklyChallenges:{enabled:false}}'
FAKE
cat > "$test_root/bin/docker" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$TEST_PROJECT/docker.log"
phase="$(jq -r .phase "$TEST_PROJECT/releases/active.json" 2>/dev/null || true)"
[[ "$phase" != "${FAIL_PHASE:-none}" ]] || exit 42
if [[ "$*" == *'pg_dump --format'* ]]; then
  printf 'PGDMPsynthetic-test-backup'
elif [[ "$*" == *'pg_restore --list'* ]]; then
  [[ "$(cat)" == PGDMPsynthetic-test-backup ]]
elif [[ "$*" == *'psql -v ON_ERROR_STOP'* ]]; then
  sql="$(cat)"
  if [[ "$sql" == *to_regclass* ]]; then printf 't\n'; else printf '%s\n' "${TEST_MIGRATIONS:-[]}"; fi
elif [[ "${1:-}" == login ]]; then
  [[ "$(cat)" == fixture-secret-token ]]
elif [[ "${1:-}" == image && "${2:-}" == inspect ]]; then
  if [[ "$*" == *'{{.Id}}'* ]]; then printf '%s\n' "$TEST_IMAGE_ID"; else printf '%s\n' "$TEST_SHA"; fi
elif [[ "${1:-}" == ps ]]; then
  printf 'old-container\n'
elif [[ "${1:-}" == inspect ]]; then
  # Verify the journal strips everything except the intended image metadata.
  jq -n --arg id "$TEST_IMAGE_ID" '{Id:"old",Image:$id,State:{Status:"running"},Config:{Env:["SECRET=must-never-reach-journal"],Labels:{}}}'
fi
FAKE
chmod +x "$test_root/bin/"*
export PATH="$test_root/bin:$PATH"
export TEST_SHA TEST_PROJECT TEST_IMAGE_ID FAIL_PHASE TEST_MIGRATIONS
TEST_IMAGE_ID="sha256:$(printf 'a%.0s' {1..64})"
scenario=0
fixture() {
  scenario=$((scenario+1))
  TEST_PROJECT="$test_root/project-$scenario"
  mkdir -p "$TEST_PROJECT/certs" "$test_root/payload-$scenario"
  payload="$test_root/payload-$scenario"
  cp scripts/{production-lock,production-release,production-preflight,pull-release-images,backup-db,verify-release-health}.sh "$payload/"
  printf '{"syntheticHostFixture":true}\n' > "$payload/attestation.json"
  printf 'test\n' > "$TEST_PROJECT/certs/fullchain.pem"
  printf 'test\n' > "$TEST_PROJECT/certs/privkey.pem"
  printf 'name: miaomiao-points\nservices: {}\n' > "$TEST_PROJECT/docker-compose.yml"
  (
    cd "$TEST_PROJECT"
    "$REAL_GIT" init -q
    "$REAL_GIT" config user.email fixture@example.invalid
    "$REAL_GIT" config user.name Fixture
    "$REAL_GIT" config core.autocrlf false
    "$REAL_GIT" add docker-compose.yml
    "$REAL_GIT" commit -qm previous
    "$REAL_GIT" rev-parse HEAD > "$test_root/old-sha"
    printf 'candidate\n' > candidate.txt
    "$REAL_GIT" add candidate.txt
    "$REAL_GIT" commit -qm candidate
    "$REAL_GIT" rev-parse HEAD > "$test_root/new-sha"
    "$REAL_GIT" update-ref refs/remotes/origin/main HEAD
    "$REAL_GIT" checkout -q --detach "$(cat "$test_root/old-sha")"
  )
  TEST_SHA="$(cat "$test_root/new-sha")"
  cat > "$TEST_PROJECT/.env.production" <<'ENV'
POSTGRES_USER=fixture
POSTGRES_DB=fixture
DOCKER_DATABASE_URL='postgresql://fixture:safe-password@postgres/fixture'
SESSION_SECRET='fixture-old-session-secret-more-than-32-characters'
PHONE_ENCRYPTION_KEY='abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd'
LOCAL_BACKUP_RETENTION_DAYS='7'
DEEPSEEK_API_KEY='old-secret-key'
ENV
  chmod 600 "$TEST_PROJECT/.env.production"
  cp "$TEST_PROJECT/.env.production" "$test_root/old-env"
  jq -n --arg sha "$TEST_SHA" --arg id "$TEST_IMAGE_ID" \
    '{schemaVersion:1,repository:"example/system",commit:$sha,ci:{runId:"100",runAttempt:1},migrations:[{path:"baseline/migration.sql",sha256:"123"}],
      images:{app:{name:"ghcr.io/example/system-app",digest:$id,configId:$id},worker:{name:"ghcr.io/example/system-worker",digest:$id,configId:$id}}}' > "$payload/manifest.json"
  jq -n --arg sha "$TEST_SHA" \
    '{schemaVersion:1,id:"123-1",version:"v0.0.0",repository:"example/system",commit:$sha,actor:"fixture",domain:"example.invalid",
      token:"fixture-secret-token",recover:false,bootstrap:false,admin:null,migrationCompatibilityNote:"",
      config:(["DEEPSEEK_BASE_URL","DEEPSEEK_API_KEY","DEEPSEEK_MODEL","ALERT_WEBHOOK_URL","ALERT_EMAIL_TO","ALERT_EMAIL_FROM","ALERT_SMTP_HOST","ALERT_SMTP_PORT","ALERT_SMTP_USER","ALERT_SMTP_PASSWORD","ALERT_SMTP_SECURE","ALERTS_DEFERRED","BACKUP_STORAGE_MODE","OSS_BUCKET","OSS_ENDPOINT","OSS_ECS_ROLE_NAME","OSS_PREFIX","LOCAL_BACKUP_RETENTION_DAYS"] | map({key:.,value:""}) | from_entries)}
      | .config.DEEPSEEK_BASE_URL="https://example.invalid" | .config.DEEPSEEK_API_KEY="new-secret-$(touch SHOULD_NOT_EXECUTE)"
      | .config.DEEPSEEK_MODEL="fixture" | .config.ALERTS_DEFERRED="true" | .config.BACKUP_STORAGE_MODE="local"
      | .config.LOCAL_BACKUP_RETENTION_DAYS="7"' > "$payload/request.json"
  FAIL_PHASE=none
  TEST_MIGRATIONS='[]'
}
run_release() {
  (cd "$TEST_PROJECT" && bash "$payload/production-release.sh" "$TEST_PROJECT" "$payload") > "$test_root/run.log" 2>&1
}
assert_no_secret_evidence() {
  if grep -RE 'old-secret-key|new-secret-|fixture-secret-token|must-never-reach-journal|fixture-old-session' "$TEST_PROJECT/releases" "$test_root/run.log"; then exit 1; fi
  [[ ! -e "$TEST_PROJECT/SHOULD_NOT_EXECUTE" ]]
}
fixture
if ! run_release; then cat "$test_root/run.log"; exit 1; fi
jq -e '.status=="succeeded" and .phase=="completed" and .migrationsStarted' "$TEST_PROJECT/releases/active.json" >/dev/null
[[ "$(jq -r .commit "$TEST_PROJECT/releases/current.json")" == "$TEST_SHA" ]]
cmp "$payload/attestation.json" "$TEST_PROJECT/releases/$TEST_SHA/candidates/100-1/release-candidate.sigstore.json"
[[ "$(stat -c '%a' "$TEST_PROJECT/.env.production")" == 600 ]]
[[ "$(stat -c '%a' "$TEST_PROJECT/.release-private/123-1/env-before")" == 600 ]]
[[ "$(jq -r .sha256 "$TEST_PROJECT/releases/attempts/123-1/backup.json")" =~ ^[a-f0-9]{64}$ ]]
if grep -q 'restart nginx' "$TEST_PROJECT/docker.log"; then exit 1; fi
assert_no_secret_evidence
# Exact retries may not overwrite history or repeat admin/migration side effects.
cp "$TEST_PROJECT/releases/active.json" "$test_root/last-record"
if run_release; then echo 'duplicate attempt was accepted' >&2; exit 1; fi
cmp "$TEST_PROJECT/releases/active.json" "$test_root/last-record"

for failure in images backup migration_check migrate application local_health ingress public_health; do
  fixture
  FAIL_PHASE="$failure"
  if run_release; then echo "failure not detected: $failure" >&2; exit 1; fi
  jq -e --arg phase "$failure" '.status=="failed" and .phase==$phase' "$TEST_PROJECT/releases/active.json" >/dev/null
  [[ ! -e "$TEST_PROJECT/releases/current.json" ]]
  if [[ "$failure" == images || "$failure" == backup || "$failure" == migration_check ]]; then
    cmp "$TEST_PROJECT/.env.production" "$test_root/old-env"
    [[ "$("$REAL_GIT" -C "$TEST_PROJECT" rev-parse HEAD)" == "$(cat "$test_root/old-sha")" ]]
    if grep -q 'up -d --no-deps --no-build --pull never app worker' "$TEST_PROJECT/docker.log"; then exit 1; fi
  else
    [[ "$("$REAL_GIT" -C "$TEST_PROJECT" rev-parse HEAD)" == "$TEST_SHA" ]]
    grep -q 'new-secret-' "$TEST_PROJECT/.env.production"
    jq -e '.migrationsStarted' "$TEST_PROJECT/releases/active.json" >/dev/null
    grep -q 'rm -f miaomiao-release-123-1-migrate miaomiao-release-123-1-admin' "$TEST_PROJECT/docker.log"
  fi
  [[ -z "$(find "$TEST_PROJECT/backups" -name '*.incomplete' 2>/dev/null)" ]]
  assert_no_secret_evidence
done

# An unfinished attempt is visible and requires the existing recovery input.
fixture
FAIL_PHASE=images
if run_release; then exit 1; fi
jq '.id="124-1"' "$payload/request.json" > "$payload/new.json"
mv "$payload/new.json" "$payload/request.json"
FAIL_PHASE=none
if run_release; then echo 'unacknowledged partial release accepted' >&2; exit 1; fi
[[ ! -d "$TEST_PROJECT/releases/attempts/124-1" ]]
jq '.recover=true' "$payload/request.json" > "$payload/new.json"
mv "$payload/new.json" "$payload/request.json"
if ! run_release; then cat "$test_root/run.log"; exit 1; fi
jq -e '.status=="succeeded" and .id=="124-1"' "$TEST_PROJECT/releases/active.json" >/dev/null
jq -e '.status=="failed"' "$TEST_PROJECT/releases/attempts/123-1/journal.json" >/dev/null

fixture
TEST_MIGRATIONS='[{"name":"later","checksum":"123"}]'
if run_release; then echo 'rollback without compatibility assessment accepted' >&2; exit 1; fi
jq -e '.phase=="migration_check" and .migrationsStarted==false' "$TEST_PROJECT/releases/active.json" >/dev/null
fixture
TEST_MIGRATIONS='[{"name":"baseline","checksum":"changed"}]'
jq '.migrationCompatibilityNote="Reviewed application compatibility; never downgrade the database"' "$payload/request.json" > "$payload/new.json"
mv "$payload/new.json" "$payload/request.json"
if run_release; then echo 'changed executed migration checksum accepted' >&2; exit 1; fi
fixture
TEST_MIGRATIONS='[{"name":"later","checksum":"123"}]'
jq '.migrationCompatibilityNote="Reviewed application compatibility; later migration only adds an optional column"' "$payload/request.json" > "$payload/new.json"
mv "$payload/new.json" "$payload/request.json"
if ! run_release; then cat "$test_root/run.log"; exit 1; fi
[[ -s "$TEST_PROJECT/releases/attempts/123-1/migration-review.json" ]]

# A real flock holder blocks all controller mutation, including config and checkout.
fixture
(
  exec 9>"$TEST_PROJECT/.production.lock"
  flock 9
  touch "$test_root/lock-held"
  while [[ ! -f "$test_root/release-lock" ]]; do "$REAL_SLEEP" 0.05; done
) &
holder=$!
while [[ ! -f "$test_root/lock-held" ]]; do "$REAL_SLEEP" 0.05; done
run_release &
runner=$!
"$REAL_SLEEP" 0.3
[[ ! -d "$TEST_PROJECT/releases" ]]
cmp "$TEST_PROJECT/.env.production" "$test_root/old-env"
touch "$test_root/release-lock"
wait "$holder"
if ! wait "$runner"; then cat "$test_root/run.log"; exit 1; fi
assert_no_secret_evidence
echo 'Production release: success, 8 injected failures, rollback checks, duplicate attempt, secrets and real host lock passed.'
