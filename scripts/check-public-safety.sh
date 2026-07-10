#!/usr/bin/env bash
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

# Keep deployment-only brands out without embedding their complete spelling in
# this public repository. Add future private terms using the same split form.
forbidden=("frag""flix" "bai""cloud")
pattern=$(IFS='|'; printf '%s' "${forbidden[*]}")

if git grep -nIiE "$pattern" -- . ':(exclude)scripts/check-public-safety.sh'; then
  echo "Public-source safety check failed: deployment-only branding found." >&2
  exit 1
fi

echo "Public-source safety check passed."
