#!/usr/bin/env bash
# Only runs on the disposable CI staging stack after the full browser matrix.
set -euo pipefail
[[ "${CI:-}" == true && "${RUN_RELEASE_CONTROLLER_TEST:-}" == 1 && "${POSTGRES_DB:-}" == miaomiao_staging ]]
[[ "${GITHUB_SHA:-}" =~ ^[a-f0-9]{40}$ ]]
[[ -n "${RUNNER_TEMP:-}" ]]
source_root="$(pwd)"
fixture="$(mktemp -d "$RUNNER_TEMP/release-controller.XXXXXX")"
export TEST_REAL_DOCKER TEST_APP_ID TEST_WORKER_ID
TEST_REAL_DOCKER="$(command -v docker)"
TEST_APP_ID="$(docker image inspect --format '{{.Id}}' miaomiao-points-app:production)"
TEST_WORKER_ID="$(docker image inspect --format '{{.Id}}' miaomiao-points-worker:production)"
git clone --quiet --bare --no-hardlinks "$source_root" "$fixture/origin.git"
git --git-dir "$fixture/origin.git" update-ref refs/heads/main "$GITHUB_SHA"
git --git-dir "$fixture/origin.git" symbolic-ref HEAD refs/heads/main
git clone --quiet "$fixture/origin.git" "$fixture/project"
project="$fixture/project"
mkdir -p "$fixture/bin" "$project/certs" "$source_root/output/release-controller"
# The registry itself is already covered by the candidate publisher. PRs have
# no package-write token, so this adapter maps the two fixture registry refs to
# the exact locally built IDs. Compose, DB backup, migration, App, Worker, TLS,
# Nginx reload and health requests all execute for real.
cat > "$fixture/bin/docker" <<'ADAPTER'
#!/usr/bin/env bash
set -euo pipefail
if [[ "${1:-}" == login ]]; then cat >/dev/null; exit 0; fi
if [[ "${1:-}" == pull && "${2:-}" == ghcr.io/fixture/* ]]; then exit 0; fi
args=()
for arg in "$@"; do
  if [[ "$arg" == ghcr.io/fixture/system-app@* ]]; then arg="$TEST_APP_ID"; fi
  if [[ "$arg" == ghcr.io/fixture/system-worker@* ]]; then arg="$TEST_WORKER_ID"; fi
  if [[ "$arg" == */images.json && -f "$arg" ]]; then
    jq --arg app "$TEST_APP_ID" --arg worker "$TEST_WORKER_ID" \
      '.services.app.image=$app | .services.worker.image=$worker | .services.migrate.image=$worker' "$arg" > "$arg.tmp"
    mv "$arg.tmp" "$arg"
  fi
  args+=("$arg")
done
exec "$TEST_REAL_DOCKER" "${args[@]}"
ADAPTER
chmod 700 "$fixture/bin/docker"
export PATH="$fixture/bin:$PATH"
openssl req -x509 -newkey rsa:2048 -sha256 -days 30 -nodes \
  -keyout "$project/certs/privkey.pem" -out "$project/certs/fullchain.pem" \
  -subj /CN=localhost -addext subjectAltName=DNS:localhost >/dev/null 2>&1
export CURL_CA_BUNDLE="$project/certs/fullchain.pem"
umask 077
# Secrets are read from the CI process environment, never expanded into argv/logs.
node --input-type=module - "$project/.env.production" <<'NODE'
import { writeFileSync } from 'node:fs';
const keys = ['POSTGRES_DB','POSTGRES_USER','POSTGRES_PASSWORD','DOCKER_DATABASE_URL','DOCKER_REDIS_URL',
  'SESSION_SECRET','PHONE_ENCRYPTION_KEY'];
const lines=keys.map(key => `${key}='${process.env[key]}'`);
lines.push('SESSION_COOKIE_SECURE=true','LOCAL_BACKUP_RETENTION_DAYS=7');
writeFileSync(process.argv[2],lines.join('\n')+'\n',{mode:0o600});
NODE
export GITHUB_REPOSITORY=fixture/system RELEASE_COMMIT="$GITHUB_SHA" RELEASE_VERSION=v0.0.0 PRODUCTION_DOMAIN=localhost
export GHCR_TOKEN=synthetic-ci-token BOOTSTRAP_ADMIN=false RECOVER_FROM_FAILED_RELEASE=true
export DEEPSEEK_BASE_URL=https://example.invalid DEEPSEEK_API_KEY=synthetic-unused-provider-key DEEPSEEK_MODEL=fixture
export ALERTS_DEFERRED=true BACKUP_STORAGE_MODE=local LOCAL_BACKUP_RETENTION_DAYS=7
export APP_IMAGE=ghcr.io/fixture/system-app WORKER_IMAGE=ghcr.io/fixture/system-worker
export APP_DIGEST="$TEST_APP_ID" WORKER_DIGEST="$TEST_WORKER_ID" APP_CONFIG_ID="$TEST_APP_ID" WORKER_CONFIG_ID="$TEST_WORKER_ID"
mkdir -p output/release
node scripts/release-manifest.mjs create output/release/deploy-candidate.json .
node scripts/prepare-production-release.mjs "$fixture/payload"
set +e
tar -czf - -C "$fixture/payload" request.json manifest.json production-lock.sh production-release.sh \
  production-preflight.sh pull-release-images.sh backup-db.sh verify-release-health.sh |
  bash scripts/receive-production-release.sh "$project"
status=$?
set -e
if [[ -d "$project/releases" ]]; then
  cp -r "$project/releases" "$source_root/output/release-controller/"
fi
# Retain only safe metadata, never the database dump or environment snapshots.
if (( status != 0 )); then exit "$status"; fi
jq -e '.status=="succeeded" and .phase=="completed" and .migrationsStarted' "$project/releases/active.json" >/dev/null
[[ "$(stat -c '%a' "$project/.env.production")" == 600 ]]
bash scripts/verify-release-health.sh https://localhost "$GITHUB_SHA" > output/release-controller/tls-health.json
echo 'Real staging release controller, verified pg_dump, migrations and TLS ingress passed.'
