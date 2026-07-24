#!/usr/bin/env bash
set -euo pipefail

env_file="${1:-.env.production}"
project_dir="${2:-$(pwd)}"

cd "$project_dir"
bash scripts/production-preflight.sh "$env_file" "$project_dir"

# The first release starts with an empty host, so PostgreSQL must exist before
# the mandatory pre-release backup can run. Existing releases reuse the same
# volume and are backed up before migrations or application containers start.
docker compose --env-file "$env_file" up -d postgres redis

set -a
# This file is root/deploy-owned and validated by production-preflight.sh.
# shellcheck disable=SC1090
. "$env_file"
set +a

database_ready=false
for _ in {1..30}; do
  if docker compose --env-file "$env_file" exec -T postgres \
    pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null 2>&1; then
    database_ready=true
    break
  fi
  sleep 2
done
if [[ "$database_ready" != "true" ]]; then
  echo "PostgreSQL 在 60 秒内未就绪，停止发布" >&2
  exit 1
fi

bash scripts/backup-db.sh backups "$env_file"
# Release images are built and verified by GitHub Actions. Production only
# starts the exact images already pulled and tagged by the deployment workflow.
docker compose --env-file "$env_file" up -d --no-build --pull never app worker
docker compose --env-file "$env_file" ps
