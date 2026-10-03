#!/usr/bin/env bash
set -euo pipefail
repository_root="$(pwd)"
test_root="$(mktemp -d)"
trap 'rm -rf "$test_root"' EXIT
mkdir -p "$test_root/bin" "$test_root/scripts" "$test_root/output/release" "$test_root/prisma/migrations/20260101000000_initial"
cp scripts/publish-release-candidate.sh scripts/release-manifest.mjs "$test_root/scripts/"
printf 'SELECT 1;\n' > "$test_root/prisma/migrations/20260101000000_initial/migration.sql"
printf 'provider = "postgresql"\n' > "$test_root/prisma/migrations/migration_lock.toml"
printf '// schema\n' > "$test_root/prisma/schema.prisma"
export GITHUB_EVENT_NAME=push GITHUB_REF=refs/heads/main GITHUB_REPOSITORY=Example/points
export GITHUB_SHA=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa GITHUB_RUN_ID=123 GITHUB_RUN_ATTEMPT=1
export APP_CONFIG_ID=sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
export WORKER_CONFIG_ID=sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc
export APP_BUILD_TIME=2026-10-03T13:00:00Z
export ACTUAL_WORKER_ID="$WORKER_CONFIG_ID" FAKE_LOG="$test_root/docker.log"
export PATH="$test_root/bin:$PATH"
cat > "$test_root/bin/docker" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$FAKE_LOG"
case "$*" in
  *'{{.Id}}'*)
    if [[ "$*" == *app:production* ]]; then echo "$APP_CONFIG_ID"; else echo "$ACTUAL_WORKER_ID"; fi ;;
  *org.opencontainers.image.revision*) echo "$GITHUB_SHA" ;;
  *RepoDigests*)
    if [[ "$*" == *points-app:* ]]; then echo '["ghcr.io/example/points-app@sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"]'
    else echo '["ghcr.io/example/points-worker@sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"]'; fi ;;
esac
FAKE
chmod +x "$test_root/bin/docker"
cd "$test_root"
jq -n --arg commit "$GITHUB_SHA" --arg appId "$APP_CONFIG_ID" --arg workerId "$WORKER_CONFIG_ID" --arg buildTime "$APP_BUILD_TIME" \
  '{commit:$commit,appId:$appId,workerId:$workerId,buildTime:$buildTime,e2e:true,staging:true}' > output/release/staging-proof.json
bash scripts/publish-release-candidate.sh
jq -e '.images.app.digest == "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd" and .ci.runId == "123" and .checks.e2e == true' output/release/release-candidate.json >/dev/null
grep -Fqx "push ghcr.io/example/points-worker:$GITHUB_SHA-123-1" "$FAKE_LOG"
if grep -Eq '^build' "$FAKE_LOG"; then echo "发布步骤重新构建了镜像" >&2; exit 1; fi

for failure in changed-image pr-event missing-proof; do
  : > "$FAKE_LOG"
  export ACTUAL_WORKER_ID="$WORKER_CONFIG_ID" GITHUB_EVENT_NAME=push
  case "$failure" in
    changed-image) export ACTUAL_WORKER_ID="$APP_CONFIG_ID" ;;
    pr-event) export GITHUB_EVENT_NAME=pull_request ;;
    missing-proof) mv output/release/staging-proof.json output/release/invalid-proof.json ;;
  esac
  if bash scripts/publish-release-candidate.sh; then echo "未拒绝 $failure" >&2; exit 1; fi
  if grep -Eq '^(push|tag) ' "$FAKE_LOG"; then echo "失败候选仍然发布了镜像" >&2; exit 1; fi
done
cd "$repository_root"
echo "发布候选复用与失败门禁测试通过。"
