#!/usr/bin/env bash
set -euo pipefail
fixture="$(mktemp -d)"
trap 'rm -rf -- "$fixture"' EXIT
export COPY_GATE_FIXTURE="$fixture"
mkdir -p "$fixture/project/prisma/migrations/baseline" "$fixture/bin" "$fixture/payload"
printf 'schema fixture\n' > "$fixture/project/prisma/schema.prisma"
printf 'SELECT 1;\n' > "$fixture/project/prisma/migrations/baseline/migration.sql"
cp -R "$fixture/project/prisma" "$fixture/payload/"
touch "$fixture/project/.production.lock"
git -C "$fixture/project" init -q
git -C "$fixture/project" -c core.autocrlf=false add prisma
git -C "$fixture/project" -c user.name=Fixture -c user.email=fixture@example.invalid commit -qm baseline
export COPY_GATE_SHA
COPY_GATE_SHA="$(git -C "$fixture/project" rev-parse HEAD)"
cat > "$fixture/bin/curl" <<'FAKE'
#!/usr/bin/env bash
jq -n --arg sha "$COPY_GATE_SHA" '{ok:true,database:"ok",redis:"ok",worker:"ok",app:{commit:$sha},workerVersion:{commit:$sha}}'
FAKE
cat > "$fixture/bin/docker" <<'FAKE'
#!/usr/bin/env bash
# Deliberately fail if a schema difference reaches the full rehearsal. This
# checks that changed migrations cannot be silently treated as an unchanged UI.
touch "$COPY_GATE_FIXTURE/rehearsal-reached"
exit 42
FAKE
chmod +x "$fixture/bin/"*
export PATH="$fixture/bin:$PATH"
run() { bash scripts/production-copy-rehearsal.sh "$fixture/project" "$fixture/payload" example.test "$COPY_GATE_SHA" 123-1 "${1:-if-changed}"; }
run > "$fixture/result.json"
jq -e '.qualified and .rehearsalPerformed==false and .reason=="unchanged_schema_and_migrations"' "$fixture/result.json" >/dev/null
[[ ! -f "$fixture/rehearsal-reached" ]]
if run always >/dev/null 2>&1; then exit 1; fi
[[ -f "$fixture/rehearsal-reached" ]]
rm "$fixture/rehearsal-reached"
printf 'SELECT 2;\n' >> "$fixture/payload/prisma/migrations/baseline/migration.sql"
if run >/dev/null 2>&1; then exit 1; fi
[[ -f "$fixture/rehearsal-reached" ]]
rm "$fixture/rehearsal-reached"
cp "$fixture/project/prisma/migrations/baseline/migration.sql" "$fixture/payload/prisma/migrations/baseline/migration.sql"
printf 'changed schema\n' >> "$fixture/payload/prisma/schema.prisma"
if run >/dev/null 2>&1; then exit 1; fi
[[ -f "$fixture/rehearsal-reached" ]]
rm "$fixture/rehearsal-reached"
cp "$fixture/project/prisma/schema.prisma" "$fixture/payload/prisma/schema.prisma"
printf 'local dirty schema\n' >> "$fixture/project/prisma/schema.prisma"
if run >/dev/null 2>&1; then exit 1; fi
[[ ! -f "$fixture/rehearsal-reached" ]]
echo 'Automatic copy gate skips only unchanged committed schemas; changed or dirty schemas cannot bypass it.'
