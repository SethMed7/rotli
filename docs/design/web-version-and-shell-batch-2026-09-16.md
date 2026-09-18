# Rotli Web, site fixes, and the shell batch — plan (2026-09-16)

Status: **PLAN** for branch `feat/web-version-and-shell-fixes`. Three
workstreams, in the order they land: (1) the web version served from rotli.co,
(2) site fixes, (3) fifteen shell bugs and enhancements from the owner's
review. Evidence is cited as `file:line` against `7f0ae539` (1.0.0) unless a
commit on the branch is named. Nothing here changes a product law; where a
phase defers one, it says so.

## 1. Rotli Web

### What it is

The same frontend bundle the Mac app runs, served from the marketing site at
`https://rotli.co/app/`, with the user's vault persisted **in their own
browser**. No account, no server-side state, no telemetry. The page's
Content-Security-Policy is `connect-src 'none'`: the browser refuses every
outbound request, which is a stronger and more verifiable statement than the
Mac app can make. That is the product story: "your notes never leave this
tab, and the browser itself enforces it."

### What exists today (measured)

- The frontend already renders without Tauri. `src/lib/tauri.ts:24`
  (`isTauri`) gates 38 files; the E2E suite runs against this "browser twin"
  daily.
- Notes in the twin are an `InMemoryNotesService` behind the `NotesService`
  port (`src/services/notesPort.ts:6`, `src/services/notes.ts:39`). It already
  mirrors the Rust corpus rules the UI depends on: reserved folder ids, the
  three-valued restore origin (`notes.ts:252`), the rename refusal, the vault
  read-only ceiling. It is lost on reload.
- Main and named-view manifests work in memory and skip persistence off-Tauri
  (`src/state/main.ts:59`, `src/state/views.ts:40`). Settings hydration and
  the debounced writer return early off-Tauri (`src/state/persist.ts:1326`,
  `:1613`). Board saves are no-ops off-Tauri (`src/boards/composition.ts:32`).
- Every `corpusInvoke` rejects off-Tauri (`tauri.ts:364`): boards, welcome
  seeding, settings, Main, views.
- **Serving spike (2026-09-16, passed):** `vite build` with `base: "/app/"`
  produces a bundle with no absolute `/assets/` references. Served by Caddy
  under a `handle /app/*` block with its own CSP (`connect-src 'none'`,
  `style-src 'self' 'unsafe-inline'`, `worker-src blob:`), the app loads with
  zero console errors or warnings, the sidebar and welcome note render, and
  unknown `/app/...` paths fall back to the app's `index.html`.

### Product laws: kept, bent, deferred

| Law | W0 | Later |
|---|---|---|
| Local-first; user files are durable truth | **Bent.** The vault lives in IndexedDB, which is browser-private storage, not a folder the user owns. W0 must say so in the app and offer export. | W1 adds "Open a folder on this computer" (File System Access API, Chromium only) so files are real `.md` on disk, and a zip export/import so a browser vault can move into the Mac app. |
| One folder is one vault; Main and views are projections | Kept. Same manifests, persisted beside the notes. | |
| Markdown owns slash commands, wikilinks, fences | Kept; identical editor. | |
| Secure notes: TS and Rust enforce independently | **Deferred.** No Rust half exists; no remote model exists either, so nothing can egress. The `secure:` classification still applies to the Librarian, which is absent. | Revisit if any model lane is ever added to the web build. |
| Locked = no AI edits | Trivially kept (no AI). | |
| Breve is a Rotli capability | Not in the web build; surface says "In the Mac app". | |
| Theme families | Kept; identical CSS. | |
| Nothing writes outside the vault | Kept and strengthened: `connect-src 'none'`. | |

### Phase W0 — served from the site, persistent, honest (this branch)

Status 2026-09-16: items 1 to 4 and 6 to 8 landed and were proven in the
Docker prod twin (first visit seeds and opens Welcome; a typed edit, Main,
settings, and the open tabs survive a reload; console clean under
`connect-src 'none'`). Item 5 is the Settings → General notice. Item 9's
Playwright lane is still to write.

1. **Build knob.** `vite.config.ts` reads `ROTLI_WEB_BASE` (`/app/`) and
   `ROTLI_PLATFORM` (`web` | `desktop`) and injects `__ROTLI_PLATFORM__` the
   way `__ROTLI_BUILD_CHANNEL__` is injected. Landed on the branch.
