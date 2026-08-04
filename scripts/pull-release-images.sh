#!/usr/bin/env bash
set -euo pipefail

actor="${1:-}"
app_image="${2:-}"
app_digest="${3:-}"
worker_image="${4:-}"
worker_digest="${5:-}"
release_commit="${6:-}"

fail() {
  echo "发布镜像拉取失败：$1" >&2
  exit 1
}

[[ -n "$actor" ]] || fail "缺少 GHCR 用户"
[[ "$app_image" == ghcr.io/* ]] || fail "App 镜像必须来自 GHCR"
[[ "$worker_image" == ghcr.io/* ]] || fail "Worker 镜像必须来自 GHCR"
[[ "$app_digest" =~ ^sha256:[0-9a-f]{64}$ ]] || fail "App digest 无效"
[[ "$worker_digest" =~ ^sha256:[0-9a-f]{64}$ ]] || fail "Worker digest 无效"
[[ "$release_commit" =~ ^[0-9a-f]{40}$ ]] || fail "release commit 无效"
command -v docker >/dev/null 2>&1 || fail "未安装 Docker"

app_ref="$app_image@$app_digest"
worker_ref="$worker_image@$worker_digest"
docker_config="$(mktemp -d)"

cleanup() {
  rm -rf "$docker_config"
}
trap cleanup EXIT
export DOCKER_CONFIG="$docker_config"

docker login ghcr.io --username "$actor" --password-stdin
docker pull "$app_ref"
docker pull "$worker_ref"

app_revision="$(docker image inspect \
  --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' \
  "$app_ref")"
worker_revision="$(docker image inspect \
  --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' \
  "$worker_ref")"
[[ "$app_revision" == "$release_commit" ]] \
  || fail "App OCI revision 与 release commit 不一致"
[[ "$worker_revision" == "$release_commit" ]] \
  || fail "Worker OCI revision 与 release commit 不一致"

docker tag "$app_ref" miaomiao-points-app:production
docker tag "$worker_ref" miaomiao-points-worker:production
docker image inspect miaomiao-points-app:production miaomiao-points-worker:production \
  --format 'size={{.Size}} id={{.Id}} revision={{ index .Config.Labels "org.opencontainers.image.revision" }}'
