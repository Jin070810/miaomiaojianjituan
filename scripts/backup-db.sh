#!/usr/bin/env bash
set -euo pipefail

output_directory="${1:-backups}"
env_file="${2:-.env.production}"

if [[ ! -f "$env_file" ]]; then
  echo "环境文件不存在：$env_file" >&2
  exit 1
fi

mkdir -p "$output_directory"
stamp="$(date -u +%Y%m%d-%H%M%S)"
target="$output_directory/miaomiao-$stamp.dump"

docker compose --env-file "$env_file" exec -T postgres \
  sh -c 'pg_dump --format=custom --no-owner --no-privileges -U "$POSTGRES_USER" "$POSTGRES_DB"' \
  > "$target"

sha256sum "$target" > "$target.sha256"
echo "备份完成：$target"
echo "校验文件：$target.sha256"