2. **Platform policy.** `src/lib/featurePolicy.ts` gains the platform
   dimension next to the channel. Web withholds: chat and every model lane,
   Librarian, Breve, agents/MCP, DOCX and sheets, Finder drops and pastes,
   System browser disk views, connected-CLI detection, updater, native
   windows. Each withheld surface shows one calm caption ("Available in the
   Mac app") through the same caption mechanism as `COMING_SOON_CAPTION`, not
   a broken control.
3. **Browser vault (persistence).** One effectful service,
   `src/services/browserVault.ts` (declared in `SERVICE_FILE_OWNERS`), backed
   by IndexedDB through a ~40-line in-house wrapper (no new dependency; the
   lockfile is frozen and release-aged). It snapshots and restores:
   - the `InMemoryNotesService` state (folders, notes, origins) via new
     `export()`/`import()` methods on that class;
   - the Main and views manifests (`state/main.ts`, `state/views.ts` get a
     browser writer where they currently `return` off-Tauri);
   - settings and viewstate through the existing `createPersistDrain`
     (`persist.ts:1580`), with a browser `write` in place of
     `corpusSettingsWrite`;
   - boards are **deferred to W1**: creating one goes through
     `corpusCreateBoard`, which has no in-memory twin, so read/write
     persistence alone would not make boards usable.
   Writes are debounced and flushed on `visibilitychange`/`pagehide` by the
   writer that already exists. Hydration is awaited in `src/main.tsx` before
   first render, beside `hydratePersistedState`.
4. **Seeding.** The demo corpus in `services/notes.ts:360` seeds only when
   `platform !== "web"`. A fresh web vault gets the reserved roots plus the
   Welcome folder through the existing idempotent `seedInMemory`
   (`services/welcome.ts:27`). **First failing test:** reload after editing
   the welcome note must not re-seed over the edit.
5. **First-run explainer.** A one-time card in the web build: where the notes
   live (this browser, this device), that clearing site data deletes them,
   and how to export. Copy follows `DESIGN.md`; no new UI framework.
6. **Serving.** `site/Caddyfile` gains the `handle /app/*` block from the
   spike (own CSP, `X-Robots-Tag: noindex`, immutable cache on
   `/app/assets/*`, SPA fallback). The site's own header block must not leak
   onto `/app/`; the prod twin proves it with `curl -I`.
7. **Docker.** `site/Dockerfile` gains a stage that runs the root
   `bun ci` and `ROTLI_WEB_BASE=/app/ ROTLI_PLATFORM=web bun run build` and
   copies `dist/` to `/srv/app`. Risk: `sharp` (used by
   `scripts/build-character-fills.mjs`) on Alpine/musl; if it fails, the
   stage moves to `oven/bun:1.4.0-debian`. The CSP inline-style guard in
   `astro.config.mjs` scans Astro's output only, so the copied app is not in
   its path; confirm by building the image.
8. **Site.** A `WEB_APP_ENABLED` knob in `site/src/site.ts` that fails closed
   like `SOURCE_REPOSITORY_PUBLIC`. When true: a secondary hero action
   ("Try it in your browser"), a nav entry, and a short section stating what
   the web version is and is not.
9. **Proof.** A Playwright lane against the `/app/` build: create a note,
   reload, the note is there; edit the welcome note, reload, the edit is
   there; a board saves and reloads; the console is clean under the CSP; the
   withheld surfaces show their caption. Plus the Docker prod twin.

### Phase W1 — files you own (started 2026-09-16 PM)

Decisions, per the review before building:

1. **Layout.** A memex vault (a `wiki/` directory): notes are `wiki/**`,
   `archive/**`, `trash/**`; id = frontmatter id; `diskFolderId` = the
   physical directory; `folderId` follows the Rust projection table
   (`wiki/_inbox` and a secure note shelved in Inbox → Captures; sinks →
   Archive/Trash; everything else its wiki path). New notes land in
   `wiki/_inbox` through `composeNote`. A plain vault (no `wiki/`) lists its
   `*.md` as Inbox. `chats/` and the memory lanes are never read. Nothing
   else is in W1.
2. **Frontmatter fidelity.** A TS codec mirrors Rust's four owned keys plus
   `origin`, preserves every other line verbatim in order, and is tested
   byte-for-byte against the demo-seed notes. A web edit changes `updated:`
   and the body, nothing else.
3. **Concurrency.** Revision = the file's mtime and size. A stale write is
   refused (the Mac app may be editing the same folder); `.rotli/main.json`
   and friends follow the same rule through `FolderVaultStore`.
4. **Named views in folder mode are read-only for `view_tag`.** The Mac app
   keeps Markdown `view_tag` lines in step with `views.json` through Rust;
   the web writes `views.json` only, so a view assignment made on the web is
   not mirrored into frontmatter until the Mac app next writes it. Stated
   here rather than half-implemented.
5. **What the browser keeps:** the folder's directory handle, nothing else.
   Permission is per visit: "Reconnect" is one click.
6. **Every browser gets a folder, two ways.** Chrome, Edge, and Arc open it
   live (read and write). Firefox, Zen, Safari, and Brave with its folder
   flag off can only read a picked folder once, so there "Import a folder"
   copies its text files into browser storage and runs the SAME folder
   service over an in-memory filesystem mirrored back on every change;
   "Export vault (.zip)" hands the files back. Brave users are told which
   flag turns the live mode on. The copy says plainly that it is a copy.

Seams: `services/vaultDir.ts` (port + in-memory fake), `lib/frontmatter.ts`
(codec), `services/folderNotes.ts` (the NotesService), `lib/fsaVaultDir.ts`
(File System Access adapter), `lib/folderVaultStore.ts` (`.rotli/` files
behind the vault-store port), `services/webVaultFolder.ts` (pick, remember,
reconnect, forget). Boot: `hydrateWebVault` retargets the live
`notesService` binding when the browser still trusts the folder.

Proof: unit tests over the fake for every rule above; the picker itself
cannot be driven headlessly, so the manual check is against a COPY of a
vault, never the live one.

### Phase W1 — the rest

- "Open a folder" via the File System Access API (Chromium; permission is
  re-asked per visit unless installed as a PWA — measure it). The
  `NotesService` implementation reads and writes real `.md` files; Main and
  views land in `.rotli/` exactly as the Mac app writes them, so the same
  folder opens in both.
- Zip export and import of a browser vault (JSZip is already behind an
  adapter in the documents lane).
- Assets (images) — **done 2026-09-16** (`services/webFiles.ts`, registered
  through `lib/webAiSeam.ts` at boot). A dropped image is stored the way the
  app stores it: a real file under `storage/images/` (the app's one asset
  folder, `create_image_asset`) when a folder is connected or imported (the
  imported copy carries binaries base64 in its snapshot and saves them at
  once, so a storage-quota refusal fails the drop in words), and under
  `asset:<path>` in the browser vault otherwise. Names follow the app's
  `stem-2.ext` rule, compared case-blind (the folder may sit on a
  case-insensitive disk), one import at a time; the app's payload guards
  in the app's order — encoded size bounded before decoding
  (`CHAT_IMAGE_ASSET_MAX_BYTES`), empty refused, bytes must match the
  extension (`lib/fileKind.ts imageBytesMatchExtension`, the twin of
  `corpus.rs image_payload_matches_extension`), raster set only
  (`CHAT_IMAGE_ASSET_EXTS`). A link resolves only to an image path outside
  dot directories (`readableImagePath`), so a note cannot blob `.rotli/`. The note keeps the app's
  portable `storage:` image link, so the same file opens in both, and the
  editor resolves it through an object URL made from the stored bytes
  instead of the asset protocol (`resolveImageSrc` web branch; a legacy
  `Storage/` file still answers). Moves and the zip export carry bytes.
  Chat drops on the web are refused with a notice (the pane accepts the
  drag so the browser never opens the file over the app) until the helper
  carries images; a non-image dropped on a note is refused the same way.
  Proofs: `e2e/web/rotli-web-image-drop.spec.ts` (browser vault),
  `e2e/web/rotli-web-imported-image-drop.spec.ts` (imported copy: saved at
  once into the snapshot, back after a reload), `e2e/web/rotli-web-chat-drop.spec.ts`.
  Not proven end to end: a connected folder's real disk write (the File
  System Access picker cannot be driven headless) and a quota refusal; both
  are unit-tested over the same `VaultDir` port. Still owed: paste (⌘V) of an
  image on the web (`useNativeFilePaste` is desktop-only), and an imported
  copy leaves the folder's existing `storage/` images behind
  (`importableVaultPaths`), so images dropped in the app show as not found
  there; a connected folder (Chromium) shows them.

