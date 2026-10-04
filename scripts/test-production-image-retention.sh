#!/usr/bin/env bash
set -euo pipefail
fixture="$(mktemp -d)"
trap 'rm -rf -- "$fixture"' EXIT
export RETENTION_FIXTURE="$fixture"
mkdir -p "$fixture/bin" "$fixture/project/backups" "$fixture/payload"
touch "$fixture/project/.production.lock"
printf preserve > "$fixture/project/backups/synthetic.dump"
cp scripts/select-retired-images.jq scripts/image-retention-metadata.jq "$fixture/payload/"
# A historical build environment may supply the version only if there is no
# conflicting label. Unrelated image environment values never enter evidence.
jq -n '[{Id:"fixture",Config:{Env:["APP_COMMIT_SHA="+("a"*40),"PRIVATE=must-not-export"]}}]' |
  jq -f scripts/image-retention-metadata.jq > "$fixture/metadata.json"
jq -e '.revision==("a"*40) and .revisionSource=="build_environment" and (.Config==null)' "$fixture/metadata.json" >/dev/null
for label in invalid bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb; do
  jq -n --arg label "$label" '[{Config:{Labels:{"org.opencontainers.image.revision":$label},Env:["APP_COMMIT_SHA="+("a"*40)]}}]' |
    jq -f scripts/image-retention-metadata.jq | jq -e '.revision==null' >/dev/null
done
printf '{"actor":"fixture","token":"synthetic-only"}\n' > "$fixture/payload/registry.json"
# Three recent version pairs, one retired pair, and a stopped-container pair.
jq -n '[range(1;6) as $v | ["app","worker"][] as $kind |
  ($v|tostring) as $n | (if $kind=="app" then $n else ($v+5|tostring) end) as $i |
  {Id:("sha256:"+($i*64)[:64]),Created:("2020-01-0"+$n+"T00:00:00Z"),Size:100,
   revision:($n*40),RepoTags:[],RepoDigests:["ghcr.io/jin070810/miaomiaojianjituan-"+$kind+"@sha256:"+($i*64)[:64]]}]' > "$fixture/images.json"
cp "$fixture/images.json" "$fixture/original.json"
# The oldest app has a tag; deleting it also removes its digest alias.
jq '.[0].RepoTags=["miaomiao-points-app:old"]' "$fixture/images.json" > "$fixture/next"
mv "$fixture/next" "$fixture/images.json"
jq -n '["sha256:"+("2"*64)]' > "$fixture/used.json"
select_images() { jq --arg cutoff '2026-01-01T00:00:00Z' --slurpfile used "$fixture/used.json" -f scripts/select-retired-images.jq "$1"; }
select_images "$fixture/images.json" > "$fixture/selection.json"
jq -e '(.selected|length)==2 and all(.selected[]; .revision==("1"*40)) and (.retainedVersions|length)==4' "$fixture/selection.json" >/dev/null
# Foreign references, unknown provenance, recent age, production tag, and a
# stopped local-only counterpart must each preserve the entire relevant image.
for transform in \
  '.[0].RepoTags += ["someone-else/image:old"]' \
  '.[0].RepoDigests=[]' \
  '.[0].Created="2026-12-01T00:00:00Z"' \
  '.[0].RepoTags += ["miaomiao-points-app:production"]' \
  '.[0].revision=null'; do
  jq "$transform" "$fixture/images.json" > "$fixture/variant.json"
  select_images "$fixture/variant.json" | jq -e 'all(.selected[]; .id!=("sha256:"+("1"*64)))' >/dev/null
