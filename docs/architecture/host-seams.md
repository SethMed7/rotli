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
  build takes a root, and the flags beside it, from its open stores, never
  from that read (`host_registry::live_root`, `live_roots`, `live_config`,
  `live_reopen`). Each store keeps the root, the adopted (in place) flag and
  the read-only flag it was opened or last set with. This covers:
  - the current vault that choosing a folder, switching, a new vault and a
    vault copy move or carry settings from;
  - the vault a refresh reopens, and whether the current vault reopens in
    place (`live_reopen`: its store's flag, or the in-place marker in the
    folder itself);
  - the roots the chat and note commands (`memex::registered_root`) read and
    write, which are exactly the open stores' roots (`live_roots`), so a
    rewrite can neither add a root nor shut them out of an open one;
  - whether the memex write lane may write a connected vault
    (`memex::registered_write_root`): its open store's read-only flag, never
    the registry's `perms`;
  - the roots Settings lists and reads markers and settings from
    (`live_config`): the current vault is the open default store, a connected
    vault or folder shows only while its route is open at that folder, each
    with its store's adopted flag (and a connected vault with its store's
    read-only flag), and the active vault only when it is one of those. With
    no open default store, Settings shows no vault. The current vault has no
    registry write right: its write right comes from the vault's own
    `memex.json` on disk (`memex::memex_write_allowed`), as in the standalone
    build;
  - the folder a picker starts in, and Reveal in Finder.

  Inspecting a picked folder meets the refusal first, because the picker
  grants a folder before it refuses it.
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
right above it. Three categories are checked:

- **`refused`** needs a refusal (`reject_privileged_root`,
  `refuse_existing_vault`, `refuse_pinned_root`) that names the same variable
  as the marked call, directly or through a `let` made after the refusal. For
  a bind, the refusal comes first, in a block that encloses the call. For a
  registry read, it comes after the read, in the read's own block, and takes
  what the read bound.
- **`live`** is the same with a `host_registry::live_*` call; a read passed
  straight into one counts.
- **`delegated`** is allowed only inside a function on one of the two lists,
  whose own callers say why.

One shared variable is enough, so a call that takes two paths
(`carry_settings(current, target)`) needs one of them covered; its marker
says where the other comes from. The guard also finds calls through an alias
(`use … as`, a plain or glob `use` of a sink, `use …::{self as m}`, a type
alias), a sink passed as a value (`.map(CorpusStore::open)`), and a
`CorpusConfig` parsed straight from JSON. Each file's count per category is
pinned in `scripts/vault-bind-allowlist.json`, so a new caller fails until
it is reviewed.

**The guard is a tripwire, not a proof.** It reads lines and braces. It
doesn't follow control flow (an early return, a refusal whose error is
dropped), a variable reassigned without `let` or copied before the refusal,
or a method called in UFCS form (`CorpusState::insert_root(&state, …)`), and
a variable that happens to be shared satisfies it. A reviewer still reads
each marker. The `launch_secures_the_registry_and_writers_mark_their_roots`
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
- **`HostWords`**: its own words. `shared_state`, `no_keychain` and
  `existing_vault` are the sentences shown where it declines shared state, where
  it has no Keychain, and where it refuses an existing vault; Rotli's defaults
  are neutral. `welcome_note` is the first note written into an empty notes
  folder, a host's scratch vault included (see "The welcome note" below).

Only Rotli's own binary (`src-tauri/src/main.rs`) expands Rotli's Tauri
context. The library never does, so a host crate builds without Rotli's
`dist/`. A fence (`app_host::tests`) keeps it that way.

### The welcome note

`welcome_note: Option<String>` is the whole Markdown body, `# Title` first and
no frontmatter. That heading names the note, and the title names its file, as
for any note: `# Welcome to Synthetic` is written as
`Inbox/welcome-to-synthetic.md`. `None`, the default, writes Rotli's own
`Inbox/welcome-to-rotli.md`.

The first line must be `# Title`, with something after the `#`. A body that
starts any other way (its own frontmatter, a blank line, no heading) stops a
host's debug build at launch; a release build drops it and writes Rotli's note.

