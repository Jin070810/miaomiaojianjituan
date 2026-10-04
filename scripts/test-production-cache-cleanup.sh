#!/usr/bin/env bash
set -euo pipefail
fixture="$(mktemp -d)"
trap 'rm -rf -- "$fixture"' EXIT
export CACHE_FIXTURE="$fixture"
mkdir -p "$fixture/bin" "$fixture/project/backups"
printf 'preserve' > "$fixture/project/backups/miaomiao-fixture.dump"
cat > "$fixture/bin/docker" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$CACHE_FIXTURE/commands"
case "${1:-}" in
  buildx)
    case "${2:-}" in
      inspect) printf 'Driver: %s\n' "${CACHE_DRIVER:-docker}" ;;
      du)
        [[ "$*" == *'--filter private="" --format=json'* ]]
        printf '{"ID":"oldprivatecache1","Reclaimable":true,"Shared":false,"Type":"regular","Size":"5GB","Description":"private-source"}\n'
        printf '{"ID":"sharedcache0001","Reclaimable":true,"Shared":true,"Type":"regular"}\n'
        printf '{"ID":"activecache0001","Reclaimable":false,"Shared":false,"Type":"regular"}\n'
        ;;
      prune)
        [[ "$*" == 'buildx prune --builder default --force --filter id~=^(oldprivatecache1)$ --filter until=168h --filter private=""' ]]
        touch "$CACHE_FIXTURE/pruned"
        ;;
      *) exit 99 ;;
    esac ;;
  ps) printf 'a%.0s' {1..64}; printf '\n' ;;
  inspect) jq -n '[{Id:("a"*64),Image:"sha256:preserve",State:{Running:true,OOMKilled:false,StartedAt:"2026-09-29"},Config:{Env:["PRIVATE=never-output"]}}]' ;;
  image)
    [[ "$*" == 'image ls --all --quiet --no-trunc' ]]
    printf 'sha256:current\nsha256:rollback\n'
    if [[ "${CACHE_CHANGED_IMAGE:-false}" == true && -f "$CACHE_FIXTURE/pruned" ]]; then printf 'sha256:changed\n'; fi ;;
  volume) [[ "$*" == 'volume ls --quiet' ]]; printf 'production-database\nproduction-redis\n' ;;
  *) echo 'Forbidden operation' >&2; exit 99 ;;
esac
FAKE
cat > "$fixture/bin/curl" <<'FAKE'
#!/usr/bin/env bash
jq -n --argjson ok "${CACHE_HEALTH:-true}" '{ok:$ok,database:"ok",redis:"ok",worker:"ok",app:{commit:("b"*40)},workerVersion:{commit:("b"*40)}}'
FAKE
cat > "$fixture/bin/git" <<'FAKE'
#!/usr/bin/env bash
[[ "$*" == 'rev-parse HEAD' ]]
printf 'b%.0s' {1..40}; printf '\n'
FAKE
cat > "$fixture/bin/df" <<'FAKE'
#!/usr/bin/env bash
printf 'Avail\n'
if [[ -f "$CACHE_FIXTURE/pruned" ]]; then printf '8000000000\n'; else printf '127000000\n'; fi
FAKE
chmod +x "$fixture/bin/"*
export PATH="$fixture/bin:$PATH"
bash scripts/production-cache-cleanup.sh "$fixture/project" example.test inspect > "$fixture/inspect.json"
[[ ! -f "$fixture/pruned" ]]
bash scripts/production-cache-cleanup.sh "$fixture/project" example.test clean > "$fixture/clean.json"
jq -e '.healthy and .containersImagesVolumesBackupsPreserved and .capacityAtLeast3GiB and (.selectedCache|length)==1' "$fixture/clean.json" >/dev/null
if grep -Eq 'private-source|PRIVATE|production-database' "$fixture/clean.json"; then exit 1; fi
rm "$fixture/pruned"
if CACHE_HEALTH=false bash scripts/production-cache-cleanup.sh "$fixture/project" example.test clean > /dev/null; then exit 1; fi
[[ ! -f "$fixture/pruned" ]]
if CACHE_DRIVER=docker-container bash scripts/production-cache-cleanup.sh "$fixture/project" example.test clean > /dev/null; then exit 1; fi
[[ ! -f "$fixture/pruned" ]]
if CACHE_CHANGED_IMAGE=true bash scripts/production-cache-cleanup.sh "$fixture/project" example.test clean > "$fixture/changed.json"; then exit 1; fi
jq -e '.containersImagesVolumesBackupsPreserved==false' "$fixture/changed.json" >/dev/null
echo 'Cache cleanup scopes exact old private IDs, refuses unhealthy/foreign builder and verifies protected resources.'