done
jq '.[2].RepoDigests=[]' "$fixture/images.json" > "$fixture/variant.json"
select_images "$fixture/variant.json" | jq -e 'all(.selected[]; .revision!=("2"*40))' >/dev/null
cat > "$fixture/bin/docker" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$RETENTION_FIXTURE/commands"
case "$1 $2" in
  'ps --all')
    [[ "${RETENTION_PS_FAIL:-false}" != true ]] || exit 1
    if [[ "$*" != *'--filter ancestor='* ]]; then printf 'a%.0s' {1..64}; printf '\n'; fi ;;
  'inspect '*) jq -n '[{Id:("a"*64),Image:("sha256:"+("2"*64)),State:{Status:"exited",StartedAt:"2020"}}]' ;;
  'image ls') jq -r '.[].Id' "$RETENTION_FIXTURE/images.json" ;;
  'image inspect')
    ref="${@: -1}"
    if [[ "$*" == *'--format'* ]]; then
      jq -er --arg ref "$ref" '.[]|select(.Id==$ref or (.RepoTags|index($ref))!=null or (.RepoDigests|index($ref))!=null)|.Id' "$RETENTION_FIXTURE/images.json"
    else
      jq --arg ref "$ref" '[.[]|select(.Id==$ref)|.Config.Labels["org.opencontainers.image.revision"]=.revision]' "$RETENTION_FIXTURE/images.json"
    fi ;;
  'image rm')
    [[ "$3" == --no-prune && $# == 4 ]]
    jq --arg ref "$4" '[.[]|select((.RepoTags|index($ref))==null and (.RepoDigests|index($ref))==null)]' "$RETENTION_FIXTURE/images.json" > "$RETENTION_FIXTURE/next"
    mv "$RETENTION_FIXTURE/next" "$RETENTION_FIXTURE/images.json"
    touch "$RETENTION_FIXTURE/removed" ;;
  'volume ls') printf 'keep-volume\n' ;;
  'login ghcr.io') read -r token; [[ "$token" == synthetic-only ]] ;;
  'manifest inspect') [[ "${RETENTION_REMOTE_FAIL:-false}" != true ]]; printf '{"schemaVersion":2,"config":{"digest":"sha256:synthetic"}}\n' ;;
  *) echo "Forbidden operation: $1 $2" >&2; exit 99 ;;
esac
FAKE
cat > "$fixture/bin/curl" <<'FAKE'
#!/usr/bin/env bash
jq -n --argjson ok "${RETENTION_HEALTH:-true}" '{ok:$ok,database:"ok",redis:"ok",worker:"ok",app:{commit:("b"*40)},workerVersion:{commit:("b"*40)}}'
FAKE
cat > "$fixture/bin/git" <<'FAKE'
#!/usr/bin/env bash
[[ "$*" == 'rev-parse HEAD' ]]
printf 'b%.0s' {1..40}; printf '\n'
FAKE
cat > "$fixture/bin/df" <<'FAKE'
#!/usr/bin/env bash
printf 'Avail\n'
if [[ -f "$RETENTION_FIXTURE/removed" ]]; then printf '8000000000\n'; else printf '3100000000\n'; fi
FAKE
chmod +x "$fixture/bin/"*
export PATH="$fixture/bin:$PATH"
run() { bash scripts/production-image-retention.sh "$fixture/project" "$fixture/payload" example.test "$1"; }
run inspect > "$fixture/inspect.json"
[[ ! -f "$fixture/removed" ]]
jq -e '(.recoverableCandidates|length)==2 and .protectedResourcesPreserved' "$fixture/inspect.json" >/dev/null
RETENTION_REMOTE_FAIL=true run inspect > "$fixture/unavailable.json"
jq -e '.unavailableImagesPreserved==2 and (.recoverableCandidates|length)==0' "$fixture/unavailable.json" >/dev/null
if RETENTION_HEALTH=false run clean >/dev/null; then exit 1; fi
if RETENTION_PS_FAIL=true run clean >/dev/null; then exit 1; fi
[[ ! -f "$fixture/removed" ]]
run clean > "$fixture/clean.json"
jq -e '.healthy and .protectedResourcesPreserved and .capacityAtLeast6GiB and (.removedIds|length)==1' "$fixture/clean.json" >/dev/null
if grep -Eq 'synthetic-only|keep-volume' "$fixture/clean.json"; then exit 1; fi
echo 'Image retention preserves referenced/recent/unrecoverable images and stops at sufficient capacity.'
