#!/usr/bin/env bash
set -euo pipefail
manifest="${1:?missing manifest}"
bundle="${2:?missing Sigstore bundle}"
commit="${3:?missing release SHA}"
repository="${GITHUB_REPOSITORY:?missing repository}"
[[ "$commit" =~ ^[a-f0-9]{40}$ ]]
[[ "$repository" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]]
[[ -f "$manifest" && -f "$bundle" ]]
[[ "$(stat -c '%s' "$manifest")" -le 2097152 && "$(stat -c '%s' "$bundle")" -le 10485760 ]]
# Identity restrictions are checked against the signed OIDC certificate. Never
# accept a trusted root from the downloaded archive, or trust predicate fields
# alone to establish which repository/ref/workflow produced these exact bytes.
GH_HOST=github.com timeout --signal=TERM --kill-after=10s 180s \
  gh attestation verify "$manifest" --bundle "$bundle" --repo "$repository" \
    --source-ref refs/heads/main --source-digest "$commit" --signer-digest "$commit" \
    --signer-workflow "$repository/.github/workflows/ci.yml" \
    --cert-identity "https://github.com/$repository/.github/workflows/ci.yml@refs/heads/main" \
    --cert-oidc-issuer https://token.actions.githubusercontent.com \
    --deny-self-hosted-runners --predicate-type https://slsa.dev/provenance/v1 --format json
