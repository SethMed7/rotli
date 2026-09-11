#!/usr/bin/env bash
# Scan additions on a PR/push without waiving the separate full-history gate.
set -euo pipefail
base="${1:-}"
head_sha="${2:-}"
[[ "$base" =~ ^[0-9a-f]{40}$ && "$head_sha" =~ ^[0-9a-f]{40}$ ]] || {
  echo "Usage: scan-changed-secrets.sh <base-sha> <head-sha>"; exit 1;
}
[ "$(gitleaks version)" = "8.30.1" ] || { echo "Gitleaks 8.30.1 is required"; exit 1; }
git cat-file -e "$head_sha^{commit}"
if [ "$base" = "0000000000000000000000000000000000000000" ]; then
  # A first push or a manual dispatch carries no base. Scan what this line of
  # work adds over origin/main instead of the whole history, which the separate
  # full-history gate already owns and which carries known historical findings.
  if merge_base="$(git merge-base origin/main "$head_sha" 2>/dev/null)" && [ -n "$merge_base" ]; then
    range="$merge_base..$head_sha"
  else
    range="$head_sha"
  fi
else
  git cat-file -e "$base^{commit}"
  range="$base..$head_sha"
fi
# Never print matched values or upload scan reports/artifacts.
gitleaks git --log-opts="$range" --redact=100 --no-banner --log-level=error .
