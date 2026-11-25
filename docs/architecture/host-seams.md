# Host seams: one shell, with or without a host

Rotli's shell can run in two ways. **Standalone Rotli** is the app people
install: `com.rotli.app`, its update feed, `rotli://`, its Keychain service and
its LaunchAgents. A **host build** is another app that uses Rotli's shell as its
own and adds parts of its own from another repository. This repository holds
only the neutral seams. It contains no host's code, names or art, and a host
supplies its own bundle ID and wording.

With no host, nothing in this document changes what a Rotli user sees. That
was checked in the browser lane on synthetic data, on 2026-11-24, by comparing
screenshots of every Settings pane taken before and after the seams were added.
The commit that adds the seams records the result.

## The identity

One value decides which app a build is: its bundle ID, fixed at build time.

| Reader | File | Rule |
|---|---|---|
| Rust | `src-tauri/build.rs`, read once in `src-tauri/src/app_identity.rs` | `ROTLI_APP_IDENTIFIER` if set, then the Tauri CLI's `--config` overlay in `TAURI_CONFIG`, then `src-tauri/tauri.conf.json` |
| Webview | `vite.config.ts`, read in `src/lib/appIdentity.ts` | The same rule (`bundleIdentifier`) |

- `ROTLI_APP_IDENTIFIER` exists because a host's top crate has a Tauri config
  of its own. Rotli's `build.rs` can't see that config, so the host names the ID
  outright.
- At launch the app compares the ID it was compiled for with the ID in its
  Tauri context. If they differ, it exits with status 78 before it makes the
  scratch vault or binds any folder. A stale build cache, or a host context
  that names another ID, can't give one identity the other's behaviour.
- **The webview checks too.** Before it reads or renders anything, the front
  end asks the running app for its ID (Tauri's `getIdentifier`, allowed by
  `core:default`) and compares it with the ID Vite built it with
  (`identityHolds` in `src/lib/appIdentity.ts`). A host bundle whose Vite
  config left out the `__ROTLI_APP_IDENTIFIER__` define reads as standalone, so
  it fails this check, and so does a failed lookup. On a mismatch the window
  shows one sentence and nothing else starts. Rust's own check makes the
  third side agree.
- Every path that names the bundle ID derives from this value: the headless
  CLI's `corpus.json`, Antigravity's runtime folder, and Breve's login-item
  label.
- `STANDALONE_IDENTIFIER` is a shared TS↔Rust value, pinned by the
  `appIdentity` entry in `scripts/fixtures/parity.json`.

## Shared state fails closed

Some state is not keyed by the bundle ID, so two installed apps would share it.
That state belongs to the standalone build. **Any other ID never touches it:**

- **Updates and links.** The updater and deep-link plugins are not registered.
  Settings shows the host's line where "Check for updates" would be.
- **The Keychain.** Every lane through `keychain.rs` refuses, including the
  debug store. Breve's `secret.ts` is never spawned. A source fence
  (`every_keychain_path_checks_the_identity_first`) keeps both rules.
- **LaunchAgents.** No Breve login item or scheduler, no local-model agent, and
  no `launchctl` kickstarts. `~/breve` and `~/.memex/ai` are never written.
- **The Finder quick action.** Its status reads `unavailable`.
- **OS-wide shortcuts.** None are registered. Settings › Keybindings marks
  them as staying with Rotli.
- **Existing vaults.** Detection offers none. `~/Documents/rotli` is never
  probed. A fresh install starts on a scratch vault, `<support folder>/Scratch
  vault` (see "The scratch vault" below).
- **Debug Breve.** It borrows delivery settings from Rotli's vault locations
  (`~/memex-vault`, `~/Documents/rotli`, `MEMEX_KNOWLEDGE`, the registry). A host
  build reads none of them (`breve_dev_roots.rs`).
- **The headless CLI.** It ignores `ROTLI_CORPUS_CONFIG`, so it reads only its
  own registry.

## The vault refusal

A host build refuses any folder that Rotli already uses as a vault. It does so
in two places, each on its own.

- **Rust** (`app_identity::refuse_existing_vault`) refuses a folder in three
  cases: the folder is a vault (`.rotli/`, a root `memex.json`, or a marker
  Rotli can recover), it sits inside one, or it holds one deeper down. The
  downward walk stops at 50,000 folders, and refuses when it does.
- **Links.** The downward walk follows a link to a folder once. The link
  counts as a hit when its target is a vault, sits inside one, or holds one.
  A link back up the tree is walked once and doesn't loop. A folder the walk
  can't read is skipped, since this app can't read a vault through it either.