```rust
rotli_lib::run_with_host(rotli_lib::AppHost::new(context).words(rotli_lib::HostWords {
    welcome_note: Some(include_str!("welcome.md").into()),
    ..Default::default()
}))
```

- It is written once, at a folder's first run. A folder already seeded keeps
  the note it has.
- **A vault made from the folder panel still gets Rotli's.** Picking an empty
  folder there scaffolds a memex with `Welcome to Rotli.md` and its lessons
  from `src/assets/welcome.json`, as does Settings → Open welcome folder for the
  lessons. `welcome_note` doesn't reach that catalog.
- Only the app reads host words. The headless CLI never calls `run_with_host`,
  so an empty folder it opens first gets Rotli's note.

**For a host repinning:** `HostWords` is a public struct, so a new field can
break a host's literal. A host that builds `HostWords { … }` must set every
field (`welcome_note: None` keeps today's note), or use `..Default::default()`
only when it leaves at least one field unset. With every field set, the struct
update has no effect: clippy's `needless_update` rejects it in a crate that
denies warnings (plain `rustc` accepts it).

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
- **A pane's links (`openPane`).** The body component gets one prop,
  `openPane(id)` (`HostPaneProps`), which shows another pane, Rotli's or the
  host's: `<button onClick={() => openPane("connections")}>`. A pane this
  build doesn't show right now (a notes pane with notes off, a hidden host
  pane) does nothing. An id no pane has throws under the dev server
  (`import.meta.env.DEV`) and does nothing in a built app. A component that
  takes no props is still accepted. Blocks don't get it.
- **A pane that shows only sometimes (`visible`, `subscribeVisible`).**
  `visible: () => boolean` says whether the pane shows; absent, always. False
  takes away its nav row, and nothing opens it: not `navOrder` (which skips
  it), not `openPane`, not a request from elsewhere in the app. Settings calls
  it while rendering, so it must be cheap and change nothing. If the answer can
  change while Settings is open, also give `subscribeVisible(onChange)`, which
  calls `onChange` when it may differ and returns the unsubscribe; a zustand
  store's `subscribe` is one. Without it, Settings reads `visible` again only
  when it next renders. A pane that hides while open gives way to General and
  stays there if the pane comes back.

  ```ts
  { id: "synthetic", label: "Synthetic", glyph, Pane: SyntheticPane,
    visible: () => useSyntheticStore.getState().ready,
    subscribeVisible: useSyntheticStore.subscribe }
  ```
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
- **Pane heads.** A host pane's heading is the banner's scenery with no
  character and no object (`SettingsBanner` without `pose` or `motif`), so this
  repository holds no host art.
- **`paneHeads`**: `"rotli"`, the default, keeps each built-in pane's quokka
  pose and motif. `"plain"` gives every built-in pane the same heading as a host
  pane. Every built-in head renders through `PaneHead`
  (`settingsSurface.tsx`). It changes headings only: Appearance's Chat buddy
  studio is part of that pane's body and still draws the quokka.
- **`notes: false`**: Settings without notes. The window is just Settings. It
  has no "Back to notes", none of Rotli's first-run or vault screens, and no
  notes panes (Keybindings, Browser, Librarian, Security, AI Models, Chat,
  Location). General, Appearance, Connections and About stay.
- **`words`**: the updates line; `productName`, which replaces "Rotli"
  wherever Settings' copy means the running app, including the nav's foot,
  Connections' lead, the Dock row's explanation, the connected-tool setup
  steps, "Why a copy?" and the Keybindings titles "Hide …" and "Open or hide
  …" (what stays is listed under "What a host still sees"); `version`, which
  replaces the bundle's version at the foot of the nav; and `aboutLabel`,
  which replaces "About Rotli" as the nav row and the pane's heading. The
  About pane's body stays Rotli's; a host adds to it with `paneBlocks`.
  Rotli's defaults are exactly today's text. Read `productName()` while
  rendering or in a handler, never as a module loads: the first read locks the
  registry.
