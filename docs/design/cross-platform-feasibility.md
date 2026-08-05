# Cross-platform feasibility — rotli on Linux, macOS, and Windows

Status: **SCOPE / DECISION DOCUMENT** (2026-08-03). Read-only investigation of
`main` at 97a0b6c (0.69.0). No app code was changed; this is a plan, not a
migration. Evidence is cited as `file:line` against that commit.

## The framing

Tauri is cross-platform **by design** — one Rust core + one webview UI builds
for macOS, Windows, and Linux out of the box. rotli is Mac-only today because of
**its own implementation choices**, not any Tauri limitation. Every place the
product reaches for a macOS-specific API is a *seam we chose to cut on the Mac*,
and almost all of them are already `#[cfg(target_os = "macos")]`-gated with a
`#[cfg(not(target_os = "macos"))]` no-op fallback right beside them. That means
the codebase was written *anticipating* this port: the seam count is small,
finite, and mostly already fenced. This document maps exactly what it takes to
honor Tauri's cross-platform nature.

**The vision (Seth):** rotli should run on Linux, macOS, and Windows. The
on-device AI layer can stay Mac-only for now (MLX is Apple-Silicon-only), but the
architecture should make adding a non-Mac AI backend (Ollama / llama.cpp) *easy*
later — a swappable adapter, not a rewrite. Everything else should run
everywhere. Seth has only a Mac, so the testing story for Linux/Windows has to
lean on CI + VMs/containers + cheap cloud boxes.

## Headline findings (read this first)

1. **The frontend is free.** The entire React/TS/Vite surface — editor
   (CodeMirror 6), sidebar, panes/tabs, themes, Tantivy search UI, boards
   (Excalidraw), sheets (Univer) — is OS-agnostic. A grep for
   `@tauri-apps/plugin-os` / `navigator.platform` / OS branching in `src/` finds
   **nothing**. The UI ports for zero cost.

2. **The AI seam is closer to swappable than it looks — because it already
   speaks Ollama's wire.** The on-device model is *already* behind a loopback
   HTTP port. `chat.rs` supports two wire shapes: **Ollama-generate**
   (`/api/generate`, MLX at `:11435`, the default) and **OpenAI**
   (`/v1/chat/completions`, llama.cpp at `:11436`), selected per-model by a
   registry `api` field (`chat.rs:4-5,15-17,31`). The *inference call* is already
   backend-agnostic: give it an endpoint + a wire shape and it works. What is
   Mac-bound is **model management and lifecycle** (the MLX server's `launchd`
   plist, `hf`-CLI downloads, the sysctl compute guardrails), not the inference.
   Pointing at a real Ollama on Linux/Windows is genuinely close because Ollama
   *natively serves the same `/api/generate` wire rotli already POSTs*.

3. **The scheduler/daemon is already cross-platform in its modern form.** The
   Breve scheduler + organizer runtime is a **supervised Bun child process**
   (`routines.rs` `BreveSupervisor` → `rotli-scheduler.ts`), which Rust starts,
   restarts on crash, and kills on quit — *no* `launchctl`. The only `launchctl`
   in the scheduler path is the **legacy migration** off the old standalone-Breve
   LaunchAgents (`breve.rs:1582-1739`), which a fresh non-Mac install never had.
   The task brief's worry that "the daemon is launchctl and significant" is
   **outdated** — the daemon design already sidestepped it.

4. **Most `open`/reveal seams already compile everywhere** — they're gated with a
   `not(macos)` no-op. They just don't *do* anything off-Mac yet. Swapping
   `Command::new("open")` for `tauri-plugin-opener` makes them real on all three
   OSes in one mechanical pass.

5. **The real blockers are three, and they're all AI/native-integration, not
   product:** (a) the local-AI **management** plumbing (Mac/MLX-specific by
   nature — this is the intended adapter boundary), (b) **secrets** (Keychain →
   `keyring` crate, one file), (c) **doc conversion** (`textutil`, Mac-only, but
   already fails gracefully off-Mac). None of these block a *usable* Linux build
   with AI in remote/Ollama mode.

**Effort tier:** a **Linux build that runs with AI disabled or pointed at a
remote/Ollama endpoint** is a **~1–2 week** job (mostly mechanical seam work +
CI). A **polished Linux AI experience via an Ollama adapter** adds **~1–2 weeks**.
**Windows** adds **~1 week** on top (mostly path/tray/packaging nits). Total to
"all three platforms, local AI everywhere": **~1–1.5 months** of focused work,
front-loaded by the one de-risking step below.

