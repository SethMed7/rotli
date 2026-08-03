# The self-hosted CI runners

The Regression suite (`.github/workflows/regression.yml`) is a **split gate**:

| Where | Runner label | Jobs |
| --- | --- | --- |
| **Linux** (Railway) | `[self-hosted, linux, X64, rotli]` | `static-contracts` (`bun run lint`), `design-system`, `e2e` (Playwright chromium), `bun-regression` (`bun run test:regression` + `bun run build`), `dependency-audit` |
| **macOS** (spare Mac) | `[self-hosted, macOS, ARM64, rotli]` | `cargo-macos` — `cargo clippy` + `cargo test` only |

**Why split.** Everything bun/node/vite/playwright is OS-agnostic, so it runs on
a cheap **Linux** runner hosted on Railway — off Seth's Mac. That matters twice:
it costs zero GitHub minutes, and because rotli is going cross-platform while
Seth only owns a Mac, Linux CI is how non-Mac behavior gets validated. Only the
Rust needs macOS: ~37 `#[cfg(target_os = "macos")]` gates mean a Linux `cargo
build` compiles a *different* binary, so `cargo clippy` + `cargo test` stay on a
real Mac (do **not** run cargo on Linux). `bun run build` is Vite (JS), so it is
Linux-fine; the native Tauri build lives in `release.sh`, never in CI. Signing
and notarization stay out of CI entirely — `release.sh` does them locally — so
**no runner ever needs a signing key**.

**Runner status.** The Linux runner (below) is what Seth deploys now; it carries
the whole OS-agnostic gate. The macOS `cargo-macos` job simply **queues** until a
Mac runner is registered — that is harmless and non-blocking, because
`release.sh` treats a missing/pending Regression run as a warn, not a block (see
"How releases use it"). Register a Mac runner when you want the Rust gate live
(the macOS section is kept below), or leave it queuing until the Rust is
cross-platform and the whole suite can move to Linux.