### Chat on the web: the three shapes (decision pending, 2026-09-16)

Today the web build shows Chat disabled with "available in the Mac app" on
hover and a click to the download. The owner asked why chat cannot simply
work on the web. The models are not in the page: Rotli's chat runs either
an on-device server on the Mac (MLX, llama.cpp) or a connected CLI process
(Claude Code, Codex), and a browser tab can neither spawn processes nor,
by this build's policy, make a network request. Three ways to change that:

| Shape | What it is | Privacy promise | Cost |
|---|---|---|---|
| **Local model over localhost** | The page talks to a model server on the user's own machine (Ollama, MLX) at `127.0.0.1`; browsers treat that as a secure context even from https. Needs `connect-src` opened to loopback only, CORS on the server, and a TypeScript transport for the Ollama/OpenAI wire (the ReAct loop is already TypeScript). | "Nothing leaves this machine." | ~1 week |
| **Bridge to the Mac app** | The Mac app's existing token-gated loopback server exposes chat and the connected CLIs; the page uses it when Rotli for Mac is running. | "Nothing leaves this machine." | ~1 week, after the local-model shape |
| **Hosted Rotli (login)** | The owner's proposal: a per-user cloud workspace with the CLIs installed, the vault synced to it, and a login. Everything works from any browser with no install. | **The files DO leave the machine**, to Rotli's servers — a different product from the local-first Rotli, with accounts, billing, key custody, a threat model rewrite, and sync. | A product tier, not a feature: weeks, plus operations |

**The owner's clarification (2026-09-16 PM): a terminal in the web app
where the user logs into Claude Code, Cursor, or ChatGPT themselves; the
files stay in the user's folder.** A browser cannot run a shell, so the
terminal's process has to live somewhere, and that choice is the whole
decision:

| Where the CLI runs | Files | The login | Install | Fit |
|---|---|---|---|---|
| **On the user's machine, through a small local helper** (the existing `rotli` CLI grown a pty bridge on `127.0.0.1`, token-gated like `rotli mcp --http`; xterm.js in the page) | Stay in the user's folder; the CLI reads them directly | The user's own, in the terminal, as today | One small binary — the same one the parked cross-platform track needs for Windows and Linux | **Recommended.** Keeps the promise, reuses the loopback server, and gives non-Mac users chat before the native app is ported |
| On Rotli's servers, fed per turn from the browser | Stay local; only what a chat turn sends leaves (which goes to the model provider anyway) | The user's own, but the CLI's login token lives on Rotli's server | None | Custody of every user's provider login, plus a relay that sees each frame — the same class of risk as the remote-agent relay, multiplied by a terminal |

**Decision (owner, 2026-09-16 PM): the local helper — and it must not be
the Mac app.** The point of Rotli Web is Windows and Linux without a
native app. So the helper is a **standalone headless binary** for the
three OSes, not the Tauri executable in disguise.

What that means in the code: today `rotli`'s CLI mode is the app binary
running `run_headless_if_requested` (`src-tauri/src/main.rs:6`) before the
GUI. A "Rotli Helper" is a second Cargo bin target over the same library
with the GUI behind a feature flag, so it links no Tauri/WebKit and builds
on `ubuntu`, `windows`, and `macos` runners — the crate already compiles
and passes its tests on Linux. It carries the workspace service that
exists (`rotli mcp --http`, token-gated loopback) plus a pty bridge over a
WebSocket on `127.0.0.1`, and the CLI bridge (`provider.rs`: Claude Code,
Codex, Cursor detection and `cli_complete`).

Phases, each its own branch after this one merges:

1. **Helper binary + install.** Feature-gated headless bin; CI builds it per
   OS through the cross-platform probe; distribution as a one-line install
   (`curl … | sh`, a Windows `.ps1`) or an npm wrapper — the people who run
   Claude Code and Codex already have Node. No app install anywhere.
2. **Terminal in the web app.** xterm.js behind an adapter, a "Connect
   Rotli Helper" step (the helper prints a token and a `rotli://`-free
   loopback URL), `/app/`'s `connect-src` opened to loopback only. The
   terminal's working directory is the connected vault folder, so
   `claude`, `codex`, and `cursor` see the user's files directly and the
   user logs in as they do today. Files never leave the machine; the
   helper writes nothing but its token.
3. **Rotli's chat UI through the helper.** The same `cli_complete` bridge
   the Mac app uses, over loopback, so chat on the web is the real chat,
   not a raw terminal only. The secure-note rules apply through the Rust
   side as on the Mac.
4. **The real corpus over loopback (optional).** With the helper running,
   the web page can use the Rust corpus for the connected folder — search,
   the Librarian, boards — the same code the Mac runs. The TypeScript folder
   mode stays as the zero-install fallback.

Estimate: phases 1–3 about three weeks; phase 4 two to three more. The
hosted shape is off the table for now.

**Rotli Helper, first cut (landed 2026-09-16 evening, branch
`feat/rotli-helper`).** Phase 1 and phase 3 together, without the terminal
(phase 2) — the owner's ask was to use the web chat, and Rotli's chat UI
through the CLI bridge is that. What exists:

- `src-tauri/src/bin/rotli-helper.rs` + `src-tauri/src/helper.rs`: a second
  bin target of the same crate (it links `rotli_lib`; the GUI feature gate
  is NOT done — the binary is fat but standalone; on Linux it needs the
  webkit2gtk runtime library present). Binds `127.0.0.1:43111`, bearer token
  (32+ chars, `~/.rotli-helper/token` mode 0600, printed once as a pairing
  code `port:token`), thread per connection, origin allowlist (rotli.co,
  dev.rotli.co, localhost:1437), Host check, JSON only, bounded bodies and
  connections. Routes: `GET /health`, `POST /rpc` with `cli_detect`,
  `cli_complete` (text only — images are refused so no CLI file tool is
  reachable from a browser-delivered prompt), `cli_cancel`, `chat_models`
  (`[]`). The same `secret::blocked_for_remote` gate runs before every
  completion, in the shared `provider::complete_connected`.
- The page: `src/lib/helperPairing.ts` (pure code parser), `helperClient.ts`
  (the only `fetch` in `src/`, declared in the egress allowlist),
  `state/helperLink.ts`, `services/helperLink.ts` (pair, check, unpair;
  link in the browser vault; registers the AI bridge into the IPC seam),
  `services/webAiCorpus.ts` (the model's view of the browser vault: a note
  in a secure folder or with a secret in its body is withheld from every
  model — the web's twin of Rust's read gate). `chatRuntimeAvailable()` =
  Tauri or paired; Chat, the note chip, the lane guides, and the chat
  surface follow it.
