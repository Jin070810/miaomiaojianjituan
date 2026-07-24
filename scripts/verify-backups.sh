#!/usr/bin/env bash
set -euo pipefail

backup_directory="${1:-backups}"
shopt -s nullglob
files=("$backup_directory"/miaomiao-*.dump)
if [[ ${#files[@]} -eq 0 ]]; then
  echo "未找到数据库备份：$backup_directory" >&2
  exit 1
fi

for file in "${files[@]}"; do
  checksum="$file.sha256"
  [[ -f "$checksum" ]] || { echo "缺少校验文件：$checksum" >&2; exit 1; }
  sha256sum --check "$checksum"
  if command -v pg_restore >/dev/null 2>&1; then
    pg_restore --list "$file" >/dev/null
  fi
done
echo "已验证 ${#files[@]} 个备份文件"
