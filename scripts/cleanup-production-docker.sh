#!/usr/bin/env bash
# Keep production Docker storage bounded without touching volumes, backups, or
# images used by running containers. Intended to run on the production host.
set -euo pipefail

retention_hours=168
minimum_free_gb=""

usage() {
  cat <<'USAGE'
Usage: cleanup-production-docker.sh [--retention-hours HOURS] [--ensure-free-gb GB]

Removes every unused historical miaomiao application/worker image and BuildKit
cache older than the retention period. The current production image, the
rollback image, and every image used by a running container are preserved.
Docker volumes are never pruned.

When --ensure-free-gb is specified and the threshold is not met, all unused
BuildKit cache is removed as an emergency measure before checking again.
USAGE
}

is_positive_integer() {
  [[ "$1" =~ ^[1-9][0-9]*$ ]]
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --retention-hours)
      [[ $# -ge 2 ]] || { usage >&2; exit 2; }
      retention_hours="$2"
      shift 2
      ;;
    --ensure-free-gb)
      [[ $# -ge 2 ]] || { usage >&2; exit 2; }
      minimum_free_gb="$2"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

is_positive_integer "$retention_hours" || { echo "--retention-hours must be a positive integer" >&2; exit 2; }
if [[ -n "$minimum_free_gb" ]]; then
  is_positive_integer "$minimum_free_gb" || { echo "--ensure-free-gb must be a positive integer" >&2; exit 2; }
fi

available_kb() {
  df -Pk / | awk 'NR == 2 { print $4 }'
}

minimum_free_kb=0
if [[ -n "$minimum_free_gb" ]]; then
  minimum_free_kb=$((minimum_free_gb * 1024 * 1024))
fi

aggressive_cache_cleanup=false
if [[ "$minimum_free_kb" -gt 0 ]] && [[ "$(available_kb)" -lt "$minimum_free_kb" ]]; then
  aggressive_cache_cleanup=true
  echo "Available disk space is below ${minimum_free_gb}GB; using emergency cache cleanup."
fi

echo "Docker storage before cleanup:"
docker system df || true

declare -A protected_images=()

protect_tag() {
  local image_id
  image_id="$(docker image inspect --format '{{.Id}}' "$1" 2>/dev/null || true)"
  if [[ -n "$image_id" ]]; then
    protected_images["$image_id"]=1
  fi
}

# The production and rollback tags are deliberately retained even when old.
protect_tag "miaomiao-points-app:production"
protect_tag "miaomiao-points-worker:production"
protect_tag "miaomiao-points-app:rollback"
protect_tag "miaomiao-points-worker:rollback"

while IFS= read -r image_id; do
  [[ -n "$image_id" ]] && protected_images["$image_id"]=1
done < <(docker ps -q | xargs -r docker inspect --format '{{.Image}}' | sort -u)

while IFS= read -r image_id; do
  [[ -n "$image_id" ]] || continue
  if [[ -n "${protected_images[$image_id]:-}" ]]; then
    echo "Keeping protected image ${image_id:0:19}."
    continue
  fi

  echo "Removing unused historical image ${image_id:0:19}."
  docker image rm "$image_id" || echo "Could not remove ${image_id:0:19}; it remains in use."
done < <(
  docker image ls --no-trunc --format '{{.Repository}} {{.ID}}' \
    | awk '$1 == "miaomiao-points-app" || $1 == "miaomiao-points-worker" { print $2 }' \
    | sort -u
)

# Dangling layers cannot be a tagged production or rollback image. Do not use
# `docker image prune -a` or any volume pruning here.
docker image prune -f

if [[ "$aggressive_cache_cleanup" == true ]]; then
  docker builder prune -af
else
  docker builder prune -af --filter "until=${retention_hours}h"
fi

echo "Docker storage after cleanup:"
docker system df || true

if [[ "$minimum_free_kb" -gt 0 ]] && [[ "$(available_kb)" -lt "$minimum_free_kb" ]]; then
  available_gb=$(( $(available_kb) / 1024 / 1024 ))
  echo "Only ${available_gb}GB remains after cleanup; ${minimum_free_gb}GB is required before building." >&2
  exit 1
fi