- **Exceptions: the mark.** A vault is this build's own only when it carries
  the build's mark, an empty file at `.rotli/bound-by/<bundle ID>` inside the
  folder itself (`app_identity::claim`). Nothing in the support folder
  vouches for a folder: anything that can write there can write a registry,
  a backup or a helper config too. The mark is judged on the folder behind a
  path, so it doesn't matter how a registry spells it (through a link, `..`,
  or another letter case). A path that later leads to a Rotli vault finds no
  mark there. The standalone build writes no mark and never reads one.
- **Who marks.** A folder gets the mark when it is bound, after the refusal
  passed: the scratch vault when it is made, and the three registry writers
  (`persist_corpus_path`, `upsert_brain`, `add_folder` in `corpus.rs`) for the
  root each adds. The helper marks the folder it chooses. A source fence
  (`launch_secures_the_registry_and_writers_mark_their_roots`) keeps each
  writer marking before it writes.
- **Where Rust checks.** The check runs inside `reject_privileged_root`. The
  app's folder bindings all go through it: the folder panel, choosing or
  creating a vault, connecting a library, switching vaults, adding a folder,
  folder windows, and both sides of a vault copy. It runs before anything
  writes to the folder; the heal in `corpus_choose_folder` comes after it.
  The scratch vault skips only the private-folder check there, not the vault
  refusal. The CLI's `ROTLI_CORPUS_ROOT` pin meets the same rule
  (`app_identity::refuse_pinned_root`), and so does every root launch reads
  from the registry (see "The launch bind").
- **Paths that never reach a host build.** Files and folders opened from Finder
  arrive only through the deep-link plugin, which a host build doesn't
  register. The relay's MCP root is the vault the app already has open, and
  pairing needs the Keychain, which a host build refuses.
- **`rotli-helper`.** Under a host ID the helper keeps its token and vault
  choice in `<support folder>/Helper`, not `~/.rotli-helper`, so it never serves
  the vault Rotli's helper chose. Choosing a folder (`--vault` or the page's
  picker) meets the same refusal and marks the folder. Every time it loads
  its config, the helper serves the root only while that root carries the
  mark and sits in no vault it doesn't own. The first time a process sees a
  root (at the helper's start, or a new choice), it also walks below it, as
  the app's launch does, and serves nothing if a vault it doesn't own is
  there. A config naming any other folder serves nothing. Because the app
  and its helper share one bundle ID, the helper can serve the host app's
  own vaults too.
- **The UI** has no check of its own. The picker's refusal comes from Rust
  (`memex_pick_folder` runs `reject_privileged_root`), in the host's own
  `HostWords`, and the screen shows that sentence as it shows any picker
  error.
- **Standalone Rotli** refuses nothing and reads nothing more than before.

## The scratch vault

A host build's first run binds `<support folder>/Scratch vault` without asking
anyone, so that path is trusted only when this build made it.

- **Trusted** means a real folder, not a link, directly inside a support
  folder that is itself not a link, that is empty or carries this build's
  mark, and that passes the vault refusal, including the walk below it. A
  registry doesn't vouch for it: a folder moved to that path (a Rotli vault,
  say) is not this build's, whether or not a registry exists or parses. Nor
  does the mark alone, since whoever writes the support folder can forge it
  there: a scratch folder holding a link to a Rotli vault is set aside.
- **At launch**, after the identity check and before any folder is repaired,
  registered or watched, `ensure_scratch_vault` settles the path. Something
  untrusted there (a link, a file, a full folder) is renamed aside as
  `Scratch vault (set aside <time>)`. The rename moves the link itself and
  never touches its target. A fresh folder, marked at once, then takes its
  place. If the path can't be made safe, the app exits with status 73 and
  binds nothing.
- Once a registry exists, a person who removed the scratch vault keeps it
  removed, unless the registry still names it.
- `reject_privileged_root` and the headless CLI trust the scratch vault only
  through the same test (`owned_scratch_vault`, `trusted_scratch_at_home`),
  and the scratch vault still meets the vault refusal: a link inside it to a
  Rotli vault is refused like any other.
- A support folder that is itself a link is refused before anything is
  renamed, and the app exits 73.

## The launch bind

At launch the app binds whatever its registry names, so the registry gets the
same refusal as a folder a person picks. `host_registry.rs` owns this.

- **Order.** After the identity check (78) and the scratch vault (73),
  `host_registry::secure_registry` vets every registry file: `corpus.json`,
  `corpus.dev.json` and each one's `.bak`. It runs before the bookmark repair
  reads any root, and again after the repair, which can rewrite registry
  paths from the support folder. It checks first that the support folder is
  not a link. If it can't vet the registry, the app exits with status 73 and
  binds nothing.