- `/app/`'s CSP: `connect-src http://127.0.0.1:* http://localhost:*`, and no
  `upgrade-insecure-requests` (it would rewrite the loopback URL to https).
  The promise is now "nothing leaves this computer": the page talks to the
  helper, and the helper talks to the AI tool's provider exactly as the
  terminal does.

Honest limits and the Codex threat review's open points (2026-09-16):

| Point | State |
|---|---|
| Browser support | Chrome, Edge, Brave (1.88+), Arc: a "local network access" permission prompt on first pairing. Firefox/Zen: allowed. **Safari refuses an https page reaching http://127.0.0.1**: unsupported. Not yet verified per browser from here. |
| Secure notes on the web | Enforced in TypeScript (`webAiCorpus`): the browser is the trusted side on the web because there is no Rust corpus. Rust's marker scan runs again in the helper. Withheld: a note in a secure folder, a note whose frontmatter says `secure: true` (folder mode reads the flag onto the summary), and a note whose body trips the secret detector. |
| Token boundary | The pairing lives in this browser's own database (never in the vault, so it never rides a `.rotli/` file or an export), scoped to the site origin; marketing-page XSS (`unsafe-inline` allowed there) could read it. Follow-ups: a dedicated app origin (app.rotli.co) and expiring per-origin credentials; `rotli-helper --reset-token` revokes today. |
| Chats persist | Yes, in the browser vault (`services/webChats.ts` answers the `memex_*` chat commands over keys `chat:<slug>`; revision-gated). In folder mode they land in `.rotli/`, not as `chats/*.md` files yet (follow-up: write them through the vault-dir port). Observed 2026-09-16: after a send the Chat sidebar lists the chat twice for a moment (the run row and the saved row); check natively whether the desktop does the same. |
| Note edits by the model | `update_note`/`create_note` through the chat are refused on the web in this cut (they ride `corpus_write_ai`). Reads and search work. |
| Distribution | One line installs and starts it: `curl -fsSL https://rotli.co/helper/install.sh \| sh` (Mac, Linux) or `irm https://rotli.co/helper/install.ps1 \| iex` (Windows). The scripts (`site/public/helper/`) download `rotli-helper-<os>-<arch>` from the releases repository tag `helper-v<version>`, verify the SHA-256 against the release's `SHA256SUMS`, install to `~/.rotli/bin`, and start it. `.github/workflows/helper-release.yml` (manual) builds the four binaries and publishes that tag; it needs a `RELEASES_TOKEN` secret (fine-grained PAT, releases repo, Contents read/write). **The owner must run it once before the installers work for anyone.** The dialog builds the install URL from the page's own origin, and the web dev server (`scripts/dev-helper-server.ts`, dev only) serves the same scripts at `/helper/` with their download base pointed at itself, answering with the helper binary built on that machine — so `curl -fsSL http://localhost:1437/helper/install.sh \| sh` works in development today. Unsigned: curl and PowerShell do not quarantine, so it runs; signing the CLI is a follow-up. Linux needs the webkit2gtk runtime. |
| Terminal (phase 2) | Not started. |
| Listing cost | `webAiCorpus.list()` reads every visible note's body to run the secret detector — one read per note per chat turn. Fine on a small vault; in folder mode over a large vault it is hundreds of file reads. Follow-up: cache verdicts by note revision. |
| Delete and archive | Recoverable: the transcript moves to a `chat-trash:`/`chat-archive:` key and the live key goes away, so the slug can be born again; the chat list is revision-gated with retries so two tabs saving at once both land. No Trash/Archive front for web chats yet. `readVersioned` reads contents and revision separately (a write between them can pair old contents with a new revision); follow-up: one-transaction reads on the vault-store port. |

