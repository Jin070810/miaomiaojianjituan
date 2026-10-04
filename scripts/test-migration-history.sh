#!/usr/bin/env bash
set -euo pipefail
fixture="$(mktemp -d)"
trap 'rm -rf -- "$fixture"' EXIT
jq -n '{migrations:[{path:"202607230001_init/migration.sql",sha256:("a"*64)}]}' > "$fixture/target.json"
jq -n '[{name:"202607230001_init",checksum:("a"*64)}]' > "$fixture/history.json"
cp scripts/legacy-migration-checksums.json "$fixture/aliases.json"
check() { jq --slurpfile target "$fixture/target.json" --slurpfile aliases "$fixture/aliases.json" -f scripts/migration-history.jq "$fixture/history.json"; }
check | jq -e '.validChecksums and (.missingMigrations|length)==0 and (.historicalVariants|length)==0' >/dev/null
jq '.[0].checksum=("b"*64)' "$fixture/history.json" > "$fixture/next"
mv "$fixture/next" "$fixture/history.json"
check | jq -e '.validChecksums==false and (.mismatchedMigrations|length)==1' >/dev/null
jq -n '{schemaVersion:1,entries:[{migration:"202607230001_init",recordedChecksum:("b"*64),canonicalChecksum:("a"*64),evidenceRun:"123",evidenceCandidate:("c"*40)}]}' > "$fixture/aliases.json"
check | jq -e '.validChecksums and (.historicalVariants|length)==1' >/dev/null
for transform in '.entries[0].migration="different"' '.entries[0].recordedChecksum=("c"*64)' '.entries[0].canonicalChecksum=("c"*64)' '.entries[0].evidenceRun=""' '.entries[0].evidenceCandidate=""'; do
  cp "$fixture/aliases.json" "$fixture/original"
  jq "$transform" "$fixture/original" > "$fixture/aliases.json"
  check | jq -e '.validChecksums==false' >/dev/null
  mv "$fixture/original" "$fixture/aliases.json"
done
jq '.[0].name="later_migration"' "$fixture/history.json" > "$fixture/next"
mv "$fixture/next" "$fixture/history.json"
check | jq -e '.validChecksums and .missingMigrations==["later_migration"] and (.historicalVariants|length)==0' >/dev/null
echo 'Exact historical hash pairs require evidence; unknown or changed migrations still fail.'