- **The rule.** A root stays only when the folder behind it carries this
  build's mark and the vault refusal passes for it, including the walk below
  it. A refused library or folder is dropped. A refused primary falls back to
  the scratch vault, which is made again if it is gone. A scratch vault
  holding only the mark still opens as a first run.
- **What happens to the file.** A registry that would change is set aside
  whole as `<name> (set aside <time>)` and the vetted version is written in
  its place, so nothing is lost. A registry that won't parse is set aside too,
  and the launch starts as a first run on the scratch vault.
- **No legacy pointers.** A host build never wrote `corpus-root.txt`,
  `corpus-memex-root.txt`, `corpus-roots.json` or `memex-instances.json`, so
  its first config reads none of them (`host_registry::first_config_for`).
  The standalone build still migrates them.
- **The headless CLI** vets the registry it reads on every call
  (`host_registry::vet_config`): each root must carry the mark and sit in no
  vault it doesn't own. The first time a process sees a root it also walks
  below it, so a long-lived MCP server walks each root once, as the app's
  launch does. It writes nothing, and it refuses when its primary is refused
  and there is no trusted scratch vault.
- **After launch.** Commands read the registry again while the app runs, and
  anything that writes the support folder can rewrite it then. So a host
  build takes a root from its open stores, never from that read
  (`host_registry::live_root`, `require_live`). This covers the current vault
  that choosing a folder, switching, a new vault and a vault copy move or
  carry settings from; the connected vault a refresh reopens; the roots the
  chat and note commands (`memex::registered_root`) read and write; the
  roots Settings lists and reads markers and settings from
  (`host_registry::live_config`); the folder a picker starts in; and Reveal
  in Finder. Inspecting a picked folder
  meets the refusal first, because the picker grants a folder before it
  refuses it.
- **No demo mode.** Demo mode binds `memex-demo` beside the corpus, which may
  be Rotli's own demo vault, so a host build ignores a `demo.on` flag and
  refuses to turn demo mode on.
- **Standalone Rotli** skips all of this.

## Keeping it closed

Each review round of this slice found one more path that bound a root
without the refusal. `check:vault-binds` (`scripts/check-vault-binds.mjs`)
now lists the functions that make a path a root (the store opens, the
registry writers, the mark, the asset-protocol grants, the watchers, the
helper's config, and the wrappers around them) and the registry readers
(`resolve_corpus`, `read_corpus_config`, `ensure_corpus_config` and the
rest), since a folder taken from a registry read is a root source. Every
call in production Rust says why its path is safe with
`// vault bind (<category>): <reason>`, on the call's line or in the comments
right above it. `refused` must meet a refusal in the same function (before a
bind, or after a read); `live` must take the root through `live_root`,
`require_live` or `live_config`; `delegated` is allowed only inside a function
on one of the two lists, whose own callers say why. Each file's count per category is
pinned in `scripts/vault-bind-allowlist.json`, so a new caller fails until
it is reviewed. The `launch_secures_the_registry_and_writers_mark_their_roots`
fence lists the commands that take roots after launch.

## The host entry (Rust)

`src-tauri/src/app_host.rs`. Standalone Rotli's binary calls
`rotli_lib::run(tauri::generate_context!())`. A host build calls
`rotli_lib::run_with_host(AppHost::new(context).plugin(…).words(…))` and
passes:

- **its Tauri context:** its bundle ID, bundle name, capability files and front
  end;
- **extra plugins**, registered after Rotli's own in the order given. A host's
  commands are plugin commands, because Tauri allows one invoke handler and
  that one is Rotli's;
- **`HostWords`**: the sentences shown where it declines shared state, where it
  has no Keychain, and where it refuses an existing vault. Rotli's defaults are
  neutral.

Only Rotli's own binary (`src-tauri/src/main.rs`) expands Rotli's Tauri
context. The library never does, so a host crate builds without Rotli's
`dist/`. A fence (`app_host::tests`) keeps it that way.

### Building a host crate

`tauri build` in a host crate can fail with `can't find crate for
tauri_macros` (or another proc macro). It looks like the host's own release
profile is the cause, not Rotli. A crate that depends only on `tauri`, with
`codegen-units = 16`, `lto = "thin"` and `strip = "symbols"`, fails the same
way, with or without `MACOSX_DEPLOYMENT_TARGET`. Built with cargo directly, the
same crate shows the real error: macOS won't load a stripped proc-macro dylib
(`mis-aligned LINKEDIT string pool`). Leaving proc macros unstripped makes
`tauri build` pass. Rotli's own profile, which strips too but uses
`codegen-units = 1` and `lto = "fat"`, built in the same scratch crate, but it
reused that crate's target folder. Which of those two settings interacts with
`strip` is not isolated. The fix was checked on that minimal crate and then on
a real host crate's full graph (`codegen-units = 16`, `lto = "thin"`,
`strip = "symbols"`): one `tauri build --bundles app --no-sign` passed, the
binary's minimum macOS was 13.0, and `Cargo.lock` didn't change (2026-11-25,
Rust 1.97.1). In the host crate's `Cargo.toml`:

