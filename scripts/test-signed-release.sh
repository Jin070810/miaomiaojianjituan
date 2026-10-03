#!/usr/bin/env bash
set -euo pipefail
test_root="$(mktemp -d)"
trap 'rm -rf -- "$test_root"' EXIT
mkdir "$test_root/bin"
printf '{"commit":"fixture"}\n' > "$test_root/manifest.json"
printf '{"synthetic":true}\n' > "$test_root/bundle.json"
cat > "$test_root/bin/gh" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$@" > "$TEST_GH_ARGS"
[[ "${TEST_CRYPTO_REJECT:-0}" != 1 ]] || exit 1
printf '[{"synthetic":true}]\n'
FAKE
chmod +x "$test_root/bin/gh"
export PATH="$test_root/bin:$PATH" GITHUB_REPOSITORY=Example/system TEST_GH_ARGS="$test_root/args"
sha="$(printf 'a%.0s' {1..40})"
bash scripts/verify-signed-release.sh "$test_root/manifest.json" "$test_root/bundle.json" "$sha" > "$test_root/verified.json"
for arg in attestation verify --bundle --repo Example/system --source-ref refs/heads/main --source-digest \
  "$sha" --signer-digest --signer-workflow Example/system/.github/workflows/ci.yml \
  --cert-identity https://github.com/Example/system/.github/workflows/ci.yml@refs/heads/main \
  --cert-oidc-issuer https://token.actions.githubusercontent.com --deny-self-hosted-runners \
  --predicate-type https://slsa.dev/provenance/v1 --format json; do
  grep -Fxq -- "$arg" "$TEST_GH_ARGS"
done
if grep -Fq -- --custom-trusted-root "$TEST_GH_ARGS"; then exit 1; fi
if TEST_CRYPTO_REJECT=1 bash scripts/verify-signed-release.sh "$test_root/manifest.json" "$test_root/bundle.json" "$sha"; then
  echo 'cryptographic verification failure was ignored' >&2; exit 1
fi
if bash scripts/verify-signed-release.sh "$test_root/manifest.json" "$test_root/missing.json" "$sha"; then
  echo 'unsigned manifest was accepted' >&2; exit 1
fi
if bash scripts/verify-signed-release.sh "$test_root/manifest.json" "$test_root/bundle.json" invalid; then exit 1; fi

# Exercise the actual read-only remote command against an isolated directory,
# including paths with spaces and a missing/linked archive. No ssh server is used.
cat > "$test_root/bin/ssh" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
exec bash -c "${@: -1}"
FAKE
chmod +x "$test_root/bin/ssh"
export PRODUCTION_PATH="$test_root/project with spaces" PRODUCTION_HOST=fixture.invalid PRODUCTION_USER=fixture
archive="$PRODUCTION_PATH/releases/$sha/candidates/123-2"
mkdir -p "$archive"
cp "$test_root/manifest.json" "$archive/release-candidate.json"
cp "$test_root/bundle.json" "$archive/release-candidate.sigstore.json"
bash scripts/fetch-retained-release.sh "$sha" 123 2 "$test_root/downloaded"
cmp "$test_root/manifest.json" "$test_root/downloaded/release-candidate.json"
cmp "$test_root/bundle.json" "$test_root/downloaded/release-candidate.sigstore.json"
rm "$archive/release-candidate.sigstore.json"
if bash scripts/fetch-retained-release.sh "$sha" 123 2 "$test_root/incomplete"; then exit 1; fi
[[ ! -d "$test_root/incomplete" ]]
ln -s "$test_root/bundle.json" "$archive/release-candidate.sigstore.json"
if bash scripts/fetch-retained-release.sh "$sha" 123 2 "$test_root/linked"; then exit 1; fi
if bash scripts/fetch-retained-release.sh "$sha" '../123' 2 "$test_root/invalid"; then exit 1; fi
echo 'Signed archive: exact verifier identities, crypto rejection, missing bundle, read-only retrieval and path boundaries passed.'
