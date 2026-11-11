# Testing and regression contract

Rotli treats tests and mechanical checks as executable architecture. A change is
not complete when it merely compiles: the behavior, failure state, dependency
direction, runtime wiring, and owning documentation must agree.

## Command map

| Command | Purpose |
|---|---|
| `bun run security:protect` | Print the five repository rulesets (main/dev, all branches, tags); `--check` compares GitHub with them read-only; explicit `--apply` checks the owner, then creates or updates each one and verifies it against the plan |
| `bun run stats` | Maintainer usage counts, read-only: GitHub release downloads and installed updates, repository traffic, and rotli.co's Cloudflare traffic (visitors, download page, Rotli Web loads, Mac update checks by version) with a read-only token from `CLOUDFLARE_API_TOKEN` or the Keychain item `rotli-cloudflare-stats`; aggregate only (`docs/operations/usage-stats.md`) |
| `bun run security:secrets` | Redacted Gitleaks 8.30.1 scan of tracked/unignored working-tree files; separate from verify, fails on findings/errors; the external binary is intentionally listed in knip's tool allowlist |
| `bun run security:working` | Scan proposed tracked/untracked worktree text with pinned Gitleaks without printing values; included in the required verify secrets lane alongside a latest-commit scan. Full history remains a separate publication gate |
| `bun run security:bundle <candidate.app>` | Inspect actual release resources and binary strings for prohibited files, embedded home paths, and symlinks escaping the bundle; required before Apple uploads |
| `bun run security:changes <base-sha> <head-sha>` | Check proposed Git commits with pinned Gitleaks and redacted diagnostics; CI blocks new findings. New-branch/manual scans cover reachable history, and may surface the separately unresolved historical fixtures |
| `bun run security:history` | Redacted Gitleaks 8.30.1 scan of all local Git history refs; mandatory before source publication, never proof of image/prose privacy |
| `bun run lint` | Concurrent fan-out of TypeScript checks on both compiler implementations, plus formatting, oxlint, code-shape, brand, architecture, IPC, structure, and documentation guards |
| `bun run lint:serial` | The exact same lint/check set in deterministic sequence. Use it on memory-constrained machines or when one-at-a-time logs are easier to diagnose; CI and the default gate retain the faster parallel path |
| `bun run test:unit` | Frontend domain, application, adapter, and state tests under `src/`, run in Bun's isolated parallel workers |
| `bun run test:changed` | Fast local feedback: isolated Bun tests related to files changed against the default branch |
| `bun run test:evals` | Deterministic offline AI loop, routing, model-policy, prompt, retrieval, and memory-workflow evals |
| `bun run test:breve` | Breve policy, failure-state, locking, and delivery-claim regressions |
| `bun run test:tooling` | Fixture tests that prove repository linters detect forbidden code shapes, plus the script-free native/generated dependency smoke |
| `bun run test:relay` | Stateless remote-MCP relay role authentication, browser-origin refusal, capacity/body bounds, live-device rendezvous, expiry, and token-isolation tests |
| `bun run test:e2e` | Playwright regression layer — drives the real browser twin (chromium) against `vite dev`'s seeded demo corpus |
| `bun run test:e2e:ui` | The same specs in Playwright's interactive UI runner, for local debugging |
| `bun run check:e2e-types` | Strict-typecheck `e2e/` and `playwright.config.ts` (`tsc -p tsconfig.e2e.json`) — not folded into the root `tsc --noEmit` because that config's `include` is `src` only |
| `bun run check:web-parity` | Every registered native command has one explicit web/notice/Mac-only decision in `scripts/web-command-parity.json`, with an explanation and existing implementation/test references; included in both lint chains. Fixture tests prove an added native handler fails until classified. Behavior still requires the referenced tests |
| `bun run check:vault-reads` | Every read of a vault file's contents in production Rust goes through the checked open (`fsutil::open_own_file`, `read_own_text`, `read_own_bytes`, `read_own_sidecar`; `containment::open_sidecar`), which refuses a hard link to a file outside the vault on the descriptor the bytes come from. Any other `std::fs::read*`, `File::open`, `OpenOptions`, or tokio read must carry `// raw read (<category>): <reason>`, the category one of identity, outside-vault, import, private-output, dir-sync, counted per file and category against `scripts/vault-read-allowlist.json`; raising a count is a reviewed change. A vault sidecar that holds content is never one of them. Test code and code built only for other platforms are out of scope; included in both lint chains, with fixture tests |
| `bun run check:prompt-brands` | Reads `src/` with the TypeScript compiler (syntax and types, not text) and refuses what the prompt brands (`src/lib/promptText.ts`) can't on their own: a cast or a type guard that makes a brand outside its owner (through any alias, or to a type holding one), an `any` flowing where a brand is expected, `prompt` called rather than used as a tag, `fixed` on anything but a literal, a reshape whose change ignores its text, an open constructor (`personText`, `modelText`, `externalText`, `reshape`, `reshapeAsync`) used by a module or for a constructor `CONSTRUCTOR_USERS` doesn't list (by resolved symbol: renamed and namespace imports and re-exports count), test support imported outside tests, `satisfies` claiming a brand the value lacks, a brand-typed default parameter from `any`, an `any` anywhere inside a `promptJson` value (the whole value is walked once, and a value too large to walk counts as holding one), an overload claiming a branded return, `@ts-ignore`/`@ts-expect-error`/`@ts-nocheck` outside tests, a `.d.ts` under `src/` naming a brand, and JavaScript under `src/`. It stops accidental misuse; it isn't a proof against code written to get around it. What it doesn't catch: a branded value overwritten through a wider view (`Reflect.set`, `Object.defineProperty`, or a cast to `Record<string, unknown>` or `unknown[]` followed by a write), declaration files outside `src/`, and code outside `src/` the app imports. Included in both lint chains, with negative fixtures for each bypass the fourth, fifth and sixth reviews found |
| `bun run check:owners` | One owner per decision, for the classes the sixth and seventh reviews of pull request 267 kept finding (`scripts/check-owners.mjs`): an editor buffer is replaced or declared saved only by `src/editor/buffers.ts` (`seed`, `edit`, `adopt`); by resolved symbol with the TypeScript checker (so a renamed or namespace import is caught), the generation ledger's writers and `setDirty` are used only by `buffers.ts`, and the buffer's writers (`adopt`, `recordLanded`, `seed`, `edit`, `forget`, …) only by `model.ts` and `saveQueue.ts`; the buffer's view is frozen and read-only, and a cast of it is refused; a turn's protection travels with the turn (no `markedConversation`, settlement reads only the turn's `protection`, the chat surface reads its live mark only where a turn captures it); and frontmatter is matched only by `src/lib/frontmatterBlock.ts`, with the listed exceptions and their reasons. Fixtures in `scripts/check-owners.test.ts`, including the seventh review's four bypasses |
| `bun run test:write-lane` | The editor's real save queue and native adapter (`services/fsNotes.ts`, through the Tauri invoke seam) against the production Rust store on a temporary vault, headless (`src/editor/realWriteLane.lane.ts` drives the ignored Rust test `write_lane_harness` over stdin). It can hold an IPC call before Rust sees it, make Rust sleep before the store call (`delayMs`, test-only: the dispatcher is compiled only under `cfg(test)`, and it answers one request at a time, as the registry mutex does), and lose an answer after Rust did the work. 14 scenarios plus one test that the harness answered every command: the original overlapping saves, three overlapping saves, a retitle and a move while a write is queued, a conflict with typing during its copy (one copy), a write whose answer was lost, a write past its bound then undo, an honest write slowed inside Rust, a create that answers with what it wrote while another writer gets in right after, a secure copy found again in the secure home after a lost answer, a read that never answers, a conflict copy whose answer was lost, a locked note's copy, a deleted note's words, and a secure note's copy. The last step of `bun run verify rust`. Not shown by it: two windows writing one note, slow storage below Rust's own calls, real contention on the registry mutex, the watcher's two-second suppression after Rotli's own write (`corpus.rs`, `corpus_watch.rs`), and native paint, window events and the quit dialog. `scripts/fixtures/write-lane-contract.json` keeps the unit tests' fake (`src/editor/writeLane.fixtures.ts`) to the same contract as the store, creates included (routing a secure note to the secure home, one note per recovery event): both run it |
| `bun run test:explore` | The save-state explorer at full depth (`src/editor/saveExplorer.test.ts`; its world and invariants are in `saveExplorer.fixtures.ts`): the real `model.ts`, `saveQueue.ts`, read numbering (`services/noteReads.ts`) and each window's quit answers (`lib/quitFlush.ts`) on the fake that follows Rust's contract. Every read, write, create, file-change notice and query answer is held until a move releases it (a write or create can also fail, land and then fail, land while its answer is still on its way, or never settle), and a clock moves only when a move advances it. Quit is played as Rust's coordinator does (`src-tauri/src/quit_flush.rs`): main's flush, another window's flush answer, then each window's immediate answer, each a move, with typing and everything else legal between them until the last answer. Moves: type, undo, switch note, close the tab, another app changes the file (with a notice, or unnoticed while the watcher is quiet after Rotli's own write), deletes it or puts it back, a query reads now and answers into the note's cache entry later (a refetch cancels the same query's fetch still on its way), the editor's effect taking what that entry holds (a step of its own, after any publish into it: a query's answer or a save's), Discard, quit, and the acknowledgements and the clock; at every step it also checks what any order of the writes already handed to the disk would leave if the process died. Invariants I1 to I5, stated in the fixture's header with exactly what is forgiven (the one merge case, and only on a version that was taken in) and exempt (a write that never settles while the note says so; a deleted note with words, until discarded; words typed after main's immediate answer, the residual it counts). Seven scenarios, every schedule up to depth 7 to 11 (about 4.5 million schedules), and 20,000 seeded walks of up to 70 moves over three notes (caps: type 5, undo 3, outside 3, unnoticed 1, purge 2, restore 1, refetch 3, switch 3, close 2; three faults; seed 20261111); about 12 minutes. The unit suite (`verify quality`) runs the same scenarios at depth 6 to 9 (about 220,000 schedules) and 500 walks, in about 30 seconds. A failure prints its shortest schedule as a `replay(…)` for a plain test (`saveSchedules.test.ts` holds the seventh to tenth reviews' findings); a walk prints its seed (`EXPLORE_SEED`); `EXPLORE_ONLY="name|name"` runs only those scenarios. What it can't show: CodeMirror and React delivering input and reads to the model (a file-change notice still hands its read straight to the editor; only a query's answer and a save's publish go through the cache), native shutdown beyond the modelled answers, more than one window holding notes, Rust's multi-step operations (the fake's are atomic), the watcher's own two-second suppression (modelled only as the unnoticed change), and real contention on Rust's registry mutex |
| `bun run explore:at <commit> [--full] [--scenario "<name>"]…` | Today's explorer against an older commit, so a "before" can be re-run (`scripts/explore-at.ts`): it rebuilds the commit in a temporary folder outside the repository, links node_modules, copies in the current explorer and fake disk, applies the compatibility shims recorded for that commit in `scripts/fixtures/explorer-shims.json` (each says what it stands in for), runs the scenarios, prints every distinct failure with its shortest schedule (or, when nothing ran, why), and removes the folder. Recorded for 1880e044 and c9601494; both fail all eight runs |
| `bun scripts/check-web-ai-rows-mutation.mjs` | Copies `src/` to a scratch folder, plants a row spread from a stale summary or hit in `services/webAiCorpus.ts` there, and requires `services/webAiCorpus.test.ts` to fail on each mutant and pass unmutated. Run by the tooling lane (`scripts/check-web-ai-rows-mutation.test.ts`) |
| `bun run check:ratchets` | Numbers that only move one way (`scripts/ratchet-baseline.json`): per-file line ceilings for every source file at or above 600 lines, the count of source-string test assertions, dated provenance comments, and per-directory test-coverage floors (the recorded ratio is the floor once it sits above the 0.40 constant — coverage may only rise). The source-shape number counts `toContain`/`toMatch` assertions inside files that read source text, not the reads. Lower a ceiling with `--update`; never raise one. The checker has its own fixture tests (`scripts/check-ratchets.test.ts`, as do `check:window-events` and `check:code-shape`) |
| `bun run check:window-events` | Every `rotli:*` / `private-browser-*` event literal in `src/` and `src-tauri/src/` has a row in `docs/architecture/window-events.md` and is wired on a sending and a receiving side |
| `bun run check:web-privacy` | Rotli Web's no-egress rule: the `/app/` Content-Security-Policy in `site/Caddyfile` may reach only `http://127.0.0.1` (`connect-src`) and names no other host in any directive; `form-action` and `frame-ancestors` stay `'none'`. Fixture tests in `scripts/check-web-privacy.test.ts`; the E2E twin is `e2e/web/rotli-web-privacy.spec.ts` |
| `bun run check:dup:gate` | The duplication miner's cluster count as a ratchet (`ratchet-baseline.json` `dupClusters`); `bun run check:dup` alone stays the advisory report |
| `bun run check:breve-runtime` | Bundle every runtime entry point, strict-typecheck the runtime (`tsc -p breve-runtime`), validate shell syntax, and verify scheduler/delivery wiring |
| `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` | Rust lint gate — warnings fail CI |
| `bun run test:regression` | All Bun behavior tests plus Breve runtime and design-system checks |
| `bun run check` | Required JavaScript/TypeScript gate: lint plus the regression suite |
| `bun run verify` | **The local twin of CI.** Runs the Regression suite's lanes in its order — redacted proposed-source secret scan, `check`, the production build, and the three `site/` steps; `check:e2e-types` plus Playwright; `cargo clippy -D warnings` plus `cargo test`. Takes lane names to narrow it (`bun run verify rust`). `bun run check` alone is *not* the CI gate: clippy, Playwright, and every `site/` step live outside it, which is how a change can pass locally and turn `main` red. Excludes only the advisory dependency audit and the signing/notarization steps `release.sh` owns |
| `cargo test --manifest-path src-tauri/Cargo.toml` | Rust host, filesystem, security, scheduler, and IPC behavior |
| `NODE_OPTIONS=--max-old-space-size=4096 bun run build` | Production bundling, final TypeScript/runtime validation, and tested startup/lazy chunk budgets |

With no lane arguments, `verify` runs all four lanes. Unknown lane names fail
before any checks or installs; a misspelling cannot produce a passing run.

Both Playwright lanes start their own server and refuse an occupied port, so
verification cannot silently exercise another checkout. The desktop twin uses
1420 (`ROTLI_E2E_PORT` overrides it); Rotli Web uses 1435
(`ROTLI_WEB_E2E_PORT` overrides it). In a worktree, select free ports for both:
`ROTLI_E2E_PORT=1458 ROTLI_WEB_E2E_PORT=1459 bun run verify`. Do not stop a
server owned by another checkout.

Development, formatting, and release commands (`check:docs` verifies this map
stays complete — every `package.json` script must appear in this document):

| Command | Purpose |
|---|---|
| `bun run deps` | Repository-owned Bun 1.4 dependency workflow over the app, site, and Breve lockfiles: `audit`, `audit-plan`, `dedupe-check`, `prune-plan`, `licenses`, `licenses-check`, and root-explicit `diff` are read-only. `licenses-check` fails on either a new Unknown-license package or a stale reviewed baseline entry. Reviewed maintenance uses `audit-fix`, `dedupe`, or `prune` with one explicit `--root` and `--apply`; audit repair never implies `--latest`. `ROTLI_BUN_DEPENDENCY_BIN` may point at a compatible alternate binary for isolated validation without changing the release toolchain |
| `bun run dev` / `bun run preview` | Vite dev server against the seeded demo corpus / preview of the built bundle |
| `bun run capture:launch` | Validate stable Home/Chat/Breve visibility, the Welcome folder in Main, and the task toggle plus Aa raw view in a fresh browser context; retain synthetic screenshots/video under ignored `_review/launch-captures/`. Requires a local stable preview; no native or network proof |
| `bun run capture:hero` | Record the earlier web cut of the landing hero's film (the hero now plays the native Mac tour; this never overwrites it) from a running local Rotli Web (`ROTLI_BUILD_CHANNEL=stable bun run dev:web`; pass another `/app/` URL as the argument): a fresh origin-private vault with synthetic filed notes, real clicks with a drawn pointer, chat answered by a fake Rotli Helper with scripted model text over the app's real search and reads; writes the film (H.264 1920×1080), a WebP poster, frames, caption plates, and six review frames only under ignored `_review/hero-video/`. Fails if the note written on camera is not Markdown in the vault or the film is over 6 MB; `site/README.md` ("Films") owns what is fixture |
| `bun run audit:grammar` | Grammar render audit against a local stable browser twin: seeds the Welcome folder, renders the lesson notes, types every documented control expansion into the welcome note, clicks the rendered controls, reads the source back through Aa → Raw markdown, and proves the stable Mermaid workspace offers View and Code only; report and screenshots under ignored `_review/grammar-audit/`. Synthetic data only; no native or network proof |
| `bun run test:e2e:web` | Rotli Web's Playwright lane (`playwright.web.config.ts`, specs in `e2e/web/`): builds the web bundle, serves it under `/app/` with `vite preview`, and proves setup can't be skipped (a vault is required), both roads to a vault — the live folder (OPFS stands in) and Rotli Helper (a fake on the loopback route) — write real files, reloads and hard refreshes keep every edit, a lost connection is a reconnect screen, and the page never requests anything but its own files and `127.0.0.1` (`rotli-web-privacy.spec.ts`). Headers are proven by the site's Docker prod twin, not here |
| `bun run test:e2e:site` | The website's Playwright lane (`playwright.site.config.ts`, specs in `e2e/site/`): builds `site/` in full mode, serves it with `astro preview` on port 4392 (`ROTLI_SITE_E2E_PORT` moves it), and proves the interactive pages: the hero's platform line, the cardless before/after, the privacy passage in and out both ways (header included), the footer scene's leaf carried by mouse, finger, and keyboard and its reduced-motion rest, the 404 game's Play/jump/pause/fall/replay with the way home untouched, and the resource reading meter (0% to 100% over the article, pinned, following the table of contents, hidden when the article fits). Not yet part of `verify` or CI; the rules behind it run there as `scripts/site-interactions.test.ts` |
| `bun run dev:web` | Rotli Web with hot reload at `http://localhost:1437/app/` (the web platform, the `/app/` base). No security headers: the site's Docker prod twin is the rehearsal for those |
| `bun run build:web` | Build the Rotli Web bundle (`ROTLI_WEB_BASE=/app/`, `ROTLI_PLATFORM=web`): the desktop `build` minus the Rust/Breve contract check, used by the `app` stage of `site/Dockerfile` |
| `bun run build:social-card` | Render the site's editable Open Graph SVG (fonts and the quokka inlined, external requests blocked) into `social-card.png` (1200×630, Open Graph/Twitter/iMessage/Slack) and `social-card-github.png` (1280×640, the GitHub repository social preview) |
| `bun run build:brand-images` | Render the per-page link cards (`site/public/og/`), every blog post's thumbnail (`site/public/thumbs/blog/`, webp), and the X/LinkedIn/GitHub/YouTube banners, profile pictures, and thumbnails (`brand/assets/`) from the SVG templates in `scripts/brand-images/`, failing on clipped text, text over the art, or title/line colors under 4.5:1 on the solid warm ground (text over the pattern, sea, sand, or underline is not sampled; check the contact sheet); writes a contact sheet to `_review/brand-images/` (`--thumbnail "Title"` renders one thumbnail) |
| `bun run build:app-icons` | Redraw the macOS app icon family from `src/assets/characters/_logo.svg` on Apple's 824-on-1024 grid: the bundle `src-tauri/icons/icon.icns`, the Dock variants in `src-tauri/icons/variants/`, and the Settings thumbnails in `src/assets/appIcons/` (macOS only; uses `iconutil`) |
| `bun run build:companion-showcase` | Render the landing page's companion carousel (webp slides + `showcase.json`) from the app's own quokka art and placement rules |
| `bun run capture:site` | Capture the Warm Light workspace for the social card (`site/public/rotli-app-warm-light@3x.png`) and the Welcome folder's Tasks lesson in Main (`site/public/rotli-playground@3x.png`) at 3× density from a running local browser twin; the theme studio's `site/public/themes/` captures are a separate set it does not touch; `site/README.md` owns media regeneration and visual review |
| `bun run dev:app` | The native desktop development app, branded `Rotli (Dev)` with a fixed blue Rotli Dock icon applied by the Rust shell at launch (including an optically matched safe area for the unbundled `tauri dev` runtime); it uses an isolated `corpus.dev.json` vault selection, keeps the production fallback read-only, and supervises vault-triggered Tauri/Vite restarts from the terminal |
| `bun run dev:uat` | `dev:app` built on the public (`stable`) channel — the UAT pass before promoting to `main`: every feature a release gates off (`LAUNCH_FEATURES` in `src/lib/featurePolicy.ts`, `feature_policy.rs`) is absent, exactly as in a published build — Breve, agents/MCP, Mermaid visual editing, read-aloud (Sheets ship in both channels as Beta). Every development guard stays on (they key off `import.meta.env.DEV` / `debug_assertions`, not the channel): the isolated `corpus.dev.json` vault, the read-only production fallback, no update check, no scheduler. Switching between `dev:app` and `dev:uat` rebuilds the Rust shell once (`build.rs` reruns on the channel) |
| `bun run format` / `bun run format:check` | oxfmt write / verify with the explicit repository config over TypeScript in `src`, `e2e`, `scripts`, and `services`, plus `playwright.config.ts` and `vite.config.ts`, with import sorting on (`breve-runtime` keeps hand-aligned tables and stays outside). `format:check` rides the `lint` chain |
| `bun run typecheck` | The TypeScript compiler over the app, Vite/build policy, tooling scripts, and relay configurations (`tsc --noEmit` — `typescript@7`, the Go port). E2E has `check:e2e-types`; the compatibility compiler also checks Breve. These checks run in the `lint` fan-out |
| `bun run typecheck:tsc6` | All six configurations (app, Vite/build policy, tooling scripts, E2E, Breve, and relay) checked on `typescript6` (`npm:typescript@~6.0.3`, the last JavaScript TypeScript) — the independent second implementation, not merely a slower one. It is part of `lint` and is called by explicit path because `typescript@7` owns `node_modules/.bin/tsc` |
| `bun run lint:oxlint` | The oxlint layer alone (`src`, `e2e`, `scripts`, Breve, the relay, and the root Playwright/Vite configs; oxlint's `correctness` category plus the hand-picked rules). Type awareness and a zero-warning ceiling live in the root config, nested configs are disabled, and an executable contract test proves `oxlint-tsgolint` actually reports a typed promise violation — part of `lint` |
| `bun run check:react-compiler` | Runs Oxlint's React Compiler analysis in lint-only mode. The per-file/category baseline is a ratchet: existing effect/ref debt may shrink, while any increase fails `lint`; no compiler transform enters the production build |
| `bun run check:knip` | Dead-weight gate — unreferenced files, exports, and dependencies, plus undeclared imports and binaries (`knip.json`); part of `lint`. Never spell an absolute binary path inside Bun's `$` template shell: knip parses the first token as a binary and resolves it against the **local** filesystem, so a macOS-only path is green on a developer Mac and red on Linux CI. That asymmetry cost #118→#120 a red `main`; resolve the binary through a variable instead, the way `breve-runtime/scripts/chrome-pdf.ts` does |
| `bun run check:dup` | Advisory duplication miner over `scripts/dup-judgments.json` — run on demand, deliberately not a gate |
| `bun run build:mac` | Local signed `.app` bundle (predmg clean + `tauri build`) |
| `bun run release` | `scripts/release.sh` — gate, sign, notarize, staple, publish; only under an explicitly authorized release |

`bun run dev:app` may display the production-selected vault as a read-only boot
fallback, but that fallback never counts as a development selection. Creating
or opening a vault writes only the isolated `corpus.dev.json` binding; after the
clean relaunch, that explicitly selected folder is writable and supports the
same new/open/link/switch flows as the installed app. Production's `corpus.json`
is not repointed. Linking another vault mounts it live and preserves every
development root in `corpus.dev.json`; it does not require a restart marker. A
deliberate primary-vault switch writes one exact temporary restart
request and exits the CLI-owned debug child; the `dev:app` supervisor starts a
fresh Tauri generation instead of leaving a detached executable behind.
Development-only window state stays in the app cache, and
live delivery tests remain disabled. Treat manual interaction with a selected
development vault as real filesystem interaction.

Use the smallest focused command while iterating, then run the canonical
`bun run verify` handoff from `AGENTS.md`. Never point an automated test at a live memex,
Keychain, scheduler, daemon, or production delivery account.

The headless workspace suite lives under `workspace::tests` in the Rust host.
It uses a fresh temporary corpus—not production `corpus.json`—and covers note
creation/read/update, Main references, secure and locked refusals, stale
revision conflicts, Markdown title/frontmatter rules and document metrics, and
compact Excalidraw actions. `rotli agent self-test` is the supported manual
CLI/MCP smoke: it creates and removes its own temporary memex and reports
`liveWorkspaceMutated: false`. Any ad hoc smoke must still set
`ROTLI_CORPUS_ROOT` to a disposable directory.

## Evidence by layer

- **Domain:** pure policy tests with tables of valid, invalid, boundary, and
  recovery inputs. No React, Tauri, filesystem, network, or provider process.
- **Application:** use-case tests with injected ports and in-memory fakes. Cover
  ordering, refusal, retry, and partial-failure behavior.
- **AI eval:** deterministic offline cases for routing, tool-loop behavior,
  capability policy, prompt framing, retrieval ranking, and memory workflow.
  Never call a live provider from the required suite.
- **Adapter:** real codec/package round trips or host-contract fixtures. Assert
  preservation and failure behavior, not a vendor implementation detail.
- **Composition:** mechanical wiring checks prove that the intended adapters,
  locks, trust boundaries, and command registrations are actually connected.
- **Presentation:** visible state and keyboard tests cover loading, empty, error,
  saved, disabled, destructive, and narrow-window behavior.
- **Regression (browser E2E):** Playwright specs under `e2e/` drive the SAME
  browser twin every other layer targets — `isTauri()` is false under `vite
  dev`, so the app renders against the seeded in-memory demo corpus
  (`src/services/notes.ts`) with no Rust shell or real
  filesystem/network/Keychain access. Reserved for interaction sequences a unit
  test can't exercise — real pointer-drag gestures (`src/lib/pointerDrag.ts`),
  multi-step gestures crossing components, and cross-surface wiring a mocked
  DOM would paper over. Chromium only; it proves DOM/pointer behavior, not
  native titlebar, menu-bar, or OS-level drag.
- **Native/live:** a separate, explicitly authorized check for titlebars,
  filesystem permissions, Keychain, updater, scheduler, and real delivery. It
  supplements automated coverage and is never silently treated as CI evidence.
  The browser twin can render the vault navigator's loading, empty, error,
  disabled, keyboard, and narrow-window states, but only Rust adapter tests and
  a disposable native folder prove Home containment, hidden/file/symlink
  exclusion, short-lived authorization, and macOS bookmark recovery after a
  move. Never point that native check at a live vault.

### What quit guarantees, and what it doesn't

Quit, restart, a vault switch and a folder-window close run one two-phase
attempt (`src-tauri/src/quit_flush.rs`; the contract is in
`docs/architecture/memex-data-contract.md`): every window flushes, then every
window answers at once whether any note is unsaved, and any yes keeps Rotli
open, naming the note. The coordinator's tests (`quit_flush_tests.rs`) and the
explorer above cover that. Known gaps, each marked as already in 1.9.1 or new
in pull request 267:

- **Only notes are asked about (also in 1.9.1).** The phase-2 question covers
  note buffers only (`src/editor/model.ts`, `quitReasons`). A workbook,
  document, board or settings change made while or after its own flush ran
  isn't seen (`src/sheets/session.ts`), so quit can go ahead with it unsaved.
  The two-second bound on what remains describes note buffers only: a paste
  or drop still completing, a window opened after the participants were
  listed, and a vault switch's own work after the check are outside it.
- **A deleted note in a Quick Note or folder window can't be resolved there
  (new in pull request 267).** Copy the words / Discard live in the notice
  in main's sidebar only, though the editor's message points at them
  (`src/editor/editorSurface.tsx`), so quit keeps refusing from that window
  until the file is restored.
- **A conflict notice made while quitting can be lost (new in pull request
  267).** It is saved by the ordinary 500 ms settings debounce, which the
  exit can beat, and a notice made in a secondary window never reaches main's
  settings writer (`src/state/persist.ts`). The copy itself is safe on disk.
- **"Open the copy" clears the notice before the copy is open (new in pull
  request 267).** A copy deleted or moved meanwhile loses its pointer
  (`src/components/sidebar/goneNotesNotice.tsx`), and notices have no cap.

What the explorer doesn't show here: its depth was lowered in the ninth
review's round (to 7 to 11, from deeper runs), so three earlier witnesses now
exceed the search and run only as replays in `saveSchedules.test.ts` (the
14-move slow-write and undo schedule, the 11-move deleted-note schedule, and,
in the bounded run, the 9-move restoration schedule). Its quit model has no
window-opening move, no second quit or close request, and no second window
holding notes (the coordinator's own tests cover those). Only a query's
answer and a save's publish reach the editor through the cache; a
file-change notice still hands its read straight to the editor. And
`bun run explore:at` gives old commits artificial phase-2 steps and bypasses
c9601494's typing lock (`scripts/fixtures/explorer-shims.json`), so "8 of 8
scenarios fail" on an old head counts scenarios, not eight separate
regressions.

### Performance regressions

`src/services/folderNotesCache.test.ts` counts document parses across indexing,
listing, search and reads, and checks invalidation after external and app edits.
The derivation and search suites retain Unicode snippet boundaries and the
Rust-compatible per-code-point case-folding rules while their fast paths change.
`e2e/main-row-rendering.spec.ts` uses the dev React profiler's host-row fields
through its DevTools hook to limit Main note-switch commits to the changed
rows, while keeping every synthetic row mounted and checking keyboard navigation.
Timing measurements are descriptive, not wall-clock assertions in CI.

### Automated accessibility

`e2e/accessibility.spec.ts` and `e2e/web/rotli-web-accessibility.spec.ts` run
whole-document axe scans with synthetic vaults. They cover the note shell,
Main, system views, search, the item chooser, settings, all fourteen theme
environments, the development Graph, the Canvas creation refusal, and Web's
live Excalidraw board. Moderate, serious and critical violations fail the lane; full
JSON results are attached for review. Checks wait for fonts and finite
animations to settle, without disabling rules or excluding components.
Keyboard regressions cover tab navigation and modal focus containment.

Run them through the normal desktop and Web Playwright lanes. These automated
checks do not prove VoiceOver behavior, native windows, or every possible
content/contrast combination; retain human assistive-technology review.

### The Playwright layer

`e2e/` holds the browser regression specs; `playwright.config.ts` (repo root)
boots `vite dev` and runs chromium against it. `e2e/support.ts` holds the
shared helpers — `gotoApp`, and `pointerDrag`/`edgePoint`/`centerOf` for the
app's one pointer-drag gesture (real mouse events, not HTML5 DnD, because
HTML5 drag is dead in the macOS WKWebView shell the app ships in and the app
never listens for it).

Selectors prefer the roles/`data-*` attributes the surfaces already expose
(`role="tab"`, `data-tab-id`, `data-note-id`, `data-main-id`, `data-cap-id`,
…) — read the component before writing a selector, and add a `data-testid`
only when nothing stable exists. The seeded demo corpus
(`src/services/notes.ts`) is deterministic across page loads, so specs assert
on its known titles rather than minting fixtures.

A drag's source and drop target can end up in the SAME scroll container (the
sidebar). Scrolling one into view can scroll the other back out — the fix is
either a taller `test.use({ viewport })` or collapsing unrelated accordion
sections first, never a blind wait. The app has no drag-to-edge autoscroll, so
if a real user couldn't reach both ends of a drag in one gesture without
resizing/collapsing first, neither should the test.

The interaction specs are the regression-layer handoff from
`docs/architecture/code-audit.md` ("Regression-layer handoff"): tab reorder
(the CMP-1 visual-index contract, `src/state/panes.test.ts`'s real-gesture
twin), the sidebar's own cross-section-into-Main drag, Board (Captures) card
reorder, and the shared `src/lib/mainAddDrag.ts` module's Main-add drag from
an All-notes row — two different code paths land a note in Main, so both are
covered separately. `e2e/mermaid-workspace.spec.ts` proves the Mermaid
View/Visual/Code workspace, real pointer pan, zoom state, source-backed
flowchart shape/color/connection editing, dirty-close guard, lossless refusal
for unsupported syntax, the slash starter, browser-mode conversion refusal,
and the real converter seam. The Main
creation-context spec then proves that opening a
Main reference and pressing Command-T creates a new tab and an immediate Main
reference while storage remains in the intake lane. The named-view spec proves
inline view creation, active-view Command-T routing, right-click assignment,
and the invariant that the same item remains visible from global Main.

## Change proof matrix

| Change | Evidence required before the full gate |
|---|---|
| Bug fix | A failing reproduction first, then a focused invariant test that fails if the bug returns |
| Feature | Happy path, refusal/failure state, and meaningful boundary cases at the lowest useful layer |
| AI/model behavior | Focused unit coverage plus a deterministic case in `test:evals`; no live-provider dependency |
| Cross-surface gesture or keyboard flow | Focused policy tests plus Playwright when component-local tests cannot prove real wiring |
| Architecture, syntax, security, or documentation law | A deterministic checker and a checker fixture proving the forbidden case is rejected |

Run oxfmt and the smallest type/test/check target while editing. For handoff,
`bun run verify` runs the full proof chain. Its `check` phase reruns TypeScript,
`format:check`, oxlint, mechanical contracts, the Bun suites, named evals, and
runtime/design regressions; builds, site checks, Playwright, clippy and cargo
tests are additional verify phases.

## Regression rules

1. Reproduce a bug with a failing test or deterministic checker before relying
   on a manual confirmation.
2. A feature covers its happy path, at least one refusal or failure state, and
   the boundary conditions that define the behavior.
3. Put policy in a pure module and test it there; test the adapter and composition
   only for translation and wiring.
4. Concurrency regressions must exercise separate OS processes when process
   ownership is the behavior under test. Mocked PIDs alone are insufficient.
5. External delivery tests stop at the claim/receipt boundary. CI never sends
   Signal messages, email, model requests, or watcher traffic.
6. A delivery claim is acquired before an external send and becomes a durable
   receipt only after success. Tests cover contention, completed delivery, stale
   owner recovery, and retry behavior.
7. Every fixed incident updates its owning contract and, when user-visible, the
   changelog. Test names describe the invariant that must not regress.

## Mechanical code checks

- `check:code-shape` rejects production import cycles, focused or skipped tests,
  production imports of test code, and hidden `@ts-ignore`/`@ts-nocheck` errors.
- `check:react-compiler` runs the compiler's Rules-of-React analysis without
  enabling the build transform. Its measured per-file/category baseline can
  only stay level or shrink, so new synchronous effect updates, render-time
  impurity/mutation, unsafe ref access, or suppressions fail mechanically.
- `check:architecture` discovers clean feature roles and enforces inward role
  dependencies, pure ports/policies, the Tauri adapter boundary, and the
  Markdown-only slash-command boundary.
- `check:structure` enforces per-tree file/folder naming and dependency
  invariants, including Bun v2 lockfiles, script-free isolated installs,
  parallel lint and CI dependency-evidence wiring, and the SheetJS/`xlsx` ban
  (the exceljs codec owns every spreadsheet path).
- `check:naming` holds the identifier-casing contract over `src/` (variables
  camelCase/UPPER_CASE/PascalCase with leading-underscore discards and dunder
  build globals exempt; type-likes PascalCase; no I-prefixed interfaces) —
  the former typescript-eslint `naming-convention` rule, which oxlint does not
  implement.
- `check:ipc` keeps TypeScript invocations and registered Rust handlers aligned
  in both directions. Every invoked command must be registered. A registered
  command with no caller in `src/` fails unless it is on `UNCALLED_BASELINE`,
  which may only shrink. Command names must be multi-segment snake_case.
- `check:web-parity` keeps the native registry and explicit web availability
  inventory exhaustive in both directions; it rejects missing, stale, duplicate,
  invalid, or unexplained decisions and missing implementation/test references.
- `check:hex` bans raw color literals (hex and `rgb()`/`hsl()` functional forms)
  everywhere under `src/` outside the token-definition layer (`src/brand/`,
  `src/styles/themes.css`; `base.css` may hold functional state tokens).
- `check:design-system` proves all fourteen theme environments define every required semantic token, that
  product CSS consumes semantic roles rather than literal or fixed-palette
  colors, that first-party CSS contains no glow/shadow/filter/backdrop effects,
  that class selectors stay kebab-case (BEM `--modifier` allowed), and that
  every `var(--x)` names a token defined somewhere in `src/` (a missing
  definition with no fallback is a silently invalid declaration; JS-injected
  measure tokens are read with a fallback and listed in the checker).
- `check:parity` guards the TS↔Rust shared-constant fixture harness itself.
- `check:security` is the egress/CSP/keychain/capability tripwire layer
  ([`security.md`](security.md)).
- `check:docs` keeps the AI-context files, CARL wiring, doc links, this command
  map, and the no-orphan-tooling rule (every `scripts/*.mjs`/`.sh` is invoked by
  a package script, sibling script, or workflow; every `check:*` script actually
  runs in some chain) all honest.
- `check:secret-parity` extracts the secret-pattern lists from `src/ai/guard.ts`
  and `src-tauri/src/secret.rs` and fails the moment the hand-synced mirror
  drifts.
- `check:breve-contract` keeps scheduler ownership, parent death, job locks,
  delivery claims, producer locks, and alert idempotency wired end to end.

When a review identifies a repeatable architectural rule, extend the appropriate
checker. Do not add a convention that only exists in prose.

## CI lanes

The `Regression suite` runs four jobs in parallel on explicitly versioned
GitHub-hosted images. Setup, security, and release integration are documented in
[`ci-runner.md`](ci-runner.md). CI receives no signing keys; `release.sh` signs
and notarizes locally. Bun comes from `.bun-version`; Rustup resolves
`rust-toolchain.toml`, so local, CI, and release builds share the same toolchain
inputs.

- **Quality and production builds (`ubuntu-24.04`):** script-free isolated
  frozen installs for the app, site, and production Breve graph; a blocking
  cross-lockfile dedupe check; an exact Unknown-license baseline; a retained
  production-license inventory; `bun run check`; and warning-ratcheted native
  Rolldown/Oxc plus Astro production builds.
- **Browser E2E (`ubuntu-24.04`):** `bun run check:e2e-types` plus the Playwright
  Chromium suite against `vite dev`'s seeded demo corpus.
- **Dependency audit (`ubuntu-24.04`, advisory):** the repository-owned
  `bun run deps audit` scans the app, site, and independently installed Breve
  lockfiles, followed by RustSec. Findings remain visible in the job log while
  the documented transitive-only debt is accepted. Installing the pinned
  scanner is blocking; only its findings are advisory.
- **Native Rust (`macos-15`):** `cargo clippy --all-targets -- -D warnings` and
  `cargo test` against the shipped macOS branches.

`release.sh --publish` requires a successful Regression **conclusion** for the
exact release commit. Missing, pending, and red evidence block; the explicit
`ROTLI_RELEASE_ALLOW_RED=1` emergency escape applies only to a completed red
result. See [`ci-runner.md`](ci-runner.md#how-releases-use-ci).

CI does not prove native visual quality or real external delivery. Handoffs must
state those remaining checks explicitly.

## Launch onboarding coverage

`e2e/launch-onboarding.spec.ts` uses the development-only `?onboarding` route
to begin with an empty in-memory corpus. It clicks the actual setup and folder
controls, creates a simulated empty folder, skips optional model setup, and
checks that Main holds one Welcome folder with the welcome note and nine
lessons and that the welcome note is the open tab. It proves the practice-vault
option is gone, opens every note from the left menu, ticks a task and reads
the state character through Aa → Raw markdown, proves Settings → Open welcome
folder is idempotent, and asserts the checkbox/drag-handle overlap and the
gutter geometry (every checkbox, marker, and control starts on the H1 edge,
never in the margin) across fourteen environments and a 760px window.
`e2e/named-views.spec.ts` deletes a non-active view from Main's picker.
Screenshots are test artifacts. `bun scripts/capture-site.mjs http://localhost:1430`
creates the reviewed site media separately at 3× density; the Welcome-folder
capture is `site/public/rotli-playground@3x.png` in Rotli Light. See `site/README.md` for the
fixed site theme policy and the companion SVG export command.
The route cannot activate in native or production builds. Browser folders and
saved copies are fixtures and reset on reload. Native vault activation, actual
file persistence, and permission failures still require a disposable Mac vault.