```toml
[profile.release.build-override]
strip = false
```

Then `tauri build` works, and the binary gets the deployment target from
`bundle.macOS.minimumSystemVersion`. A plain `cargo build` followed by
`tauri bundle` doesn't get that target.

## The host registry (front end)

`src/host/registry.ts`. A host build's entry imports a module that calls
`registerHost(…)` before it imports Rotli's `src/main.tsx`. The registry locks
on its first read, so a late registration throws. A host can give:

- **`settingsPanes`**: Settings panes with an id, a label, a glyph, a heading,
  an anchor (`after`: the Rotli pane each one follows, or else just before
  About), and a body component. An id that is already Rotli's throws. The
  nav comes from `src/components/settings/settingsNav.ts`, and with no host
  it is exactly Rotli's list.
- **`navOrder`**: pane ids, Rotli's or the host's, in the order the nav shows
  them. The named panes trade places among the slots they hold, and every
  other pane keeps its slot, so `["general", "appearance", "connections",
  "<host pane>"]` puts Connections third and leaves About last. A pane this
  build doesn't show is skipped. An unknown id, or one named twice, throws.
- **`paneBlocks`**: components a host adds to General, Connections or About,
  `before` or `after` that pane's own body. They always sit below the pane's
  heading, and blocks in one place render in the order given. Any other pane
  or place throws at registration. With no host, nothing extra renders, not
  even a wrapper.
- **Pane heads.** Rotli's panes keep their quokka pose and motif. A host pane's
  heading is the banner's scenery with no character and no object
  (`SettingsBanner` without `pose` or `motif`), so this repository holds no
  host art.
- **`notes: false`**: Settings without notes. The window is just Settings. It
  has no "Back to notes", none of Rotli's first-run or vault screens, and no
  notes panes (Keybindings, Browser, Librarian, Security, AI Models, Chat,
  Location). General, Appearance, Connections and About stay.
- **`words`**: the updates line; `productName` and `version`, which replace
  "Rotli" and the bundle's version at the foot of the nav; and `aboutLabel`,
  which replaces "About Rotli" as the nav row and the pane's heading. The
  About pane's body stays Rotli's; a host adds to it with `paneBlocks`.
  Rotli's defaults are exactly today's text.
- **`aboutGlyph`**: the About row's glyph, where Rotli shows its quokka.

## Not built yet

- **Hosts can't add yet:** sidebar fronts, first-run steps, or other windows
  or pages.
- **The notes rows of General and Connections** still show when notes are off.
- **Not proven yet:** a plugin command passing the capability ACL in a live
  host webview, and one copy of React across two repos at run time.

## Limits of the vault refusal

- **The mark is a file in the folder.** It raises the bar only against a
  writer scoped to the support folder: a sync tool, a restore, or a process
  that can write there and nowhere else. A same-user process with general
  write access can plant `.rotli/bound-by/<bundle ID>` inside a Rotli vault
  next to a planted registry, and the host then binds that vault. The
  refusal stops a planted registry, backup, legacy pointer, helper config or
  scratch folder on its own; it doesn't stop a process that already writes
  to the vault. In the scratch vault, which sits in the support folder, the
  mark counts only together with the walk below it.
- **A host's folder that standalone Rotli opens later stays the host's.** The
  mark can't tell "this host made it" from "this host made it and Rotli now
  uses it too", so the host keeps binding a folder a person also opened in
  Rotli. That is the person's own choice, not an attack. Standalone Rotli
  writes no sign of its own, so nothing tells the host.
