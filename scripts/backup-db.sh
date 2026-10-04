#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/production-lock.sh
source "$script_dir/production-lock.sh"
production_lock "$(pwd)"
umask 077

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
for _ in {1..3}; do
  stamp="$(date -u +%Y%m%d-%H%M%S)"
  target="$output_directory/miaomiao-$stamp.dump"
  [[ -e "$target" || -e "$target.sha256" ]] || break
  sleep 1
done
[[ ! -e "$target" && ! -e "$target.sha256" ]] || { echo '备份文件已存在，拒绝覆盖。' >&2; exit 1; }
partial="$target.incomplete"
cleanup() { rm -f -- "$partial"; }
trap cleanup EXIT
trap 'exit 143' TERM HUP

# Values expand inside the postgres container.
# shellcheck disable=SC2016
timeout --kill-after=10s 480s docker compose --env-file "$env_file" exec -T \
  -e 'PGOPTIONS=-c statement_timeout=420000 -c lock_timeout=15000' postgres \
  sh -c 'pg_dump --format=custom --no-owner --no-privileges -U "$POSTGRES_USER" "$POSTGRES_DB"' \
  > "$partial"
[[ -s "$partial" ]]
timeout --kill-after=5s 45s docker compose --env-file "$env_file" exec -T postgres \
  pg_restore --list < "$partial" > /dev/null
mv "$partial" "$target"

sha256sum "$target" > "$target.sha256"
sha256sum --check "$target.sha256"
if [[ -n "${BACKUP_RESULT_FILE:-}" ]]; then
  jq -n --arg file "$target" --arg hash "$(sha256sum "$target" | cut -d' ' -f1)" \
    --arg at "$(date -u +%FT%TZ)" '{file:$file,sha256:$hash,verifiedAt:$at}' > "$BACKUP_RESULT_FILE"
fi

retention_minutes=$((retention_days * 1440))
find "$output_directory" -maxdepth 1 -type f \
  \( -name 'miaomiao-*.dump' -o -name 'miaomiao-*.dump.sha256' \) \
  -mmin "+$retention_minutes" -print -delete

echo "备份完成：$target"
echo "校验文件：$target.sha256"
echo "本地保留：$retention_days 天"
