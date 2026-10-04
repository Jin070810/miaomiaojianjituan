#!/usr/bin/env bash
set -euo pipefail
fixture="$(mktemp -d)"
trap 'rm -rf -- "$fixture"' EXIT
mkdir "$fixture/bin" "$fixture/project"
cat > "$fixture/bin/docker" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" == ps ]]; then printf 'a%.0s' {1..64}; printf '\n'
elif [[ "$1" == exec && "$*" == *'df -Pk /var/lib/postgresql/data' ]]; then
  printf 'Filesystem 1024-blocks Used Available Capacity Mounted\nfixture 16000000 0 %s 0%% /data\n' "${CAPACITY_DATABASE_KB:-8000000}"
elif [[ "$1" == exec && "$*" == *'df -Pk /' ]]; then
  printf 'Filesystem 1024-blocks Used Available Capacity Mounted\nfixture 16000000 0 %s 0%% /\n' "${CAPACITY_IMAGE_KB:-8000000}"
elif [[ "$1" == exec && "$*" == *'df -Pi /' ]]; then
  printf 'Filesystem Inodes Used Available Capacity Mounted\nfixture 2000000 0 %s 0%% /\n' "${CAPACITY_INODES:-1000000}"
elif [[ "$1" == exec && "$*" == *'SELECT pg_database_size(current_database())'* ]]; then
  [[ "$*" == *'default_transaction_read_only=on'* && "$*" == *'statement_timeout=5000'* ]]
  printf '%s\n' "${CAPACITY_DATABASE_SIZE:-65000000}"
else echo 'Unexpected mutation or command' >&2; exit 99; fi
FAKE
cat > "$fixture/bin/df" <<'FAKE'
#!/usr/bin/env bash
printf 'Available\n'
if [[ "$*" == *iavail* ]]; then printf '%s\n' "${CAPACITY_INODES:-1000000}"
else printf '%s\n' "${CAPACITY_HOST_BYTES:-8000000000}"; fi
FAKE
chmod +x "$fixture/bin/"*
export PATH="$fixture/bin:$PATH"
bash scripts/release-capacity.sh "$fixture/project" "$fixture/report.json"
jq -e '.ok and .requiredBytes==3221225472' "$fixture/report.json" >/dev/null
for setting in CAPACITY_HOST_BYTES=127000000 CAPACITY_IMAGE_KB=127000 CAPACITY_DATABASE_KB=1000 CAPACITY_INODES=49 CAPACITY_DATABASE_SIZE=3000000000; do
  if env "$setting" bash scripts/release-capacity.sh "$fixture/project" "$fixture/report.json"; then
    echo "Capacity gate accepted: $setting" >&2; exit 1
  fi
  jq -e '.ok==false' "$fixture/report.json" >/dev/null
done
if CAPACITY_DATABASE_SIZE=invalid bash scripts/release-capacity.sh "$fixture/project" "$fixture/report.json"; then exit 1; fi
echo 'Capacity gate rejects exhausted host/image/database storage, inodes, large database budget and invalid metadata.'
