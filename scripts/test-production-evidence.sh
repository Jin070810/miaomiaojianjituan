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
    [[ "${2:-}" == inspect ]]
    jq -n '[{Size:123,RepoDigests:[("ghcr.io/jin070810/miaomiaojianjituan-app@sha256:"+("a"*64))],Config:{Env:["IMAGE_SECRET=must-not-be-exported"]}}]' ;;
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
chmod +x "$test_root/bin/"*
export PATH="$test_root/bin:$PATH"
bash scripts/production-evidence.sh "$EVIDENCE_PROJECT" example.test > "$test_root/report.json"
jq -e '.schemaVersion == 1 and .sharedLock == false and .latestBackup.checksumVerified and (.containers|length)==5 and .database.estimatedRows.User == 10' "$test_root/report.json" >/dev/null
if grep -Eq 'must-not-be-exported|private-command|Config|Env|Cmd' "$test_root/report.json"; then echo 'Private data escaped' >&2; exit 1; fi
touch "$EVIDENCE_PROJECT/.production.lock"
bash scripts/production-evidence.sh "$EVIDENCE_PROJECT" example.test | jq -e '.sharedLock == true' >/dev/null
printf 'corrupt' >> "$EVIDENCE_PROJECT/backups/miaomiao-20261004-020000.dump"
if bash scripts/production-evidence.sh "$EVIDENCE_PROJECT" example.test > "$test_root/corrupt-report.json"; then echo 'Corrupt backup accepted' >&2; exit 1; fi
[[ ! -s "$test_root/corrupt-report.json" ]]
echo 'Read-only metadata, private-data exclusion, lock and backup corruption tests passed.'
