#!/usr/bin/env bash
set -euo pipefail

actor="${1:-}"
app_image="${2:-}"
app_digest="${3:-}"
worker_image="${4:-}"
worker_digest="${5:-}"
release_commit="${6:-}"
app_config_id="${7:-}"
worker_config_id="${8:-}"

fail() {
  echo "发布镜像拉取失败：$1" >&2
  exit 1
}

[[ -n "$actor" ]] || fail "缺少 GHCR 用户"
[[ "$app_image" =~ ^ghcr.io/[a-z0-9_.-]+/[a-z0-9_.-]+$ ]] || fail "App 镜像必须来自 GHCR"
[[ "$worker_image" =~ ^ghcr.io/[a-z0-9_.-]+/[a-z0-9_.-]+$ ]] || fail "Worker 镜像必须来自 GHCR"
[[ "$app_digest" =~ ^sha256:[0-9a-f]{64}$ ]] || fail "App digest 无效"
[[ "$worker_digest" =~ ^sha256:[0-9a-f]{64}$ ]] || fail "Worker digest 无效"
[[ "$release_commit" =~ ^[0-9a-f]{40}$ ]] || fail "release commit 无效"
[[ "$app_config_id" =~ ^sha256:[0-9a-f]{64}$ ]] || fail "缺少有效的 App 已验收镜像 ID"
[[ "$worker_config_id" =~ ^sha256:[0-9a-f]{64}$ ]] || fail "缺少有效的 Worker 已验收镜像 ID"
command -v docker >/dev/null 2>&1 || fail "未安装 Docker"
# The controller asks for verification only and already owns the lock. Legacy
# direct tagging must also coordinate with backup, maintenance and deployment.
if [[ "${PULL_RELEASE_NO_TAG:-0}" != 1 ]]; then
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  # shellcheck source=scripts/production-lock.sh
  source "$script_dir/production-lock.sh"
  production_lock "$(pwd)"
fi

app_ref="$app_image@$app_digest"
worker_ref="$worker_image@$worker_digest"
docker_config="$(mktemp -d)"

cleanup() {
  rm -rf "$docker_config"
}
trap cleanup EXIT
export DOCKER_CONFIG="$docker_config"

timeout 30 docker login ghcr.io --username "$actor" --password-stdin
timeout 300 docker pull "$app_ref"
timeout 300 docker pull "$worker_ref"

app_revision="$(timeout 15 docker image inspect \
  --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' \
  "$app_ref")"
worker_revision="$(timeout 15 docker image inspect \
  --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' \
  "$worker_ref")"
[[ "$app_revision" == "$release_commit" ]] \
  || fail "App OCI revision 与 release commit 不一致"
[[ "$worker_revision" == "$release_commit" ]] \
  || fail "Worker OCI revision 与 release commit 不一致"
[[ "$(timeout 15 docker image inspect --format '{{.Id}}' "$app_ref")" == "$app_config_id" ]] \
  || fail "App 镜像不是 staging 验收的镜像"
[[ "$(timeout 15 docker image inspect --format '{{.Id}}' "$worker_ref")" == "$worker_config_id" ]] \
  || fail "Worker 镜像不是 staging 验收的镜像"

if [[ "${PULL_RELEASE_NO_TAG:-0}" != 1 ]]; then
  timeout 15 docker tag "$app_ref" miaomiao-points-app:production
  timeout 15 docker tag "$worker_ref" miaomiao-points-worker:production
fi
timeout 15 docker image inspect "$app_ref" "$worker_ref" \
  --format 'size={{.Size}} id={{.Id}} revision={{ index .Config.Labels "org.opencontainers.image.revision" }}'