- **`words.connectionsLead`**: the paragraph that opens Connections, between a
  host's `before` blocks and Web research. A string replaces Rotli's; an empty
  string hides it.
- **`words.notesSectionTag`**: a plain text label after each of Rotli's own
  Connections headings (`.set-section-tag`), to say those sections belong to
  Rotli's notes. Absent or empty, there is no label. The headings are Web
  research, then either Coming soon or, only when the build has `agents`
  (development builds, `lib/featurePolicy.ts`), Remote agents and Extensions. A
  release build of a host therefore shows Web research and Coming soon. A
  host's own blocks are never tagged.
- **`words.dockRow`**: General's "Show in the Dock" switch.
  `{ label?, detail? }` rewords it, each falling back to Rotli's, and an empty
  `detail` shows none. Appearance's App icon line names the switch by the same
  label. `null` retires the switch and shortens that line to "Pick the Dock
  icon." It changes words and the row only: the switch, when shown, still sets
  Rotli's saved Dock setting, and Rotli still applies that setting at first run
  and at launch with the row retired. The lead around the switches names
  `productName`. The note under them, in any host build, says that the app
  takes no system-wide shortcuts, by the same name.
- **`words.aboutBody`**: what the About pane says. A string is one paragraph in
  place of Rotli's own: the lead, the website link, and the feedback link and
  its note. `null` or an empty string drops them. Either way the heading, the
  host's `about` blocks, the version row and the "Built in" credits stay. The
  credits are attribution for third-party editors the host app ships too
  (Excalidraw, Univer), so no word removes them. The version row and the
  credits' sentence use `productName`, and the version row `version`, where a
  host gave them.
- **`aboutGlyph`**: the About row's glyph, where Rotli shows its quokka.

## What a host still sees

With `productName` set, these still say "Rotli" in Settings, on purpose:

- **Sentences about Rotli itself.** Keybindings' "system-wide shortcuts stay
  with Rotli" (Rotli, running beside the host, holds them); "Older versions of
  Rotli" under Security; "Rotli's own format" under General › Link format;
  "from the Rotli studio" under Ambient audio.
- **Rotli's names.** The theme family and the Markdown source palette called
  Rotli; the "What's new in Rotli" action (the highlights are Rotli's
  releases); the "Rotli activity dashboard", named the same way on the
  dashboard and its sidebar card.
- **Rotli's Finder Quick Action.** General still shows "Open in Rotli from
  Finder", though a host never adds it.
- **The agent card (development builds only).** "Use Rotli for your docs" and
  the instruction it copies, which runs Rotli's own app and CLI.
- **About.** The row and heading read `aboutLabel`, and the body `aboutBody`;
  `productName` alone changes neither. The feedback note says "your Rotli
  version" until `aboutBody` replaces it.
- **Rotli (dev), Rotli Web, Rotli Helper and "Rotli for Mac"** copy, which
  only development and web builds show. The updater's description, which no
  host build shows.

**Outside Settings the sweep has not been made.** First-run and vault
screens, chat, the dashboard and sidebar, Librarian Activity, dialogs, error
messages from the services and from Rust, the Welcome catalog and the prompts
models receive still say "Rotli". "Why a copy?" and the connected-tool setup
steps are shared with Settings, so they follow `productName` everywhere.

## Not built yet

- **Hosts can't add yet:** sidebar fronts, first-run steps, or other windows
  or pages.
- **Hosts can't replace the Welcome catalog** (see "The welcome note").
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
- **While the app runs.** After launch a host takes roots and their flags
  only from its open stores, but nothing re-walks an open root: a vault made
  or moved inside one while the app runs is seen at the next launch. The
  registry writers rewrite the registry they read, so an entry planted while
  the app runs is carried forward and vetted at the next launch. Only the
  app's launch (`host_registry::secure_registry`, twice, around the bookmark
  repair) ever sets a registry file aside; the CLI and the MCP server vet it
  in memory and write nothing. There is
  also a short window between the vetting and the bind (TOCTOU) that only a
  same-user process can race.
