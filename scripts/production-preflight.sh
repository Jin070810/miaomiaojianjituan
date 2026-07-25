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
alert_email_to="$(env_value ALERT_EMAIL_TO)"
alert_smtp_host="$(env_value ALERT_SMTP_HOST)"
alert_smtp_port="$(env_value ALERT_SMTP_PORT)"
alert_smtp_user="$(env_value ALERT_SMTP_USER)"
alert_smtp_password="$(env_value ALERT_SMTP_PASSWORD)"
alert_smtp_secure="$(env_value ALERT_SMTP_SECURE)"
alerts_deferred="$(env_value ALERTS_DEFERRED)"
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
webhook_configured=false
email_configured=false
[[ -z "$alerts_deferred" || "$alerts_deferred" == "true" || "$alerts_deferred" == "false" ]] \
  || fail "ALERTS_DEFERRED 必须是 true 或 false"
if [[ -n "$alert_webhook_url" ]]; then
  [[ "$alert_webhook_url" =~ ^https:// ]] || fail "ALERT_WEBHOOK_URL 必须是 HTTPS 地址"
  webhook_configured=true
fi
if [[ -n "$alert_email_to" || -n "$alert_smtp_host" || -n "$alert_smtp_user" || -n "$alert_smtp_password" ]]; then
  if [[ -n "$alert_email_to" && -n "$alert_smtp_host" && -n "$alert_smtp_user" && -n "$alert_smtp_password" ]]; then
    [[ -z "$alert_smtp_port" || "$alert_smtp_port" =~ ^[0-9]+$ ]] || fail "ALERT_SMTP_PORT 必须是整数"
    if [[ -n "$alert_smtp_port" ]] && ! (( alert_smtp_port >= 1 && alert_smtp_port <= 65535 )); then
      fail "ALERT_SMTP_PORT 必须在 1 到 65535 之间"
    fi
    [[ -z "$alert_smtp_secure" || "$alert_smtp_secure" == "true" || "$alert_smtp_secure" == "false" ]] \
      || fail "ALERT_SMTP_SECURE 必须是 true 或 false"
    email_configured=true
  elif [[ "$alerts_deferred" != "true" ]]; then
    fail "SMTP 邮件告警配置不完整"
  fi
fi
if [[ "$webhook_configured" != "true" && "$email_configured" != "true" ]]; then
  [[ "$alerts_deferred" == "true" ]] || fail "必须配置告警通道，或明确设置 ALERTS_DEFERRED=true"
  echo "警告：告警通道已明确延期，周挑战必须保持关闭。" >&2
fi

[[ -s "$project_dir/certs/fullchain.pem" ]] || fail "缺少 certs/fullchain.pem"
[[ -s "$project_dir/certs/privkey.pem" ]] || fail "缺少 certs/privkey.pem"
openssl x509 -in "$project_dir/certs/fullchain.pem" -checkend 604800 -noout >/dev/null \
  || fail "HTTPS 证书将在 7 天内过期或无效"

docker compose --env-file "$env_file" --profile production config --quiet
echo "生产前置检查通过：Docker、密钥、数据库、DeepSeek、告警和 HTTPS 证书均符合要求。"
