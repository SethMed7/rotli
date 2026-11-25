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
- **Exceptions.** The build's own scratch vault (only while it is trusted, see
  below) and the roots in its own registry are allowed. Paths compare in
  canonical form: on a case-insensitive Mac volume a root stored as `own`
  still owns `Own`. A registry root now reached through a link a person made
  owns nothing, because the folder behind it is not the one that was bound.
  The system's own links (`/var`, `/tmp`, owned by root) don't count. A
  registry that exists but can't be read refuses.
- **Where Rust checks.** The check runs inside `reject_privileged_root`. The
  app's folder bindings all go through it: the folder panel, choosing or
  creating a vault, connecting a library, switching vaults, adding a folder,
  folder windows, and both sides of a vault copy. It runs before anything
  writes to the folder; the heal in `corpus_choose_folder` comes after it. The
  CLI's `ROTLI_CORPUS_ROOT` pin meets the same rule
  (`app_identity::refuse_pinned_root`).
- **Paths that never reach a host build.** Files and folders opened from Finder
  arrive only through the deep-link plugin, which a host build doesn't
  register. The relay's MCP root is the vault the app already has open, and
  pairing needs the Keychain, which a host build refuses.
- **`rotli-helper`.** Under a host ID the helper keeps its token and vault
  choice in `<support folder>/Helper`, not `~/.rotli-helper`, so it never serves
  the vault Rotli's helper chose. Choosing a folder (`--vault` or the page's
  picker) meets the same refusal. The root it already serves stays its own.
- **The UI** has no check of its own. The picker's refusal comes from Rust
  (`memex_pick_folder` runs `reject_privileged_root`), in the host's own
  `HostWords`, and the screen shows that sentence as it shows any picker
  error.
- **Standalone Rotli** refuses nothing and reads nothing more than before.

## The scratch vault

A host build's first run binds `<support folder>/Scratch vault` without asking
anyone, so that path is trusted only when this build made it.

- **Trusted** means a real folder, not a link, directly inside a support
  folder that is itself not a link. Before this build has a registry, it must
  also be empty: anything already in it was put there by someone else.
- **At launch**, after the identity check and before any folder is repaired,
  registered or watched, `ensure_scratch_vault` settles the path. Something
  untrusted there (a link, a file, a full folder) is renamed aside as
  `Scratch vault (set aside <time>)`. The rename moves the link itself and
  never touches its target. A fresh empty folder then takes its place. If the
  path can't be made safe, the app exits with status 73 and binds nothing.
- Once a registry exists, a real folder at the path is the one this build
  bound, whatever it holds. A person who removed it keeps it removed.
- `reject_privileged_root` and the owned roots trust the scratch vault only
  through the same test (`owned_scratch_vault`).
- A support folder that is itself a link is refused before anything is
  renamed, and the app exits 73.
- **Not re-checked at launch:** a registry root that a person later replaces
  with a link is still opened at launch, by the app and by the headless CLI,
  which reads the same registry. It owns nothing, so picking it again, or
  anything around it, is refused. A registry that exists but won't parse
  counts as a registry, so the folder at the scratch path is kept as it is,
  even if it isn't empty. The migration then binds it again.

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

## Proof

This list says only what was run. A host top crate, signed under a host
identity and built against this library at `32e56b11`, was launched twice in a
sandbox HOME (2026-11-25). The first run passed the webview's identity check
and made a fresh scratch vault, its registry and its settings. The second run
took the registry-exists path and set nothing aside, with no exit 73 or 78.
Rotli's own app was never launched. The exit-78 and exit-73 stops themselves
and the plugin gating are proven by code, unit tests and source-order fences
only. The notes-off window, a host pane, pane blocks,
the nav order and the host's words are proven by server-side rendering only.

- **Rust, standalone:** `cargo test` (the `app_identity`, `keychain` and parity
  tests).
- **Rust, under a host identity:** from `src-tauri`, run
  `ROTLI_APP_IDENTIFIER=com.example.host CARGO_TARGET_DIR=<its own dir> cargo
  test --lib` (and `cargo clippy --all-targets -- -D warnings` the same way).
  Under that identity, the vault refusal and the shared-state refusals run for
  real. Tests that need the Keychain return early there, as the Keychain's own
  host test covers the refusal. The Antigravity path parity test compares the
  fixture's standalone path with the host ID swapped in.
- **Rust tests:** `app_identity_tests.rs`, `helper_vault_identity_tests.rs`,
  `breve_dev_roots.rs` and `app_host.rs`.
- **TypeScript:** `src/lib/appIdentity.test.ts`, `src/host/registry.test.ts`,
  `src/components/settings/settingsNav.test.ts` and
  `src/components/settings/settingsSurfaceHost.test.tsx`.