- **The helper and the CLI walk once per process.** `walked_once` remembers
  each root whose walk below it passed and never walks it again, so a
  long-lived MCP server or helper sees a vault made inside a root only after
  it restarts. The mark and the folders around the root are still checked
  on every load.
- **Which open root is a connected vault, and which an added folder, still
  comes from the registry.** A store doesn't record it. A rewrite can name an
  open added folder as a connected vault; if that folder also holds a valid
  `memex.json`, the memex write lane then writes chats and inbox notes there.
  It is still the host's own marked folder, so no Rotli vault is reached. A
  rewrite that drops a connected vault stops its refresh, which fails
  closed.
- **A vault switched away from keeps its store's write right until the next
  launch.** The registry records the demoted vault's perms from its own
  `memex.json`, but its open store stays writable, as it was while current.
  A host's memex lane follows the store, so it may write chats and inbox
  notes to that vault until relaunch. It is still the host's own vault.
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

- **The after-launch flags (2026-11-25, after `36b36f5b`).**
  `after_launch_a_host_takes_only_the_roots_it_has_open` rewrites the
  registry after launch (a Rotli vault as the current vault with
  `adopted: true`, a writable `brain.perms` on a read-only open vault, an
  active vault that isn't open, and a registry that drops an open root) and
  checks that Settings, the memex write gate, a refresh and the chat and
  note commands take none of it, that a host with no open default store
  shows no vault, and that the standalone build keeps the registry's answer.
  It failed on each of those before the fix. No live host launch has run
  since this change.
- **Live host launches at `14f8636f` and again at `f5c0b217`** (2026-11-25).
  A host build (`bun run mac:build`, Developer ID signed, under a host bundle
  ID) was launched by script in sandbox HOMEs. Every run rendered first run
  with nothing on stderr, apart from the planned exit 73 in run 5:
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
  5. **A support folder that is a link** (at `f5c0b217` only). Launch exited
     73, and nothing was written to the link's target.
- **The host's CLI at `f5c0b217`.** With a planted `corpus.json` naming the
  synthetic vault, `roots` and `notes list` answered from the scratch vault
  alone and wrote nothing into the synthetic vault. The planted file stays on
  disk until the next app launch sets it aside.
- **Not proven live.** Rotli's own app was never launched. The exit-78 stop
  and the plugin gating are proven by code, unit tests and source-order
  fences only. The notes-off window, a host pane, pane blocks, the nav order
  and the host's words are proven by server-side rendering only.

- **Standalone Settings after the pane heads, Connections, Dock row and About
  words** (2026-11-25, browser lane, synthetic data, no host): every pane was
  captured before and after, three runs each, in the development and the stable
  channel. The DOM matched in all 66 after shots, ids minted per run aside.
  Pixels differed by at most 60, never more than one step in a colour channel.
  In the development channel one after run matched a before run on all 11
  panes. In the stable channel one of six after runs matched on 10; Security
  differed by 9 pixels, as many as two before runs differ by in the
  development channel.
- **The same words under a synthetic host**, injected in the test browser only:
  plain heads, a replaced Connections lead, tagged headings, a reworded Dock
  row, and a replaced About paragraph above the credits, in the light theme.
- **The product name sweep, pane links and hidden panes** (2026-11-26, no
  Rust change). Server markup of every pane, with the Mac shell's copy, a
  connected vault and the armed "Remove vault?" button, was identical before
  and after with no host, text-node boundaries included (56 renders). Browser
  lane, development and stable channels, three runs each side: the DOM matched
  in all 66 after shots, ids minted per run aside. The pixels that differed
  were never more than one step in a colour channel, in places where two runs
  of the unchanged commit also differ or another after run matched exactly.
  Under a synthetic host injected in the test browser only, links opened a
  gated pane and Connections (the latter by keyboard), and the gated pane's
  row appeared, disappeared and fell back to General while Settings was open.
  No native build was launched.
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
  `src/components/settings/settingsNav.test.ts`,
  `src/components/settings/connectionsSettings.test.tsx` and
  `src/components/settings/settingsSurfaceHost.test.tsx`.