**Simpler alternative (if GitHub Actions billing is ever enabled).** The Linux
`runs-on` is a plain label array. Replace every `[self-hosted, linux, X64,
rotli]` in `regression.yml` with `ubuntu-latest` (one find/replace) and delete
the Railway service — GitHub's Linux tier is the cheap one, and `playwright
install --with-deps chromium` already provisions the apt deps. The macOS job
stays self-hosted regardless (Tauri needs a real Mac).

---

## The Linux runner on Railway

A self-registering GitHub Actions Linux runner, deployed as a long-lived Railway
service from this repo (`ci/runner/`). It runs ONLY the OS-agnostic lanes and
holds NO signing keys.

### What's in the repo

- `ci/runner/Dockerfile` — a lean Debian-based image (GitHub's official
  `actions-runner` base) with bun (pinned 1.3.3), Node LTS, Playwright/chromium
  apt libs, `jq`, and `git`. **No rustup/cargo** (Linux never compiles Tauri).
- `ci/runner/entrypoint.sh` — on boot it mints a short-lived **registration
  token** from a fine-grained PAT (`GH_RUNNER_TOKEN`), registers the container as
  an **ephemeral** runner labelled `rotli`, runs one job, then exits so Railway
  restarts it and it re-registers fresh. Traps `SIGTERM`/`SIGINT` to deregister
  on redeploy/scale-down.
- `ci/runner/railway.json` — the Railway service config (Dockerfile builder,
  always-restart, 1 replica).

### Security posture

- **Private repo.** `SethMed7/rotli` is private, so only collaborators can
  trigger a run — the fork-PR "anyone runs code on your runner" risk that makes
  self-hosted runners dangerous on *public* repos does not apply. Keep it
  private; if it ever goes public, remove this runner first.
- **One secret, minimally scoped.** The only secret on the runner is
  `GH_RUNNER_TOKEN`: a **fine-grained PAT** scoped to **only `SethMed7/rotli`**
  with **Administration: Read and write** (the permission that mints runner
  registration tokens). No org access, no other repos, no other permissions. The
  per-run `secrets.GITHUB_TOKEN` is minted by GitHub per-run and expires with it.
- **No signing keys, ever.** This runner runs the gate only (`bun run
  test:regression`, `bun run build`, lint, e2e). It never runs `release.sh`, so
  the Apple signing identity, notary profile, and updater key stay on Seth's Mac
  and never touch CI.
- **Ephemeral + disposable.** Each container accepts exactly one job then
  re-registers fresh — no stale runner state accumulates. Nothing durable lives
  on it; `.rotli/` app state and `~/memex-vault` are never present.

### Deploy steps (Seth does this)

You can't operate Seth's Railway account, so this is the runbook for him.

**1. Mint the PAT** (github.com → Settings → Developer settings → **Fine-grained
personal access tokens** → Generate new token):

- **Resource owner:** SethMed7 · **Repository access:** Only select repositories
  → `SethMed7/rotli`.
- **Permissions → Repository permissions → Administration: Read and write.**
  (That is the *only* permission needed — it authorizes minting runner
  registration tokens. Leave everything else "No access".)
- Set an expiry you'll rotate on (e.g. 90 days). Copy the token.

**2. Create the Railway service** (Railway → the personal **My Projects**
workspace, PRO plan — NOT Myela):

- **New Project → Deploy from GitHub repo →** `SethMed7/rotli` (authorize the
  Railway GitHub app for this repo if prompted).
- In the service's **Settings → Source**, set **Root Directory** to `ci/runner`
  (so the Dockerfile build context and `railway.json` resolve). Railway will
  detect the Dockerfile automatically.
- **Settings → Variables:** add `GH_RUNNER_TOKEN` = the PAT from step 1. (That's
  the only variable required; `GH_OWNER`/`GH_REPO` default to `SethMed7`/`rotli`.)
- **Deploy.** This is a **long-lived service** — leave it running (do not put it
  to sleep); the ephemeral loop keeps a fresh runner registered continuously.

**3. Verify:** GitHub → `SethMed7/rotli` → Settings → Actions → Runners shows a
`rotli-linux-…` runner **Idle** (green). Trigger a run with `gh workflow run
"Regression suite" --repo SethMed7/rotli --ref main` (or open a PR) — the five
Linux jobs land on it; `cargo-macos` stays queued until a Mac runner exists.

### Maintenance

- **Rotate the PAT** before it expires: mint a new one, update the
  `GH_RUNNER_TOKEN` variable in Railway, redeploy. The old registration tokens it
  minted are already short-lived; nothing else to clean up.
- **Bump the runner:** update the base image tag in `ci/runner/Dockerfile` (keep
  it in step with GitHub's current `actions/runner` release) and redeploy.
- **Retire it:** delete the Railway service and revoke the PAT. Any lingering
  offline runner entry can be removed in GitHub → Settings → Actions → Runners.

---

## The macOS runner (for the `cargo-macos` job)

The Rust gate (`cargo clippy` + `cargo test`) runs on a **self-hosted macOS
runner** — a spare Apple-Silicon Mac. Register this when you want the Rust gate
live; until then `cargo-macos` queues harmlessly.

**Why macOS.** The Tauri crate has ~37 `#[cfg(target_os = "macos")]` gates, so a
Linux `cargo build` compiles a different binary than the one that ships — the
Rust must be checked on the same OS it targets. Signing and notarization still
stay out of CI (`release.sh` does them locally), so this runner needs no signing
key either.

### Security model (read before registering)

- **No release secrets on the runner.** It runs the Rust gate only — `cargo
  clippy` + `cargo test`. It never runs `release.sh`, so the Apple signing
  identity, the notary profile, and the updater key stay on the release machine
  and never touch CI. `secrets.GITHUB_TOKEN` is minted per-run and expires with
  the run.
- **Private repo = the fork-PR risk does not apply.** Self-hosted runners on a
  *public* repo are dangerous: anyone's PR can run arbitrary code on your Mac.
  `SethMed7/rotli` is private, so only collaborators can trigger a run. Keep it
  private; if it ever goes public, remove the self-hosted runner first.