- **While the app runs.** After launch a host takes roots only from its open
  stores (if it has no open default store, Settings still shows the
  registry's current vault), but nothing re-walks an open root: a vault made or moved inside one
  while the app runs is seen at the next launch, as it is by the helper and
  the CLI at their next start. The registry writers rewrite the registry they
  read, so an entry planted while the app runs is carried forward and vetted
  at the next launch. There is also a short window between the vetting and
  the bind (TOCTOU) that only a same-user process can race.
- **The bookmark repair** reads the `memex.json` id of the folder a planted
  bookmark resolves to. It binds nothing, and the vetting after the repair
  refuses any path it repointed.
- **Repinning a host.** Folders a host bound before the mark existed carry
  none. At the first launch on this version, the scratch vault, if not empty,
  is set aside and replaced. Registry roots are dropped (the registry is set
  aside first), and the helper stops serving its folder until it is chosen
  again. Nothing is deleted. A folder that has gone missing (an unmounted
  drive, say) is dropped from the registry the same way.
- **Every folder a host binds gets the mark,** a plain folder added with
  "add a folder" included. A code folder then shows `.rotli/bound-by/` in
  `git status`, and any other host ID refuses that folder, since any
  `.rotli/` reads as a vault.
- **The mark travels with the folder.** A copy or a synced replica of a
  host's vault carries it, so the host treats that copy as its own too.
- **A link to a Rotli vault inside the host's own notes** gets that folder
  refused at the next launch. In the scratch vault, the whole scratch vault
  is set aside and replaced; nothing is deleted.
- **A read-only folder** can't take the mark, so a host build can't bind it.
- **A folder that grows past the walk's limit** (50,000 folders) after it was
  chosen is refused at the next launch and dropped like any other refused
  root.
- **Each walk costs a launch's time.** The launch walks every registry root
  twice (before and after the bookmark repair); the helper and each CLI or
  MCP process walk each root once.

## Proof

This list says only what was run.

- **Live host launch at `14f8636f`** (2026-11-25). A host build (`bun run
  mac:build`, Developer ID signed, under a host bundle ID) was launched by
  script in sandbox HOMEs. All four runs rendered first run, with nothing on
  stderr and no exit 73 or 78:
  1. **A fresh first and second launch.** The first launch made a marked
     scratch vault holding the welcome note, `index.json` and `search/`, plus
     a `corpus.json` naming it. The second launch set nothing aside.
  2. **The unmarked state from before the mark.** The old scratch vault was
     renamed `Scratch vault (set aside <time>)` with its contents kept, a
     fresh marked scratch vault replaced it, and a relaunch set nothing more
     aside.
  3. **A planted `corpus.json` naming a synthetic vault.** The registry was
     set aside whole and rewritten to the scratch vault. The synthetic vault
     was unchanged: no mark, no index.
  4. **A planted legacy `corpus-memex-root.txt`.** It was ignored, and the
     synthetic vault was unchanged.
- **Not covered by that run.** Round 5 (after `14f8636f`) changes the launch
  order: the registry is now vetted before the bookmark repair as well as
  after it. It also changes what commands take as roots after launch, the
  helper's start, and the CLI's walk. These are proven by unit tests and
  source fences under a host ID only, not by a live host launch. An earlier
  launch at `32e56b11`, before the mark and the launch bind, passed the
  webview's identity check. Rotli's own app was never launched. The exit-78
  and exit-73 stops themselves and the plugin gating are proven by code,
  unit tests and source-order fences only. The notes-off window, a host
  pane, pane blocks, the nav order and the host's words are proven by
  server-side rendering only.

- **Rust, standalone:** `cargo test` (the `app_identity`, `keychain` and parity
  tests).
- **Rust, under a host identity:** from `src-tauri`, run
  `ROTLI_APP_IDENTIFIER=com.example.host CARGO_TARGET_DIR=<its own dir> cargo
  test --lib` (and `cargo clippy --all-targets -- -D warnings` the same way).
  Under that identity, the vault refusal and the shared-state refusals run for
  real. Tests that need the Keychain return early there, as the Keychain's own
  host test covers the refusal. The Antigravity path parity test compares the
  fixture's standalone path with the host ID swapped in.
- **Rust tests:** `app_identity_tests.rs`, `host_registry_tests.rs` (each
  registry file and legacy pointer planted, a vault moved to the scratch path
  with and without a readable registry, the host's own vault spelled through
  a link and `..`, and a registry rewritten after launch),
  `helper_vault_identity_tests.rs` (including a vault made inside the served
  folder before the helper starts),
  `breve_dev_roots.rs` and `app_host.rs`.
- **TypeScript:** `src/lib/appIdentity.test.ts`, `src/host/registry.test.ts`,
  `src/components/settings/settingsNav.test.ts` and
  `src/components/settings/settingsSurfaceHost.test.tsx`.
