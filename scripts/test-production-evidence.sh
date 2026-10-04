#!/usr/bin/env bash
set -euo pipefail
test_root="$(mktemp -d)"
trap 'rm -rf -- "$test_root"' EXIT
export EVIDENCE_PROJECT="$test_root/project" EVIDENCE_LOG="$test_root/commands.log"
mkdir -p "$EVIDENCE_PROJECT/backups" "$test_root/bin"
printf 'private-backup-must-not-be-exported' > "$EVIDENCE_PROJECT/backups/miaomiao-20261004-020000.dump"
sha256sum "$EVIDENCE_PROJECT/backups/miaomiao-20261004-020000.dump" > "$EVIDENCE_PROJECT/backups/miaomiao-20261004-020000.dump.sha256"
cat > "$test_root/bin/docker" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$EVIDENCE_LOG"
case "${1:-}" in
  ps) printf 'aaaaaaaaaaaa\n' ;;
  inspect)
    jq -n '[{Image:("sha256:"+("a"*64)),Config:{Env:["SECRET=must-not-be-exported"],Cmd:["private-command"],Labels:{"org.opencontainers.image.revision":("b"*40)}},State:{Status:"running",Health:{Status:"healthy"},OOMKilled:false,StartedAt:"2026-10-04T00:00:00Z"},HostConfig:{Memory:0}}]' ;;
  image)
    if [[ "${2:-}" == ls ]]; then
      printf '{"Repository":"other/private-project","ID":"must-not-be-exported"}\n'
      printf '{"Repository":"miaomiao-points-app","ID":"sha256:fixture","Tag":"production","Size":"1GB"}\n'
      exit 0
    fi
    [[ "${2:-}" == inspect ]]
    jq -n '[{Size:123,RepoDigests:[("ghcr.io/jin070810/miaomiaojianjituan-app@sha256:"+("a"*64))],Config:{Env:["IMAGE_SECRET=must-not-be-exported"]}}]' ;;
  system)
    [[ "${2:-}" == df ]]
    printf '{"Type":"Build Cache","Reclaimable":"10GB","Secret":"must-not-be-exported"}\n' ;;
  buildx)
    [[ "${2:-}" == du ]]
    printf '{"ID":"cache-fixture","Size":1000,"Reclaimable":true,"Shared":false,"Description":"must-not-be-exported"}\n' ;;
  version) printf '{"Version":"29.0.0","Private":"must-not-be-exported"}\n' ;;
  info) printf '{"Driver":"overlayfs","DockerRootDir":"/var/lib/docker","Private":"must-not-be-exported"}\n' ;;
  exec)
    [[ "$*" == *'default_transaction_read_only=on'* && "$*" == *'statement_timeout=5000'* && "$*" == *'lock_timeout=500'* ]]
    sql="$(cat)"
    [[ "$sql" == *'BEGIN TRANSACTION READ ONLY;'* && "$sql" == *'ROLLBACK;'* ]]
    if grep -Eiq '(^|[[:space:]])(UPDATE|DELETE|INSERT|ALTER|CREATE|DROP|TRUNCATE)[[:space:]]' <<<"$sql"; then exit 98; fi
    printf '{"sizeBytes":1234,"estimatedRows":{"User":10},"migrations":[],"videoRecentStatusCounts":{"APPROVED":2}}\n' ;;
  *) echo 'Unexpected potentially mutating Docker command' >&2; exit 99 ;;
esac
FAKE
cat > "$test_root/bin/curl" <<'FAKE'
#!/usr/bin/env bash
printf '{"ok":true,"database":"ok","redis":"ok","worker":"ok","app":{"commit":"fixture"},"workerVersion":{"commit":"fixture"},"extraSecret":"must-not-be-exported"}\n'
FAKE
cat > "$test_root/bin/git" <<'FAKE'
#!/usr/bin/env bash
[[ "$*" == 'rev-parse HEAD' ]]
printf 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n'
FAKE
cat > "$test_root/bin/du" <<'FAKE'
#!/usr/bin/env bash
printf '1234\t%s\n' "${@: -1}"
FAKE
chmod +x "$test_root/bin/"*
export PATH="$test_root/bin:$PATH"
bash scripts/production-evidence.sh "$EVIDENCE_PROJECT" example.test > "$test_root/report.json"
jq -e '.schemaVersion == 1 and .sharedLock == false and .latestBackup.checksumVerified and (.containers|length)==5 and .database.estimatedRows.User == 10' "$test_root/report.json" >/dev/null
jq -e '.capacity.buildCache.available and .capacity.buildCache.entries[0].ID == "cache-fixture" and (.capacity.projectImages|length)==1 and .capacity.dockerSpace[0].Reclaimable == "10GB"' "$test_root/report.json" >/dev/null
mkdir -p "$EVIDENCE_PROJECT/releases/attempts/123-1"
printf '{"id":"123-1","status":"failed","phase":"drain","migrationsStarted":false,"private":"must-not-be-exported"}\n' > "$EVIDENCE_PROJECT/releases/active.json"
printf '{"service":"app","state":{"Status":"exited","ExitCode":137,"OOMKilled":false,"secret":"must-not-be-exported"},"Config":{"Env":["must-not-be-exported"]}}\n' > "$EVIDENCE_PROJECT/releases/attempts/123-1/drain-app.json"
printf '{"Config":{"Env":["must-not-be-exported"]}}\n' > "$EVIDENCE_PROJECT/releases/attempts/123-1/previous-app.json"
bash scripts/production-evidence.sh "$EVIDENCE_PROJECT" example.test > "$test_root/report.json"
jq -e '.latestRelease.available and (.latestRelease.migrationsStarted|not) and .latestRelease.snapshots[0].state.ExitCode==137 and (.containers[0].manualSignalHandler|not)' "$test_root/report.json" >/dev/null
if grep -Eq 'must-not-be-exported|private-command|Config|Env|Cmd' "$test_root/report.json"; then echo 'Private data escaped' >&2; exit 1; fi
touch "$EVIDENCE_PROJECT/.production.lock"
bash scripts/production-evidence.sh "$EVIDENCE_PROJECT" example.test | jq -e '.sharedLock == true' >/dev/null
mv "$EVIDENCE_PROJECT/releases/attempts/123-1/drain-app.json" "$test_root/linked-snapshot.json"
ln -s "$test_root/linked-snapshot.json" "$EVIDENCE_PROJECT/releases/attempts/123-1/drain-app.json"
if bash scripts/production-evidence.sh "$EVIDENCE_PROJECT" example.test > "$test_root/linked-report.json"; then echo 'Linked release evidence accepted' >&2; exit 1; fi
[[ ! -s "$test_root/linked-report.json" ]]
rm "$EVIDENCE_PROJECT/releases/attempts/123-1/drain-app.json"
printf 'corrupt' >> "$EVIDENCE_PROJECT/backups/miaomiao-20261004-020000.dump"
if bash scripts/production-evidence.sh "$EVIDENCE_PROJECT" example.test > "$test_root/corrupt-report.json"; then echo 'Corrupt backup accepted' >&2; exit 1; fi
[[ ! -s "$test_root/corrupt-report.json" ]]
echo 'Read-only metadata, private-data exclusion, lock and backup corruption tests passed.'
