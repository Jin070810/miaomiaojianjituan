#!/usr/bin/env bash
set -euo pipefail

test_root="$(mktemp -d)"
cleanup() {
  rm -rf "$test_root"
}
trap cleanup EXIT

mkdir -p "$test_root/bin"
fake_log="$test_root/docker.log"
release_commit="0123456789abcdef0123456789abcdef01234567"
app_digest="sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
worker_digest="sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
app_config_id="sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
worker_config_id="sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"

cat > "$test_root/bin/docker" <<'FAKE_DOCKER'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$FAKE_DOCKER_LOG"
if [[ "${1:-}" == "login" ]]; then
  token="$(cat)"
  [[ "$token" == "$EXPECTED_GHCR_TOKEN" ]]
elif [[ "${1:-}" == "image" && "${2:-}" == "inspect" ]]; then
  if [[ "$*" == *'{{.Id}}'* ]]; then
    if [[ "$*" == *'ghcr.io/example/app@'* ]]; then printf '%s\n' "$EXPECTED_APP_ID"; else printf '%s\n' "$EXPECTED_WORKER_ID"; fi
  elif [[ "$*" == *"org.opencontainers.image.revision"* ]]; then
    printf '%s\n' "$EXPECTED_RELEASE_COMMIT"
  else
    printf 'verified\n'
  fi
fi
FAKE_DOCKER
chmod +x "$test_root/bin/docker"

export PATH="$test_root/bin:$PATH"
export FAKE_DOCKER_LOG="$fake_log"
export EXPECTED_GHCR_TOKEN="short-lived-token"
export EXPECTED_RELEASE_COMMIT="$release_commit"
export EXPECTED_APP_ID="$app_config_id"
export EXPECTED_WORKER_ID="$worker_config_id"

printf '%s' "$EXPECTED_GHCR_TOKEN" | bash scripts/pull-release-images.sh \
  deployer ghcr.io/example/app "$app_digest" \
  ghcr.io/example/worker "$worker_digest" "$release_commit" "$app_config_id" "$worker_config_id"

grep -Fqx "pull ghcr.io/example/app@$app_digest" "$fake_log"
grep -Fqx "pull ghcr.io/example/worker@$worker_digest" "$fake_log"
grep -Fqx "tag ghcr.io/example/app@$app_digest miaomiao-points-app:production" "$fake_log"
grep -Fqx "tag ghcr.io/example/worker@$worker_digest miaomiao-points-worker:production" "$fake_log"

: > "$fake_log"
export EXPECTED_RELEASE_COMMIT="ffffffffffffffffffffffffffffffffffffffff"
if printf '%s' "$EXPECTED_GHCR_TOKEN" | bash scripts/pull-release-images.sh \
  deployer ghcr.io/example/app "$app_digest" \
  ghcr.io/example/worker "$worker_digest" "$release_commit" "$app_config_id" "$worker_config_id"; then
  echo "OCI revision 不一致未被拒绝" >&2
  exit 1
fi
if grep -Fq "tag " "$fake_log"; then
  echo "OCI revision 不一致时仍更新了 production 标签" >&2
  exit 1
fi

if printf '%s' "$EXPECTED_GHCR_TOKEN" | bash scripts/pull-release-images.sh \
  deployer ghcr.io/example/app invalid-digest \
  ghcr.io/example/worker "$worker_digest" "$release_commit" "$app_config_id" "$worker_config_id"; then
  echo "无效 digest 未被拒绝" >&2
  exit 1
fi

: > "$fake_log"
export EXPECTED_RELEASE_COMMIT="$release_commit"
export EXPECTED_WORKER_ID="$app_config_id"
if printf '%s' "$EXPECTED_GHCR_TOKEN" | bash scripts/pull-release-images.sh \
  deployer ghcr.io/example/app "$app_digest" \
  ghcr.io/example/worker "$worker_digest" "$release_commit" "$app_config_id" "$worker_config_id"; then
  echo "Worker 与 staging 镜像 ID 不一致未被拒绝" >&2
  exit 1
fi
if grep -Fq "tag " "$fake_log"; then
  echo "镜像 ID 不一致时仍更新了 production 标签" >&2
  exit 1
fi
echo "发布镜像拉取脚本测试通过。"
