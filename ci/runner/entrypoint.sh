#!/usr/bin/env bash
# Self-registering entrypoint for the rotli Linux CI runner.
#
# On boot: mint a short-lived registration token from a fine-grained PAT
# (GH_RUNNER_TOKEN), register this container as an EPHEMERAL runner with the
# `rotli` label, run exactly one job, then exit so the container restarts and
# re-registers cleanly. On shutdown: dereigster.
#
# Env (set in Railway):
#   GH_RUNNER_TOKEN   REQUIRED. Fine-grained PAT, repo=SethMed7/rotli only,
#                     permission: Administration read+write (runner registration).
#                     This is the ONLY secret this service needs. No signing keys.
#   GH_OWNER          optional, default SethMed7
#   GH_REPO           optional, default rotli
#   RUNNER_NAME       optional, default rotli-linux-<short-hostname>
#   RUNNER_LABELS     optional, default "rotli" (GitHub adds self-hosted/Linux/X64)
set -euo pipefail

GH_OWNER="${GH_OWNER:-SethMed7}"
GH_REPO="${GH_REPO:-rotli}"
RUNNER_LABELS="${RUNNER_LABELS:-rotli}"
RUNNER_NAME="${RUNNER_NAME:-rotli-linux-$(hostname | cut -c1-8)-$RANDOM}"
API="https://api.github.com/repos/${GH_OWNER}/${GH_REPO}"

if [[ -z "${GH_RUNNER_TOKEN:-}" ]]; then
  echo "FATAL: GH_RUNNER_TOKEN is not set. Provide a fine-grained PAT (repo=${GH_OWNER}/${GH_REPO}, Administration read+write)." >&2
  exit 1
fi

auth_header="Authorization: Bearer ${GH_RUNNER_TOKEN}"
api_version="X-GitHub-Api-Version: 2022-11-28"

mint_token() {
  # $1 = "registration" | "remove"
  curl -fsSL -X POST \
    -H "${auth_header}" \
    -H "Accept: application/vnd.github+json" \
    -H "${api_version}" \
    "${API}/actions/runners/${1}-token" | jq -r .token
}

REG_TOKEN="$(mint_token registration)"
if [[ -z "${REG_TOKEN}" || "${REG_TOKEN}" == "null" ]]; then
  echo "FATAL: could not mint a registration token — check the PAT scope (Administration read+write on ${GH_OWNER}/${GH_REPO})." >&2
  exit 1
fi

cleanup() {
  echo "Deregistering runner ${RUNNER_NAME}..."
  # Ephemeral runners auto-remove after their one job, but on an out-of-band
  # stop (redeploy/scale-down) we dereigster explicitly with a fresh token.
  local rm_token
  rm_token="$(mint_token remove || true)"
  if [[ -n "${rm_token}" && "${rm_token}" != "null" ]]; then
    ./config.sh remove --token "${rm_token}" || true
  fi
}
trap 'cleanup; exit 0' SIGINT SIGTERM

echo "Registering ephemeral runner ${RUNNER_NAME} on ${GH_OWNER}/${GH_REPO} (labels: ${RUNNER_LABELS})..."
./config.sh \
  --url "https://github.com/${GH_OWNER}/${GH_REPO}" \
  --token "${REG_TOKEN}" \
  --name "${RUNNER_NAME}" \
  --labels "${RUNNER_LABELS}" \
  --work _work \
  --ephemeral \
  --unattended \
  --replace

# --ephemeral: the runner accepts ONE job, then exits. Railway restarts the
# container, which re-registers fresh — no stale/half-updated runner state.
# `&` + `wait` so the SIGTERM trap fires promptly on redeploy.
./run.sh &
RUN_PID=$!
wait "${RUN_PID}"