**Recommended first step (de-risks everything):** get the Rust crate to
**compile and boot on Linux** behind the existing `cfg` branches, AI stubbed.
This is a CI job (`ubuntu-latest`) + fixing whatever the compiler flags. It
proves the seam count is real and turns every remaining item into a known,
bounded task instead of a guess.

---

## The seam inventory

There are **22** `#[cfg(target_os = "macos")]` gates across 7 Rust files, plus a
handful of non-cfg'd Mac assumptions (subprocess calls to `open`, `pmset`,
`ioreg`, `sysctl`, `textutil`, `launchctl`, `security`). Counts by file:
`lib.rs` 8, `corpus.rs` 4, `document_conversion.rs` 3, `workspace.rs` 2,
`organizer.rs` 3, `memex.rs` 1, `web.rs` 1. The non-cfg'd Mac subprocess seams
live mostly in `localmodel.rs`, `compute.rs`, `chat.rs`, `breve.rs`, and
`provider.rs`.

### Seam table

| # | Seam | Where | Current Mac impl | Cross-platform path | Effort | Risk |
|---|------|-------|------------------|---------------------|:---:|:---:|
| 1 | **On-device AI inference** | `chat.rs` `complete_local`/`chat_messages`/`chat_messages_stream` (`chat.rs:439-575`, `327`) | POST loopback `/api/generate` (Ollama wire) or `/v1/chat/completions`; locality gated by `endpoint_is_local` (`chat.rs:63`) | **Already portable.** The call only needs an endpoint + `api` shape. On Linux/Windows, point at a user-run **Ollama** (`localhost:11434`, native `/api/generate`) or any OpenAI-shaped server. No change to the transport. | **S** | Low |
| 2 | **Local-model management** | `localmodel.rs` (whole file) | `hf`-CLI downloads into `~/.memex/ai`, `registry.json` splice, MLX `launchd` plist repoint + reload (`localmodel.rs:431-497`) | **Adapter boundary (see below).** MLX stays Mac-only. Non-Mac uses an **Ollama backend**: model list via `GET /api/tags` (or `ollama list`), install via `ollama pull`, no plist/launchd. | **L** | Med |
| 3 | **Compute guardrails** | `compute.rs:165-173`, `localmodel.rs:350` | `sysctl` reads: `hw.memsize`, `kern.memorystatus_level`, `kern.memorystatus_vm_pressure_level` | The [`sysinfo`](https://crates.io/crates/sysinfo) crate (cross-platform total/available memory + pressure). Or: **skip guardrails entirely under the Ollama backend** (Ollama self-manages memory/unload), keeping sysctl on the MLX path only. | **M** | Low |
| 4 | **Secrets** | `keychain.rs` (whole module) | macOS Keychain via `security-framework` (`get`/`set`/`delete_generic_password`) | The [`keyring`](https://crates.io/crates/keyring) crate: Keychain on macOS, **Credential Manager** on Windows, **libsecret/kwallet** on Linux. Same 3-fn surface. **One file.** All call sites already go through `keychain::{get,store,delete}_secret`, so callers don't change. Dev-mode in-memory store already exists (`keychain.rs:44`). | **S** | Low |
| 5 | **Scheduler / daemon** | `routines.rs` `BreveSupervisor` | Supervised **Bun child process** (`rotli-scheduler.ts`), Rust owns lifecycle + restart. **No launchctl.** | **Already cross-platform** (Bun runs on all three). Only nits: `find_bun` (`memex.rs:344`) probes Mac paths — add `%USERPROFILE%\.bun\bin\bun.exe` + Windows PATH. Process-group kill semantics (`routines.rs:211-224`) need a Windows equivalent (job objects / `taskkill /T`). | **S–M** | Low |
| 6 | **Legacy Breve launchd migration** | `breve.rs:1582-1739`, scheduler enum `LegacyLaunchd` (`breve.rs:235`) | Detect + unload old standalone-Breve LaunchAgents | **Gate off-Mac.** A fresh Linux/Windows install has no legacy LaunchAgents — return `BreveScheduler::None` and skip the whole migration probe under `not(macos)`. | **S** | Low |
| 7 | **MLX/llama.cpp server lifecycle** | `chat.rs:706-718` (`ensure_llamacpp_up`, `launchctl kickstart`), `localmodel.rs:484` (`reload_mlx`) | `launchctl` bootstrap/kickstart of the on-demand model servers | MLX-only, stays Mac-only. Under the Ollama backend the server is **user-managed** (Ollama's own service) — no lifecycle code needed. | **S** | Low |
| 8 | **Doc conversion (DOCX)** | `document_conversion.rs:46-88`, gated in `corpus.rs:6199` | `/usr/bin/textutil` shells to convert to `.docx`; PDF→text via `pdf-extract` (already cross-platform) | Already returns a clean *"available only on macOS"* error off-Mac (`corpus.rs:6199`). To make it real: **pandoc** (bundle or detect) or a Rust docx writer. PDF-text extraction (`pdf-extract`) already works everywhere. **Ship gated at first**, add pandoc later. | **M** | Low |
| 9 | **Open / reveal in file manager** | `lib.rs:592,1007`; `corpus.rs:5969,6244,6300`; `memex.rs:886`; `web.rs:536`; `workspace.rs:986` | `Command::new("open")` / `open -R` / `open -a`, each with a `not(macos)` no-op | [`tauri-plugin-opener`](https://tauri.app/plugin/opener/) (reveal + open path/URL, cross-platform), or the [`open`](https://crates.io/crates/open) crate. One mechanical replacement pass turns the existing no-ops into real behavior on all OSes. Windows/Linux have no `open -a` app-allowlist idiom → gate "Open with…" (`corpus.rs:6255`) to Mac or map to per-OS defaults. | **S–M** | Low |
| 10 | **Dock / activation policy** | `lib.rs:1007-1018` (`set_dock_visible`), `lib.rs:1334` (`ActivationPolicy::Accessory`) | `NSApplication` activation policy (menu-bar-only vs Dock) | macOS-only concept, already `not(macos)`-gated to a no-op. On Windows/Linux the equivalent is **tray-only with no taskbar entry** (`skipTaskbar`) — configure per-OS; no Dock analog needed. | **S** | Low |
| 11 | **App-icon runtime swap** | `lib.rs:1025-1050` | AppKit `setApplicationIconImage` via `objc2` (already target-gated in `Cargo.toml`) | Mac-only feature (runtime Dock icon). Leave gated; other OSes don't have a runtime app-icon concept. `objc2*` deps are already `[target.'cfg(target_os = "macos")'.dependencies]` so they don't even build off-Mac. | **S** | Low |
| 12 | **Quit-flush menu swap** | `lib.rs:1559` | Rewrites the predefined macOS app-menu Quit item to intercept ⌘Q for a graceful flush | macOS app-menu shape specific; already `not(macos)`-gated. On other OSes wire the flush to window-close / tray-quit + `WindowEvent::CloseRequested`. | **M** | Med |
| 13 | **Dock re-open event** | `lib.rs:1625` | `RunEvent::Reopen` (macOS-only variant) to resurface the window on Dock click | Gated already. Tray-click "show window" covers the same intent on Windows/Linux. | **S** | Low |
| 14 | **Capture card / Quick Note (menu-bar idiom)** | `lib.rs:405-450` (`finish_capture`, `NSApp hide`), `tauri.conf.json` `macOSPrivateApi`, transparent `capture` window | Transparent always-on-top capture card; `app.hide()` (NSApp) to return focus to the prior app | Transparent/always-on-top windows work on all three in Tauri. The `NSApp hide` focus-return is Mac-only (already gated). **`macos-private-api` feature** is Mac-only and harmless elsewhere. Assess whether the transparent capture card is *core* off-Mac or degrade it to a normal borderless window. Global-shortcut summon (`tauri-plugin-global-shortcut`) is cross-platform. | **M** | Med |
| 15 | **Config path** | `workspace.rs:1121-1124` | `~/Library/Application Support/com.rotli.app` vs `~/.config/...` — **already branched** | Done. Prefer Tauri's `app_config_dir()` everywhere (already used in `breve.rs:280`) so Windows gets `%APPDATA%` correctly. | **S** | Low |
| 16 | **Power / thermal / idle probes** | `organizer.rs:1970-2020` | `pmset -g batt/therm`, `ioreg` HIDIdleTime — **already** have `not(macos)` fallbacks returning permissive `true` | The daemon already runs everywhere with guardrails defaulting *open*. Add real signals later via [`battery`](https://crates.io/crates/battery) / `sysinfo` if desired. Ship permissive first. | **S** | Low |
| 17 | **agy image sandbox** | `provider.rs:524-566` | `sandbox-exec` + SBPL profile around the `agy` image CLI | Already `cfg!(target_os = "macos")`-gated (`image_sandbox_enabled`, `provider.rs:563`). The connected-CLI image lanes are a Mac-centric power feature; off-Mac either run unsandboxed (like `codex`, which self-contains) or gate the feature. | **S** | Med |
| 18 | **CLI-auth detection** | `provider.rs:765` | Shells `/usr/bin/security` to detect a Gemini-CLI Keychain token | Fold into the `keyring` migration or gate; a minor detection nicety, not load-bearing. | **S** | Low |
| 19 | **"Open with…" app allowlist** | `corpus.rs:6255-6310` | Hard-coded `.app` bundle names under `/Applications` | Gate to Mac, or replace with per-OS "open with default handler" via the opener plugin. Non-core. | **S** | Low |
| 20 | **Reveal-`.md`-on-disk in Notes** | `memex.rs:886` | `open -R` | Same as seam #9 — opener plugin. | **S** | Low |

### Cross-platform crates already in the tree (no work needed)

These dependencies are already cross-platform, so they carry over unchanged:
`trash` v5 (macOS/Windows/Linux OS-trash — confirmed cross-platform),
`tantivy` (search index), `notify` v8 (fs watcher), `ulid`, `uuid`, `time`,
`tempfile`, `ureq`, `pdf-extract`, `regex`, `serde`. The `objc2*` trio is
already fenced under `[target.'cfg(target_os = "macos")'.dependencies]` so it
never builds off-Mac. The Tauri plugins in use — `global-shortcut`, `deep-link`,
`dialog`, `updater`, `process` — are all cross-platform.

---

## The AI-backend adapter (the "easy to add later" that Seth wants)

### Why it's already close

The insight worth internalizing: **rotli's chat transport doesn't know or care
what's behind the port.** `complete_local` and `chat_messages_stream` build a
URL from a per-model `endpoint` + `api` shape and POST it; `endpoint_is_local`
enforces the secure-note egress gate purely from the *host being loopback*
(`chat.rs:63`), never from a caller flag. The MLX server speaks Ollama's
`/api/generate`; **Ollama speaks the same wire** (it *is* the wire). So an
Ollama server on Linux/Windows drops straight into the existing inference path.

What is *not* portable is everything **around** inference: the model **catalog**
(`registry.json`), **downloads** (`hf` CLI), the **default-model** pin (the MLX
`launchd` plist), and the **compute guardrails** (sysctl). Those are exactly the
things that differ between "MLX on Apple Silicon" and "Ollama on a Linux box."

### The design: a declared `LocalAiBackend`

Introduce one seam — a backend the app selects at startup by OS + what's
installed — with two implementations:

```
trait LocalAiBackend {
    fn list_models() -> Vec<ChatModel>;      // catalog + endpoints + api shape
    fn default_model() -> Option<String>;    // what no-model callers get
    fn set_default(id) -> Result<()>;        // pin the default
    fn ensure_up(endpoint);                  // best-effort server wake
    fn install(spec) / fn footprint(id);     // model management (optional)
    // inference is NOT here — it stays in chat.rs, backend-agnostic
}
```

- **`MlxBackend` (macOS, default when the MLX server is present):** exactly
  today's behavior — `registry.json`, `hf` downloads, `launchd` plist default,
  sysctl guardrails, `mlx-server.py`. Nothing regresses; this is a refactor that
  moves existing `localmodel.rs`/`compute.rs` code behind the trait.

- **`OllamaBackend` (Linux/Windows, and optionally macOS):** talks to a
  user-installed Ollama at `localhost:11434`. `list_models` = `GET /api/tags`
  mapped into `ChatModel` with `api: "generate"`. `default_model` = a config
  knob or the first tag. `install` = `ollama pull` (or just document "install
  Ollama and pull a model"). `ensure_up` = probe the port (Ollama runs as its
  own service). **No guardrails** — Ollama manages memory/unload itself, so
  `compute.rs` sysctl reads are simply not on this path.

- **`RemoteOnly` / `NoLocalAi` (any OS):** no local backend; the chat picker
  shows only connected models (Gemini via the existing Keychain/keyring key,
  connected CLIs). This is the **Phase 0** state — the product is fully usable
  for notes, search, editing, boards, sheets, Breve delivery — just without
  *local* inference.

**What stays Mac-only short-term:** MLX (Apple-Silicon compute), the `launchd`
model-server management, the transparent capture card's NSApp focus-return, doc
conversion via `textutil`, and the agy image sandbox. **How a Linux/Windows user
gets local AI:** install Ollama, `ollama pull` a model, rotli's `OllamaBackend`
discovers it and it appears in the same chat picker — same UI, same secure-note
gate (loopback = local), same streaming path.

The security invariant holds across backends: **localhost transport does not make
a frontier model local** (CARL `ROTLI_MODELS` rule) — the gate is host-based and
unchanged, so an Ollama endpoint is treated exactly like MLX for secure-note
egress.

---

## Dominant blockers vs mechanical work

**Mechanical (a weekend each, low risk):**
- The `open`/reveal seams → opener plugin (seams #9, #20).
- Secrets → `keyring` (one file, seam #4).
- Config paths, dock/activation gates, power probes — already branched or
  trivially so (seams #10, #15, #16).
- `find_bun` Windows path + Windows process-group kill (seam #5).
- Gating legacy-launchd migration, "Open with…", app-icon swap off-Mac
  (seams #6, #11, #19).

**Substantive (a week or more, real design):**
- The **`LocalAiBackend` adapter** + `OllamaBackend` (seam #2/#3/#7). This is
  the one genuinely new subsystem, and it's the feature Seth explicitly wants
  built for extensibility. Mostly a refactor of existing code behind a trait
  plus a modest Ollama implementation.
- **Doc conversion** off-Mac (seam #8) if we want parity — pandoc integration.
  Otherwise ship gated (already does).
- The **menu-bar/tray + capture-card idiom** (seams #12, #13, #14). Tray works
  everywhere, but the *feel* (menu-bar summon, quit-flush, transparent capture)
  needs per-OS UX decisions and testing. This is where "runs" vs "feels native"
  diverges.

**Not a blocker at all:** the frontend, the daemon/scheduler (already Bun), the
search index, the fs watcher, OS trash, deep links, the updater.

---

## Phased plan

### Phase 0 — "product usable elsewhere" (Linux MVP, AI remote/off)
**Goal:** the Rust core **compiles and boots on Linux**; the app runs with local
AI disabled (or pointed at a remote/Ollama endpoint). This is the MVP that proves
the product runs everywhere.

**Ships:**
- Rust compiles clean on `ubuntu-latest` behind existing `cfg` branches (AI
  management stubbed to `NoLocalAi`/`RemoteOnly`).
- Secrets on `keyring` (seam #4).
- `open`/reveal real via opener plugin (seams #9, #20).
- Config paths, dock/activation, power probes, legacy-launchd migration all
  gated/branched (seams #6, #10, #15, #16).
- `tauri.conf.json` gains Linux bundle targets (AppImage + deb).
- Chat picker shows connected models (Gemini/CLIs) + optional Ollama endpoint.

**Testable:** Linux CI job (build + the full bun/e2e/cargo gate on
`ubuntu-latest`), plus a manual smoke run in a Linux VM/container. Notes, search,
editor, panes, boards, sheets, Breve delivery all exercised.

### Phase 1 — Linux local AI via the Ollama adapter
**Goal:** a Linux user gets on-device inference by installing Ollama.

**Ships:**
- The `LocalAiBackend` trait; `MlxBackend` (refactor, no Mac regression) +
  `OllamaBackend` (new).
- Model discovery via `/api/tags`; default-model knob; no-guardrail path.
- Streaming works (the NDJSON path is already Ollama's shape).

**Testable:** on a Linux box/CI with Ollama installed, an integration test that
pulls a tiny model, lists it, runs a chat turn + a streamed turn, and confirms
the secure-note gate still treats the loopback endpoint as local.

### Phase 2 — Windows
**Goal:** rotli runs and self-updates on Windows.

**Ships:**
- Windows bundle targets (NSIS/MSI) + Authenticode signing in the release
  pipeline.
- Windows path/process fixes (`find_bun` `.exe`, job-object process kill).
- Tray idiom + quit-flush wired to `WindowEvent::CloseRequested` (seams #12–14).
- `OllamaBackend` works the same (Ollama runs on Windows).

**Testable:** Windows CI (`windows-latest`) build + the bun/cargo gates; manual
verification on a cheap cloud Windows box or a borrowed machine.

*(Doc-conversion parity via pandoc, real power/thermal guardrails off-Mac, and a
polished non-Mac capture card are follow-ups that can land in any phase without
blocking "usable.")*

---

## Testing story for a Mac-only developer

Seth can validate Linux/Windows without owning either, using layers already
partly in place:

1. **CI is the primary gate — and the split already exists.** The regression
   suite (`.github/workflows/regression.yml`) runs every OS-agnostic lane
   (lint/types/architecture contracts, design-system, Playwright e2e, the
   Bun/Breve regression, `bun run build`, Astro build, dependency audit) on
   GitHub-hosted `ubuntu-24.04`. The only macOS-locked lane is `rust-macos` —
   `cargo clippy` + `cargo test` on GitHub-hosted `macos-15` — because a Linux
   `cargo build` produces a *different* binary across the macOS `cfg` gates. The
   JS/TS/Vite/Playwright surface is therefore validated on Linux today, which is
   how a Mac-only developer proves portable behavior. Playwright uses
   `--with-deps` to install Chromium's Linux system libraries. The remaining gap
   this port opens is a **Linux `cargo build` lane**: add a job that compiles the
   crate on Linux behind those `cfg` branches with AI stubbed, turning the
   compiler into the enumerator of every real seam. Windows adds a
   `windows-latest` lane later.

2. **A Linux VM/container for manual smoke.** A Docker container or a UTM/Lima
   Linux VM on Seth's Mac runs the AppImage/deb for hands-on verification of the
   things CI can't see (window chrome, tray, file dialogs, actual reveal-in-files
   behavior). For the Ollama path, the container runs Ollama alongside.

3. **Windows via CI + a cheap cloud box.** `windows-latest` CI for build/test;
   for manual UX verification, a short-lived cloud Windows instance (AWS/Azure) or
   a friend with a Windows machine running a signed build for an afternoon. The
   updater feed can be exercised end-to-end from CI artifacts.

4. **The native-claim rule still applies** (CARL `ROTLI_OPERATIONS`): scheduler
   and native-visual claims need human-managed app evidence — browser fixtures
   aren't equivalent. So tray/capture-card/quit-flush on each OS get a manual
   pass, not just a green CI check.

---

## Packaging, signing, and the release story

Today `scripts/release.sh` signs + notarizes locally with a Developer ID and the
`updater` plugin publishes `latest.json` to `SethMed7/rotli-releases`
(`tauri.conf.json` `plugins.updater`). Per-OS additions:

- **macOS:** unchanged (Developer ID + notarize).
- **Windows:** add NSIS/MSI bundle targets; **Authenticode** signing (a code-
  signing cert — the one real cost/procurement item). The Tauri updater already
  supports Windows; the feed just needs Windows artifacts in `latest.json`.
- **Linux:** AppImage + deb (and optionally rpm/Flatpak). No mandatory signing;
  AppImage can be GPG-signed. The updater supports AppImage.

The updater is **not** Sparkle — it's `tauri-plugin-updater`, already cross-
platform. One signed feed serves all three OSes once each OS's artifacts are
built and its signature is in place. CI must build each OS's bundle; signing keys
stay off the CI runner (as they do today) or use per-OS signing services.

---

## Recommendation

**Worth it? Yes — the ratio is unusually favorable.** The frontend is free, the
daemon is already cross-platform, most native seams already compile everywhere
behind gates that the codebase *deliberately* wrote, and the AI — the scary part
— is already behind an Ollama-compatible port, so "local AI elsewhere" is an
adapter, not a rewrite. The seam count is genuinely ~20 and most are S-effort.

**Smallest first step that de-risks the whole thing:** stand up a Linux CI job
(`ubuntu-latest`) that just tries to **`cargo build` the crate** with AI
management behind a `NoLocalAi` stub. The compiler will enumerate every real gap
in an afternoon — turning this document's estimates into a concrete, bounded
punch-list — and a green build proves the "usable everywhere" MVP (Phase 0) is a
1–2 week reach, not a research project.

Then decide, with that punch-list in hand, whether to chase Phase 1 (Linux local
AI via Ollama — the extensible adapter Seth wants) immediately or ship the Phase
0 remote-AI Linux build first and let real Linux users pull it.
