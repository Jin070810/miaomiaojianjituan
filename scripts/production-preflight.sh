#!/usr/bin/env bash
set -euo pipefail

env_file="${1:-.env.production}"
project_dir="${2:-$(pwd)}"

fail() {
  echo "生产前置检查失败：$1" >&2
  exit 1
}

[[ -f "$env_file" ]] || fail "缺少环境文件 $env_file"
[[ -d "$project_dir" ]] || fail "项目目录不存在 $project_dir"
[[ "$(stat -c '%a' "$env_file")" == "600" ]] || fail "$env_file 权限必须为 600"
command -v docker >/dev/null 2>&1 || fail "未安装 Docker"
docker compose version >/dev/null 2>&1 || fail "未安装 Docker Compose 插件"
command -v openssl >/dev/null 2>&1 || fail "未安装 openssl"

env_value() {
  local value
  value="$(awk -F= -v key="$1" '$1 == key { sub(/^[^=]*=/, ""); print; exit }' "$env_file")"
  if [[ "$value" == \"*\" || "$value" == \'*\' ]]; then
    value="${value:1:-1}"
  fi
  printf '%s\n' "$value"
}

session_secret="$(env_value SESSION_SECRET)"
phone_key="$(env_value PHONE_ENCRYPTION_KEY)"
database_url="$(env_value DOCKER_DATABASE_URL)"
deepseek_base_url="$(env_value DEEPSEEK_BASE_URL)"
deepseek_api_key="$(env_value DEEPSEEK_API_KEY)"
deepseek_model="$(env_value DEEPSEEK_MODEL)"
alert_webhook_url="$(env_value ALERT_WEBHOOK_URL)"
if [[ -z "$database_url" ]]; then
  database_url="$(env_value DATABASE_URL)"
fi

[[ "${#session_secret}" -ge 32 ]] || fail "SESSION_SECRET 少于 32 个字符"
[[ "$phone_key" =~ ^[0-9a-fA-F]{64}$ ]] || fail "PHONE_ENCRYPTION_KEY 必须是 64 位十六进制字符串"
[[ -n "$database_url" ]] || fail "缺少 DATABASE_URL 或 DOCKER_DATABASE_URL"
[[ "$database_url" != *"postgres:postgres@"* ]] || fail "数据库仍在使用默认密码"
[[ "$database_url" != *"replace-with"* ]] || fail "数据库连接仍包含示例占位值"
[[ "$deepseek_base_url" =~ ^https:// ]] || fail "DEEPSEEK_BASE_URL 必须是 HTTPS 地址"
[[ -n "$deepseek_api_key" && "$deepseek_api_key" != *"replace-with"* ]] || fail "缺少有效的 DEEPSEEK_API_KEY"
[[ -n "$deepseek_model" ]] || fail "缺少 DEEPSEEK_MODEL"
[[ "$alert_webhook_url" =~ ^https:// ]] || fail "ALERT_WEBHOOK_URL 必须是 HTTPS 地址"

[[ -s "$project_dir/certs/fullchain.pem" ]] || fail "缺少 certs/fullchain.pem"
[[ -s "$project_dir/certs/privkey.pem" ]] || fail "缺少 certs/privkey.pem"
openssl x509 -in "$project_dir/certs/fullchain.pem" -checkend 604800 -noout >/dev/null \
  || fail "HTTPS 证书将在 7 天内过期或无效"

docker compose --env-file "$env_file" --profile production config --quiet
echo "生产前置检查通过：Docker、密钥、数据库、DeepSeek、告警和 HTTPS 证书均符合要求。"