- **Least privilege.** Register the runner under a **dedicated macOS user** (not
  your admin account), so a compromised dependency in a run can't reach your
  personal files, Keychain, or the release keys. A standard (non-admin) account
  is enough — the runner only needs Homebrew tools on its PATH.
- **Scoped label.** The workflow targets `[self-hosted, macOS, ARM64, rotli]`.
  The custom `rotli` label means only this repo's jobs land here even if the
  machine ever hosts another runner.
- The runner's work directory is disposable. Nothing durable lives there;
  `.rotli/` app state and `~/memex-vault` are never present in CI.

### One-time setup

Do this on the Mac that will host the runner (Apple Silicon; the workflow's
`ARM64` label assumes it). A dedicated standard account named e.g. `rotli-ci` is
recommended — create it in System Settings → Users & Groups first, log in as it,
and run everything below as that user.

**1. Prerequisites on the runner's PATH** (Homebrew for the CI user):

```sh
# Xcode command-line tools (for the Rust/Tauri build)
xcode-select --install
# Homebrew, then the toolchains the workflow's setup-actions expect to find/install
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
brew install oven-sh/bun/bun jq
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
```

**2. Register the runner** (this is the step that needs your GitHub token — the
registration token is short-lived and repo-scoped, minted here):

```sh
# get the current registration token + the exact download URL from GitHub:
#   github.com/SethMed7/rotli → Settings → Actions → Runners → New self-hosted runner (macOS/ARM64)
# it prints a `./config.sh --url ... --token ...` line. Run their download block, then:
mkdir -p ~/actions-runner && cd ~/actions-runner
# (paste the download+extract commands GitHub shows for macOS-ARM64)
./config.sh --url https://github.com/SethMed7/rotli \
            --token <THE-REGISTRATION-TOKEN-GITHUB-SHOWS> \
            --name rotli-ci-mac \
            --labels rotli \
            --work _work \
            --unattended
```

`--labels rotli` adds the custom label; GitHub adds `self-hosted`, `macOS`, and
`ARM64` automatically, completing the set the workflow targets. Do **not** paste
the registration token into any file or the repo — it is one-time and expires in
an hour.

**3. Run it as a background service** (survives reboots, starts on login of the
CI user):

```sh
cd ~/actions-runner
./svc.sh install
./svc.sh start
./svc.sh status   # should show "started"
```

### Verifying it works

- GitHub → Settings → Actions → Runners shows `rotli-ci-mac` **Idle** (green).
- Trigger a run without a code change: `gh workflow run "Regression suite" --repo
  SethMed7/rotli --ref main`, then `gh run watch` — the `cargo-macos` job lands
  on this runner and goes green (the Linux lanes run on Railway). Or just open a
  PR; every push triggers the suite.
- This runner executes only `cargo-macos`. Register a second `rotli`-labelled Mac
  to parallelize if you ever add more macOS jobs.

### Maintenance

- Update the runner binary when GitHub prompts: `./svc.sh stop && ./config.sh
  remove --token <new-token>` then re-run setup, or use the in-place updater it
  offers. The runner auto-updates minor versions by default.
- If the Mac is retired: GitHub → Settings → Actions → Runners → remove
  `rotli-ci-mac`, and `./svc.sh uninstall` on the machine.
- Keychain/login: the service runs as the CI user; keep that account logged in
  (or enable auto-login for it) so the LaunchAgent stays alive across reboots.

---

## How releases use CI

`release.sh --publish` checks the **CI conclusion** for the exact release commit
before publishing (ROTLI_OPERATIONS: gate on the conclusion value, never an exit
code). It queries the `Regression suite` workflow by name, so the split does not
change this behavior:

- A run that **failed** for the commit blocks the release outright.
- A **missing** run (runner offline, or the run still going) only warns and
  proceeds on the local gate — so this never blocks a release when a runner is
  down. Because `cargo-macos` queues until a Mac runner exists, its lane counts
  as pending → warn, not block. Pass `--require-ci` to make "no green run" also
  blocking once you trust the runners to always be up.
