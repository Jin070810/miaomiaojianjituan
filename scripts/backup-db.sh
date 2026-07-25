#!/usr/bin/env bash
set -euo pipefail

output_directory="${1:-backups}"
env_file="${2:-.env.production}"
retention_days="${3:-}"

if [[ ! -f "$env_file" ]]; then
  echo "环境文件不存在：$env_file" >&2
  exit 1
fi

if [[ -z "$retention_days" ]]; then
  retention_days="$(awk -F= '$1 == "LOCAL_BACKUP_RETENTION_DAYS" { sub(/^[^=]*=/, ""); print; exit }' "$env_file")"
  if [[ "$retention_days" == \"*\" || "$retention_days" == \'*\' ]]; then
    retention_days="${retention_days:1:-1}"
  fi
fi
retention_days="${retention_days:-7}"
if [[ ! "$retention_days" =~ ^[0-9]+$ ]] || (( retention_days < 1 || retention_days > 90 )); then
  echo "LOCAL_BACKUP_RETENTION_DAYS 必须是 1 到 90 的整数" >&2
  exit 1
fi

mkdir -p "$output_directory"
stamp="$(date -u +%Y%m%d-%H%M%S)"
target="$output_directory/miaomiao-$stamp.dump"

docker compose --env-file "$env_file" exec -T postgres \
  sh -c 'pg_dump --format=custom --no-owner --no-privileges -U "$POSTGRES_USER" "$POSTGRES_DB"' \
  > "$target"

sha256sum "$target" > "$target.sha256"
sha256sum --check "$target.sha256"

retention_minutes=$((retention_days * 1440))
find "$output_directory" -maxdepth 1 -type f \
  \( -name 'miaomiao-*.dump' -o -name 'miaomiao-*.dump.sha256' \) \
  -mmin "+$retention_minutes" -print -delete

echo "备份完成：$target"
echo "校验文件：$target.sha256"
echo "本地保留：$retention_days 天"