Proof (2026-09-16 evening): `bun run check` green (Rust: 495 tests, clippy clean, 12 helper
tests over real sockets); `bun run test:e2e:web` 9/9 including `e2e/web/rotli-helper.spec.ts`
(a Playwright-routed fake helper: pair, refuse a bad code, lane guide asks the helper, "Use
Claude Code in chat", send, reply, pairing survives a reload, unpair); and one REAL run: the
release binary on 127.0.0.1:43111, the real page at localhost:1435, pairing code pasted, Claude
Code detected, "What is the capital of France?" answered "Paris" through the helper in 2.8 s,
the chat tab restored after a reload. Running it: `cargo build --release --bin rotli-helper`,
then `./src-tauri/target/release/rotli-helper` (add `--origin http://localhost:PORT` for a dev
server on a port other than 1437; `--reset-token` mints a new pairing code).

**Guided setup (landed 2026-09-16 PM, this branch).** The owner: "when not
set up, clicking chat should walk me through the steps; same for the
connectors — give the install command, say to run it in a terminal, then
to log in." One data module, `src/ai/connectorGuides.ts`, holds each
lane's ordered steps (install → sign in → come back) with the tool's own
official commands per OS, and `stepDone` ticks the steps detection already
proves. One component, `ConnectorGuide`, renders them: numbered, a copy
button on every command, done steps struck through, **Check again** where
Rotli can look (the desktop only; the web never asks the machine). Three
doors show it:

- Settings → AI Models: a lane that is not ready shows the steps open,
  instead of the folded "How to set this up" hint.
- The chat's empty state, when no model can answer, shows the steps for
  each enabled lane plus a door to Settings, instead of a dead send button.
- Rotli Web: the Chat front and the note's chat chip stay visible; a click
  opens **Chat on the web**, which leads with **Install Rotli Helper**
  (honestly marked not released, on every OS — the owner: the Mac app is
  an aside, never the only door), then **Connect this page to the helper**,
  then the lane tabs with the real install and sign-in commands the user
  can run today. When the helper ships, step 1's button turns live and the
  page's `connect-src` opens to loopback (phase 2 above).

### Phase W2 — installable, and a bridge to the Mac

- PWA manifest and service worker (offline, home-screen install, durable
  folder permission).
- **Chat through the CLIs cannot happen from the page alone**: a browser tab
  cannot spawn `claude` or `codex`, and `/app/` refuses every outbound
  request by design. The path is a bridge: the Mac app (or the CLI's
  existing token-gated loopback server) exposes chat, and the page talks to
  `127.0.0.1`, which browsers treat as a secure context even from an https
  page. That changes the promise from "nothing leaves this tab" to "nothing
  leaves this machine" and needs its own security review before it exists.

- PWA manifest and service worker (offline, home-screen install, durable
  folder permission).
- Optional on-device chat through WebGPU. Only if the secure-note gate can be
  enforced in TypeScript alone with evals; otherwise it stays in the Mac app.

## 2. Site fixes

Landed on the branch in `7963b5b8`: theme-studio orbs blank and the 404 page
unstyled under the production CSP (colours moved to `data-orb` rules,
stylesheets never inlined, build fails on any inline style); richer link
preview (quokka social card, Open Graph dimensions and type, PNG icons, a
GitHub-sized export). Remaining site work in this batch is the web-app entry
point above (W0 items 6 to 8).

## 3. Shell bugs and enhancements

Sixteen items from the owner's list. Each landed with its tests and a
`CHANGELOG.md` line, in commit clusters so the branch can be split into
pull requests later. The table is filled from the code map below.

### Review on both twins (2026-09-16 evening)

The owner asked for every bug to be reviewed in the app and in Rotli Web.
"App" below is the desktop browser twin plus the shared code the Mac app
runs; "Web" is `bun run test:e2e:web` (browser vault) and, for the vault
files, `e2e/web/rotli-web-imported-sync.spec.ts`. Native-only proofs (Finder
drops, real files) still need the Mac app in hand.

| # | Bug | App | Web |
|---|---|---|---|
| 1 | Delete a folder | Done for Main folders (`shell-batch` spec). Real Library directories still need a Rust command. | Same code; Main folders are `.rotli/main.json` in both. Not separately run (the web seeds no demo corpus). |
| 2 | Drop image into a note | **BROKEN on macOS 26.5.1 (owner test 2026-09-17): no native drag event reaches Rust at all — not Finder, not a screenshot thumbnail.** Diagnosis below (§ Native drops on macOS 26). The promise/bytes lane (`native_drag_promise.rs`) is correct but never invoked. | Done: the image is stored in the vault (folder or browser) and the note keeps the app's `storage:` link (`rotli-web-image-drop.spec.ts`). |
| 3 | Drop image into a chat (hover cue + `#n` chips added 2026-09-17: `chatDrop.ts` marks the hovered pane with `data-drop-over`, memex.css draws ring + label; `chatImageRefs.tsx` renders `[Image #n]` as chips; both twins, `e2e/chat-drop-cue.spec.ts`) | Same native break as #2 (no event arrives). Owner's target behaviour: drag over the chat → land as an attachment when the current model can see images, else a modal error. | Refused with a notice: Rotli Helper carries text only, so the drop says to use a note instead. |
| 4 | Trash back button | Done (`system-back-and-restore`). | Done — the same spec passes against the web build. |
| 5 | Restore to the original place | Done: the Main slot survives Trash/Archive. | Same code. |
| 6 | Captures → Make a note | Done (`captureMerge.test.ts`). | Same code. |
| 7 | Captures select all | Done (`range-select`). | Same code. |
| 8, 9 | ⇧-click ranges (Captures, Main, System) | Done (`range-select`). | Same code. |
| 10 | Restore inside a trashed note | Done (header chip). | Same code. |
| 11 | Back for Library/Assets/Archive | Done. | Done — passes against the web build. |
| 12 | All notes global + view tag | Done (`shell-batch`). | Same code. |
| 13 | Wrapped-list alignment | Done (2026-09-17, PR #13): the checkbox is a `<button>` and took the UA control font, so its 1.1em + 0.5em column was short and wrapped rows sat right of the first row's text; `.rotli-check` now inherits the line's font (it matches a radio's size) with border-box. The same inherited hanging indent printed a parent task's "0/1" pill over the words before it; the pill resets `text-indent`. `e2e/list-geometry.spec.ts` measures both. | Same code. |
| 14 | Flat top-right icons | Done. | Done — passes against the web build. |
| 15 | Copy a chat as raw Markdown | Done (`chatThreadModel.test.ts`); native check owed. The owner's 2026-09-17 screenshots were a NOTE copied into a note: the editor's copy wrote a readable rendering as text/plain, so the paste lost its structure. Fixed in PR #13 — text/plain is the source Markdown, HTML kept (`e2e/copy-markdown.spec.ts`). | Same code. |
| 16 | Chat: leave mid-run and return | Done (run store); native check owed. | Same code; the web's real run showed the reply in place. |
| 21 | **NEW** Back does not return to the note you were in (reported 2026-09-16 PM) | Not reproduced yet. `nav.back` (⌘[) steps the note trail (`state/navHistory.ts`) and opens the target through `openNavTarget`; a trail entry is dropped when its tab closes and rewritten on rename, so the likely shapes are: the previous note lived in another pane, or the note you "were in" was reached without a trail push (a sidebar reveal, a search hit, a chat's note). Needs the exact steps. | Same code. |
| 23 | **NEW** Drag an image onto the sidebar (2026-09-17) | Done: `sidebarDropTargets.ts` classifies chat/note rows and owns the spring-open dwell; a chat-row drop opens the chat and queues the images for its composer (`chatDropQueue.ts`, taken by `useChatDropTarget`); a note-row drop opens the note and lands the images at its end (`openedEditor.ts` waits for the view). Rows light with `data-drop-over`. `e2e/sidebar-drop-targets.spec.ts`. | Same rows on the DataTransfer lane: note rows spring and take the drop; a chat row refuses in words (Helper carries text only). |
| 22 | **NEW** Captures fill with cards no ⌥C wrote (reported 2026-09-17) | Done (PR #14): `writeNote` defaulted every note's shelf to `Inbox`, the shelf Rust projects to Captures, so a chat's conversation note and its header-button note landed there. `shelf` is now required; only ⌥C, Quick Note, a merge of captures, and a duplicate of a capture write `Inbox`. The same chat also minted a duplicate note every turn when two notes shared its title — the chat's note is now resolved by its back-link (`resolveChatNoteId`). | Web twin creates the chat note in Inbox, not on the board. |

**Vault sync (the owner's law: everything lives in the vault).** Proven on
the web with an imported copy of a vault: Main folders (`.rotli/main.json`),
named views (`.rotli/views.json`), theme family and mode (`.rotli/settings.json`),
chats (`chats/*.md`), chat folders (`.rotli/chat-folders.json`), each chat's
model (`settings.json` → `chatModel`), and recency. Imported mode is a
snapshot (Zen, Firefox, Safari, Brave without its flag): re-import to pick up
the app's later changes. Live folder mode (Chrome, Edge, Arc, Brave with the
flag) follows the real files.

### Native drops on macOS 26 (event-channel fix, 2026-09-17)

**Root cause:** Rotli enables Tauri's `unstable` feature for child/private
browser webviews. With that feature, `tauri-runtime-wry` creates even the main
workspace as `WebviewKind::WindowChild`. Wry’s native drag handler sends
`WebviewEvent::DragDrop` for a child, whereas a window-content webview sends
`WindowEvent::DragDrop`. Rotli listened only to the latter. Correct AppKit
registration and a working `draggingEntered:` callback therefore produced no
`native_drag::handle` log or imported file.

The earlier WebKit-bypass diagnosis was a hypothesis and was disproved by the
callback trace: `draggingEntered:` reached the WryWebView subclass with Safari
PNG/TIFF and promise types, but never reached Rotli’s window-event listener.
The upstream private-WebKit swizzle suggestion does not address this event
channel mismatch. The exploratory runtime bridge was removed; no Objective-C
method swizzling or extra native destination ships in this change.

The builder now consumes `on_webview_event` and passes workspace drags through
`native_drag::workspace_drag` to the existing handler. Only `main`, `capture`,
and `quick` qualify; remote private-browser children sharing a window cannot
grant workspace imports. The window-event listener no longer owns drags, so
there is one subscription and the existing `native_drag::deliver` remains the
only import-grant/event delivery point. Finder paths and the existing
promise/image-byte lanes all use it. Opt-in debug logs include the payload,
selected lane, and granted count in `$TMPDIR/rotli-drops-debug.log`.

Chat now gates image drops before importing: an image-capable model attaches;
a blind model opens a modal explaining how to choose a suitable model and
retry. It no longer keeps a refused image in Assets. Drops on the modal and
its backdrop cannot fall through to a note caret or Assets.

**Native acceptance:** see the ignored
`_review/codex-astra-2026-09-17-drops/report.md` for exact checks and evidence.
Computer Use’s initial native drag attempts were inconclusive: Finder’s
synthetic folder control did not move a file, and Safari initially reported
only drag-start/end. Later inspection found destination events in the Safari
control and the Wry callback trace. Those observations establish the receiver
and, together with the runtime source, the event-channel fault; they do not
by themselves prove a successful imported note image or chat attachment.
Screenshot-thumbnail and Photos drags require separate native acceptance.

### Enhancements (reviewed 2026-09-16 evening)

| Enhancement | Assessment |
|---|---|
| Chat says it "couldn't open ~/myela/…" instead of asking for permission | Today the connected CLIs run tool-less on purpose (`provider.rs`: Claude `--tools ""`, Codex read-only sandbox, Cursor Ask mode): a chat may read the vault through Rotli's own tools and nothing else. Asking for permission means a new capability: a per-chat, per-folder read grant (Rust `--add-dir`-style, shown as a prompt with the exact path, remembered per vault, never for secure notes), plus the model being told it can ask. Worth doing; it is a security change and needs its own design and Codex review. Not started. |
| Sidebar opens on hover, closes when you leave | New. Small: a "hover to reveal" mode in Settings → General; the collapsed sidebar becomes a hot edge; keyboard focus and the tour keep the pinned behaviour. Shipped 2026-09-17 as a floating overlay; rebuilt 2026-09-18 on the in-flow rail: revealed, it pushes the content exactly as ⌘0 does and keeps the resize grip, a held button holds it open, and `.threepane` clips (never scrolls) its overflow (`sidebarHoverRail.tsx`, `e2e/sidebar-placement.spec.ts`). |
| Sidebar on the right | New. Medium: mirror the shell grid, drag/resize math, tab-strip and pane placement; a Settings toggle plus the sidebar's own menu. Not started. |
| Red underlines for misspelled words | **Already shipped.** Settings → Editor → Spellcheck toggles the OS spell checker on the editor (`spellcheck` content attribute; macOS's own dictionary in the app, the browser's on the web). No engine to add. |
| ⌘← / ⌘→ for back and forward | Back and forward exist as ⌘[ and ⌘] (`nav.back`, `nav.forward`) and are remappable in Settings → Hotkeys. ⌘← / ⌘→ are macOS's line-start/line-end in every text field, so binding them app-wide would fight the editor; a user who wants them can rebind. |

### Status (2026-09-16, end of session)

| Item | State | Proof |
|---|---|---|
| 1 Delete folder | Done for Main-tree (virtual) folders; real Library directories still need a Rust command routed to the OS Trash | `mainFolderMenu.test.ts`, `e2e/shell-batch-2026-09-16.spec.ts` |
| 2 Drop image into a note | Partial: a non-embeddable file dropped on a note now says it went to Assets; the native lane is unchanged and needs the native acceptance step | `dropRouting.test.ts`; native |
| 3 Drop image into a chat | Partial: a model that cannot see keeps the images in Assets and says so; non-image files say where they went; the DataTransfer fallback for chats is still missing | `dropRouting.test.ts`; native |
| 4, 11 Back button | Done: Back to notes at every System root, one shared control | `e2e/system-back-and-restore.spec.ts` |
| 5 Restore to origin | Done: the Main slot survives Trash/Archive; Restore returns the note to its folder | `mainTree.test.ts`, `e2e/system-back-and-restore.spec.ts` |
| 6 Captures Make a note | Done: routed creation, visible refusal | `captureMerge.test.ts` |
| 7 Select all | Done: header button and ⌘A while Captures is open | `e2e/range-select.spec.ts` |
| 8, 9 ⇧-click ranges | Done on Captures, Main tree, and System folders through one helper | `rangeSelect.test.ts`, `e2e/range-select.spec.ts` |
| 10 Restore inside a trashed note | Done: header Restore chip through the shared helper | `e2e/system-back-and-restore.spec.ts` |
| 12 All notes and views | Validated global; rows now carry a muted view tag | `e2e/shell-batch-2026-09-16.spec.ts` |
| 13 Wrapped list alignment | Partial: wide column for two-digit markers landed. A `pre-wrap` override for the wrap-boundary space was reverted the same day (the owner saw the caret sit above the typed text in lists); the wrap-boundary space needs a reproduction before another attempt | `listGeometry.test.ts`, `e2e/shell-batch-2026-09-16.spec.ts` |
| 14 Flat header actions | Done: no surface behind the chips | `e2e/shell-batch-2026-09-16.spec.ts` |
| 15 Copy chat as Markdown | Done: a selection across turns copies their source; needs a native check (the twin has no replies) | `chatThreadModel.test.ts` |
| 16 Chat remount | Done: working row and reply follow the run store; needs the native check (send, switch tabs, wait for Done, switch back) | `chatRuns.test.ts` |
| 17 Library/Trash render every kind | Not started (see the table below) | — |
| 19 Library search ignores folder names (app and web, reported 2026-09-16 PM) | The Library's search box filters notes by title and snippet only (`filterSystemItems`); a folder called "engineering" never appears for the query "Engineering". Change: search also lists folders under the root whose name matches, above the note hits, opening the folder on click. | `systemBrowser.test.ts`, `e2e/system-browser-reveal.spec.ts` |
| 20 `chats/` is not in the Library (reported 2026-09-16 PM) — **decided (owner, 2026-09-16 evening): chats belong in the Library. Landed as shape (b): a `Chats` folder at the Library root listing `chats/*.md` as chats (glyph, kind "Chat"), opening as chats; the web's folder mode indexes `chats/` for it. Shape (a), the whole vault as the Library root, stays open.** | The Library root is the vault's knowledge tree (`wiki/`), while chats live in the vault's top-level `chats/` and the memory lanes (`identity/`, `personality/`, `history/`) and `storage/` sit beside it. The owner's law: "everything lives in the vault, the Library is the vault." **Decision needed:** (a) the Library becomes the whole vault root, with `chats/`, `storage/` (today's Assets), and the memory lanes as top-level folders — one browser, the desktop's Assets front folds into it; or (b) the Library stays the knowledge tree and gains a `chats` folder (the chat files, opening as chats) as its one exception. (a) matches the law; (b) is the smaller change. | `systemBrowser.test.ts` |
| 18 "Show in Library" on a board (reported 2026-09-16 PM) | **Likely cause read from the code, not reproduced (the browser twin seeds no board); decision needed.** In a memex vault every board is stored under `storage/excalidraw/` (a 2026-07-07 decision: the writable board lane inside the gitignored asset store), and the Library projects `storage/` as **Assets**. So the reveal has two faults: (a) `expandToFocusedItem` (`sidebarHome.tsx`) matches `fid.startsWith("Storage")` against the disk folder `storage/excalidraw` — a case mismatch, so the click does nothing at all; (b) even fixed, it would land in Assets, which the owner says is wrong: Assets is for images added to notes or generated, and files that sit in the left menu belong in the Library. Fixing (a) is a one-line reveal fix; honouring (b) means boards (and documents) get a Library home — either a Library lane that lists the managed-storage boards beside their folder's notes (item 17's "linked row" rule, no file moves) or a vault-layout change that stores new boards under `wiki/…` (STRUCTURE.md contract, `storage/` is gitignored so boards are not versioned today). The owner picks; the listing rule is the smaller change and keeps every existing vault intact. | `sidebarHome` reveal test; `systemBrowser.test.ts` |

| # | Item | Owner (file:line at 1.0.0) | What the code does today | Change | Proof |
|---|---|---|---|---|---|
| 1 | Delete a folder | `src/components/sidebar/sidebarHome.tsx:267-350` (the Main folder menu); `src/services/folderTrash.ts:12-37`; `fsNotes.ts:86` throws "folder delete is not in the corpus yet"; no Rust `corpus_delete_folder` | Main folders are virtual manifest nodes. The menu offers Rename, Move to view, Remove from Main, and "Move folder contents to Trash…" which is disabled for an empty folder. Real directories can be created but never deleted. | Add **Delete folder** to the Main menu: trash the contents (existing drill) then remove the node, enabled at zero items. Real-directory delete needs a new Rust command that routes to the OS Trash behind `writable()`; scoped as its own commit. | `folderTrash.test.ts`, `mainTree.test.ts`, `e2e/sidebar-context-menu.spec.ts` |
| 2 | Drag an image into a note | `src/editor/nativeFileDrop.ts:100-152` (native path), `:157-190` (DataTransfer fallback); `dropRouting.ts:114-143` | The native lane works. The fallback lane accepts only `isImagePath` files and never routes through `planDrop`; a non-embeddable file dropped on a note goes to Assets with no notice. | Route the fallback through `planDrop` + `deliverFiles` with `isEmbeddablePath`; give the editor branch of `planDrop` a notice when files are stored. Add unit tests for the two routing modules (see "why it keeps regressing"). | `dropRouting.test.ts`, new `nativeFileDrop.test.ts`; native acceptance |
| 3 | Drag an image into a chat | `src/components/chat/chatDrop.ts`; `chatSurface.tsx:2273-2283` (vision gate) | Native drops work when the model can see. When it cannot, the paths are discarded with only a hint, nothing stored. Chats have no DataTransfer fallback at all. | Store refused paths through `corpusImportFile` + `showFileNotice`; add chat to the fallback target resolution; notice on the chat branch of `planDrop`. | `dropRouting.test.ts`, `chatSurface.test.ts`; native acceptance |
| 4, 11 | Back button in Trash, Library, Assets, Archive | `src/components/systemSurface.tsx:674-683` (`fdr-up`, hidden at root) | The only control is up-one-folder and it disappears at the root, which is where Trash is always browsed. | Render the `board-back` "‹ Back to notes" precedent (`boardSurface.tsx:262-275`) in the System header at the root; keep `fdr-up` below it. | `systemBrowser.test.ts`, `e2e/system-browser-reveal.spec.ts` |
| 5 | Restore returns to Captures, not the origin | `src-tauri/src/corpus.rs:5251-5262` (origin stamp, correct); `src/components/useNoteMenu.ts:560-568` (trash strips the Main ref) | The file goes home on disk. But trashing removes the note from Main and restore never re-adds it, so a restored memex note sits in `wiki/_inbox` with no Main ref, which is exactly the Captures projection. A null-origin restore in a memex layout throws instead of misfiling. | Keep the Main ref through the sink (the projection already filters sink-resident items) or record it beside `origin` and reapply on restore; make the null-origin fallback layout-aware. | `corpus.rs` origin test, `notes.test.ts`, `mainTree.test.ts`, new e2e trash→restore→Main |
| 6 | Captures "Make a note" does nothing | `src/components/boardSurface.tsx:205-229` (`merge`) | Creates straight into the literal folder `Inbox`, which is `Hidden` in a memex layout, so Rust refuses; `merge()` has no `catch`, so the button fails silently. Works only in legacy vaults. | Create through `createRoutedNote` like every other creation site; surface refusal via `setRowActionError`. | `createNote.test.ts`, `e2e/capture-vault-routing.spec.ts` |
| 7 | Captures: Select all | `boardSurface.tsx:70,191-198,337-364` | Click-to-toggle only; toolbar appears only with a selection; no ⌘A action. | `Select all` in the header, a `captures.selectAll` action bound to ⌘A while the Captures view is active. | `captureReveal.test.ts`, keys registry test |
| 8 | Captures: shift-click range | `boardSurface.tsx:191-198,315-321`; precedent `systemSurface.tsx:438-460` | The click handler drops the event; no anchor. | Lift the System browser's range slice into a pure `src/lib/rangeSelect.ts`; Captures and System both call it with their visible order. | New `rangeSelect.test.ts`, one e2e for both surfaces |
| 9 | Main tree: shift-click range | `sidebarHome.tsx:431,591-608` | ⌘-click gathers; ⇧ is never read. Plain note lists have no selection model. | Same helper, fed the flattened Main row order. Keep `mainSel` separate from `ui.systemSelection`. | `sidebar.test.ts`, `e2e/sidebar-cross-section-drag.spec.ts` |
| 10 | Restore from inside a trashed note | `src/editor/editorSurface.tsx:352-434`; `useNoteMenu.ts:144-200` | A trashed note opens and edits normally; the only cue is the location chip. `NoteDoc.origin` is fetched and unused by the editor. | When `isSink(note.folderId)`, one `Restore` chip in the header that dispatches the exact menu branch, extracted into a shared `restoreAction(note)`. | `useNoteMenu.test.ts`, new e2e beside `file-folder-management.spec.ts` |
| 12 | Is "All notes" global? | `noteListSurface.tsx:41`; `viewTree.ts:302-306` (`assignedView`) | Global by design (`e2e/named-views.spec.ts` asserts it). No row shows its view. | Validation, no filter change: a muted view chip on each row from `assignedView`. | `notesSurface.test.ts`, `named-views.spec.ts` |
| 13 | Wrapped list lines misaligned | `src/editor/listGeometry.ts:49-53`; `styles/editor.css:869-881`; `cmEditor.tsx:576` (line wrapping) | The hanging-indent arithmetic is right. Two real causes remain: CodeMirror's `break-spaces` carries a preserved space to the start of a wrapped line, and `.rotli-marker.num` has a fixed width that wide numbers overflow. | `white-space: pre-wrap` on wrapped lines; `min-width` + `width: auto` on numeric markers; revisit `text-align: center` on bullets. | Visual e2e in `markdown-editing.spec.ts` measuring first vs wrapped line left edges |
| 14 | Header buttons read as cards | `editorSurface.tsx:393-433`; `styles/editor.css:137-158` (`.aachip`) | Three `.aachip` buttons carry a surface background and padding; the location chip is already flat. | Flat chips: no background, colour change on hover and for `.on`, hit area kept ≥24px; consider the shared `iconButton`. | `e2e/theme-flatness.spec.ts` assertion |
| 15 | Copying a chat loses Markdown | `chatSurface.tsx:1461-1467` (per-message copy is already raw); no copy handler on the thread | Selecting across rendered messages and pressing ⌘C serialises the DOM, so assistant Markdown is already consumed. | A `copy` listener on the thread maps the selection to `[data-chat-message-index]` rows and writes their source Markdown; a "Copy chat" action for the whole thread. | `chatMessagePresentation.test.ts`, `e2e/chat-workspace.spec.ts` |

| 16 | Chat: leave mid-run, come back — no "working" sign, and when the run finishes the reply never appears | `src/components/chat/chatSurface.tsx` (in-flight row, message list source); the `chatRuns` store (the sidebar's Working/Done badge reads it); the transcript persistence path | Reported 2026-09-16 with two screenshots: send a message, open another tab, return. The sidebar row says Working, the thread shows no in-progress row; when the sidebar flips to Done the thread still shows only the user's message; closing and reopening the chat tab shows the reply. The run completes in the store, so the surface's pending row and its appended reply both live in component state that a remount discards, and the remounted surface reads a transcript that the finishing run has not written yet or does not invalidate. | Derive both the in-flight row and the finished reply from the `chatRuns` store (the same truth the sidebar reads): a remounted surface shows the working row, streams into it, and on completion the reply is in the list without a reload. Confirm the transcript write and the query invalidation on completion. **Highest priority of the batch: a finished answer is lost from view.** | `chatSurface.test.ts`, `e2e/chat-workspace.spec.ts` (send, navigate away, complete, return) |

| 17 | Library, Archive, Trash: boards and documents in their real folders, kind glyphs, image previews (app AND web) | `src/components/systemSurface.tsx`, `src/services/systemBrowser.ts` (listings), `ItemTile`/`FolderListRow` | Reported 2026-09-16 with a screenshot: the Library lists only Notes under a project folder; boards and documents that belong there are hard to find (they list under Assets/storage lanes), rows carry a plain note glyph, and trashed images show no preview. | List every item kind in the folder that owns it (a board or document beside its notes, at least as a linked row when the file lives in the managed storage lane); use the same kind glyphs as the sidebar (`glyphForNote`) in List and Columns; image tiles in Trash and Archive get the Icons-view thumbnail. Same listing rule for the web build's folder mode. | `systemBrowser.test.ts`, `e2e/system-gallery.spec.ts`, `e2e/system-browser-reveal.spec.ts` |

Cross-cutting: one range-select helper (8, 9); one back control (4, 11);
`createRoutedNote` is the single creation router and `merge()` is its only
bypass (6); silent `void promise()` without a `catch` is the shared failure
pattern behind 3, 6, and 15 while `setRowActionError` and `showFileNotice`
already exist as the honest error lanes.

### Why drag-and-drop keeps regressing

Finder drops reach the editor through Tauri's native drag session, not a
browser `DataTransfer` (`src/editor/nativeFileDrop.ts:1-12`). The browser
twin cannot produce that event, so no E2E spec exercises a real drop, and the
two files that route drops (`nativeFileDrop.ts`, `nativeFilePaste.ts`) have
**no unit tests of their own**; only the pure helpers beneath them
(`dropRouting.test.ts`, `externalImageDrop.test.ts`) are covered. The drop
path has been touched by seven commits since 2026-08-19 (chat drops, drop
routing, Finder paste, the paste-lane fix on 2026-09-14). Every one of those
could only be proven by a human in the native app, and the launch-readiness
audit records native acceptance as unproven. The fix for the regression
class, not just the two items, is: (a) unit tests for the two routing
modules that feed synthetic native events through the same code path the
Tauri listener uses, and (b) a native acceptance step for drops in the
`validate-in-the-native-app` skill, run before every release that touches
the editor or chat.
