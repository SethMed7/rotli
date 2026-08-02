# The self-hosted CI runner

The Regression suite (`.github/workflows/regression.yml`) runs on a **self-hosted
macOS runner** — a spare Apple-Silicon Mac — instead of GitHub-hosted minutes.

**Why.** The whole gate — 1000+ Bun tests, 300+ cargo tests, 60+ Playwright
specs, the twelve `check:*` scripts, and a production build — used to run only
when someone remembered to type `bun run check` on one machine. That is a
discipline system, not a quality system. GitHub-hosted minutes for this private
repo are billing-blocked, and hosted macOS is the expensive tier regardless
(the Tauri build needs macOS). A self-hosted runner costs zero minutes and makes
the gate run on **every push and PR, always**. Signing and notarization stay
out of CI — `release.sh` still does them locally — so the runner never needs a
signing key.

## Security model (read before registering)

- **No release secrets on the runner.** It runs the gate only — `bun run
  test:regression`, `cargo`, `bun run build`. It never runs `release.sh`, so the
  Apple signing identity, the notary profile, and the updater key stay on the
  release machine and never touch CI. `secrets.GITHUB_TOKEN` is minted per-run
  and expires with the run.
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

## One-time setup

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

## Verifying it works

- GitHub → Settings → Actions → Runners shows `rotli-ci-mac` **Idle** (green).
- Trigger a run without a code change: `gh workflow run "Regression suite" --repo
  SethMed7/rotli --ref main`, then `gh run watch` — it should pick up on the
  runner and go green. Or just open a PR; every push now triggers the suite.
- One runner executes the five jobs **serially** (a full pass is roughly the
  wall-clock of `bun run check` + `cargo test` + the build, back to back).
  Register a second `rotli`-labelled runner on another Mac to run them in
  parallel.

## How releases use it

`release.sh --publish` now checks the **CI conclusion** for the exact release
commit before publishing (ROTLI_OPERATIONS: gate on the conclusion value, never
an exit code):

- A run that **failed** for the commit blocks the release outright.
- A **missing** run (runner offline, or the run still going) only warns and
  proceeds on the local gate — so this never blocks a release when the runner is
  down. Pass `--require-ci` to make "no green run" also blocking once you trust
  the runner to always be up.

## Maintenance

- Update the runner binary when GitHub prompts: `./svc.sh stop && ./config.sh
  remove --token <new-token>` then re-run setup, or use the in-place updater it
  offers. The runner auto-updates minor versions by default.
- If the Mac is retired: GitHub → Settings → Actions → Runners → remove
  `rotli-ci-mac`, and `./svc.sh uninstall` on the machine.
- Keychain/login: the service runs as the CI user; keep that account logged in
  (or enable auto-login for it) so the LaunchAgent stays alive across reboots.
