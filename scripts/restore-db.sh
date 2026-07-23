#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "用法：bash scripts/restore-db.sh <备份文件> [环境文件]" >&2
  exit 1
fi

backup_file="$1"
env_file="${2:-.env.production}"

if [[ ! -f "$backup_file" ]]; then
  echo "备份文件不存在：$backup_file" >&2
  exit 1
fi
if [[ ! -f "$backup_file.sha256" ]]; then
  echo "缺少 SHA-256 校验文件：$backup_file.sha256" >&2
  exit 1
fi
if [[ ! -f "$env_file" ]]; then
  echo "环境文件不存在：$env_file" >&2
  exit 1
fi

sha256sum --check "$backup_file.sha256"
docker compose --env-file "$env_file" stop app worker
docker compose --env-file "$env_file" exec -T postgres \
  sh -c 'pg_restore --clean --if-exists --no-owner --no-privileges -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  < "$backup_file"

echo "恢复完成：$backup_file"
echo "请在确认数据后重新启动 app 和 worker。"
