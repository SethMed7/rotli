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

## One process per support folder

A host build's launch rewrites state in its support folder: it sets registry
files aside and settles the scratch vault. Two processes on one folder would
rewrite each other's state mid-session, so a host build runs as one process
per support folder (`src-tauri/src/single_instance.rs`).

- **The lock.** The first thing `launch()` does, before the Tauri builder,
  any plugin or any window, is take an exclusive `flock` on
  `<support folder>/instance/lock` and keep it for the process's life. Only a
  binary whose Tauri context names the ID it was compiled for takes it
  (`single_instance::takes_lock`): a stale build whose context names another
  ID writes nothing there, never nudges the real app, and setup stops it
  with 78 as before. The folder is made 0700 and the file 0600, an older
  file included, each through a descriptor opened without following a link.
- **The support folder** comes from `HOME` there, since Tauri doesn't exist
  yet. Setup checks that Tauri's `app_config_dir` is the same folder before
  Rotli's own setup touches it, and exits 73 if not; plugin setup hooks, a
  host's included, have already run during `build()`. A missing `HOME` exits
  73 too. On macOS both read `HOME`: Tauri 2.11's `app_config_dir` is
  `dirs::config_dir()` joined with the identifier, and `dirs` 6 makes that
  `$HOME/Library/Application Support`.
- **A second process** that can't take the lock runs no launch setup. It
  writes `<support folder>/instance/nudge` and exits with status **75**
  (`EX_TEMPFAIL`), whether or not the nudge could be written; its stderr line
  says which. A launch first waits out a brief holder for up to two seconds
  (40 tries, 50 ms apart): a `rotli open` probe holds the lock for an
  instant, and so might a relaunch whose parent is still exiting.
- **A holder that is gone leaves no lock.** The kernel drops a `flock` when
  its descriptor closes, a crash or `kill -9` included, and Rust opens files
  close-on-exec, so no child process inherits it. The file stays, unlocked.
- **Links.** A support folder that is a link is refused (exit 73) before the
  lock writes anything, as the scratch vault refuses it. A link or a file at
  `instance`, or anything but a regular file at `instance/lock`, is set aside
  as `<name> (set aside <time>)`, the entry itself and never its target. The
  lock file is opened with `O_NOFOLLOW` and a regular one is never renamed
  or removed, since another process may hold it.
- **The nudge.** The holder watches the `instance` folder (FSEvents through
  `notify`, not recursive). On a nudge it does what a Reopen does for `open`
  in the standalone build: it shows the main window and emits
  `rotli:open-request`, so the webview consumes the `rotli open` mailbox. A
  nudge carries no request. A host build has no deep-link plugin, and macOS
  hands a running app the files and URLs it opens as an `Opened` event (see
  "Opened URLs"), so a second launch has no argv or link to pass on. For
  what a forged nudge and mailbox can reach, see the threat model's
  host-identity boundary.
- **Why `flock` and not Tauri's single-instance plugin.** On macOS the plugin
  (read from its `v2` branch source on 2026-11-26, not a pinned release)
  binds a socket in `/tmp` named from the bundle ID (`.` and `-` turned into
  `_`): one socket per bundle ID for every HOME on the machine, not one per
  support folder. It detects a holder by connecting, then removes the file
  and binds, so two launches at the same moment can both win. A `flock` is
  atomic, per folder, and released by the kernel. A Unix socket in the
  support folder would give the sender an answer, but `sun_path` is 104 bytes
  on macOS and a sandbox HOME plus `Library/Application Support/<bundle
  ID>/instance/…` can pass that, so the channel is a watched file instead.

### `rotli open` under a host

The host's CLI writes the open request into its mailbox only after it has
decided how to reach the app (`single_instance::open_plan`), so a refusal
leaves nothing queued for a later launch.

1. **An instance holds the lock:** the CLI writes the request, nudges the
   holder, and launches nothing.
2. **None does:** it runs `open -a <the .app containing this binary>`, found
   from the canonical `current_exe` in the exact shape
   `X.app/Contents/MacOS/<binary>`. It never runs `open -b <bundle ID>`:
   Launch Services can resolve that to another build with the same ID (an
   unsigned development build, say), which then ran launch setup against the
   running instance's support folder.
3. **The binary isn't inside an `.app`:** it refuses and says so, and writes
   no request.

**Standalone Rotli** takes no lock, watches nothing, and still runs
`open -a rotli`. Giving it the lock too is an open choice for the
maintainer.

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
- **Files and folders opened from Finder.** Standalone Rotli gets them from
  its deep-link plugin; a host build gets them from its run loop (see
  "Opened URLs"). Both reach `open_from_finder` (`open_requests.rs`), which
  refuses before it binds anything: a folder meets `reject_privileged_root`
  (and again in its window's mount, `folder_window.rs`), and a file meets
  only `refuse_existing_vault` (`mount_opened_file`), as in standalone Rotli,
  where the person chose it in Finder. So a host opens no file or folder
  inside a vault it doesn't own, and says so in the main window: the host's
  `existing_vault_file` sentence alone for a file, and its `existing_vault`
  sentence after "Couldn't open that folder —" for a folder, whose refusal can also be another check's. In standalone Rotli both refusals behave as before. Under a host a
  folder is walked twice, once for each check (up to 50,000 folders each, on
  background threads): the vault-binds guard wants the refusal in the
  function that makes the call, and `mount_and_show` keeps its own.
- **Paths that never reach a host build.** The relay's MCP root is the vault
  the app already has open, and pairing needs the Keychain, which a host build
  refuses.
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

- **Order.** After the instance lock (75 or 73, before the Tauri builder),
  the identity check (78), the support-folder check (73) and the scratch
  vault (73),
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
  it has no Keychain, and where it refuses an existing vault;
  `existing_vault_file` is the sentence for a file opened from Finder inside
  a vault it doesn't own. Rotli's defaults are neutral. `welcome_note` is the first note written into an empty notes
  folder, a host's scratch vault included (see "The welcome note" below).
  `product_name` is the name in the menu-bar item and the app menu's Quit
  (see "The menu-bar item" below);
- **`without_tray()`**: no menu-bar item from Rotli (see "The menu-bar item");
- **`on_opened_urls(…)`**: its handler for the URLs macOS opens the app with
  (see "Opened URLs");
- **`start_hidden(…)`**: whether this launch keeps its window hidden, asked
  as the app finishes launching (see "A quiet start"). The predicate can read
  `host::launched_as_login_item` and `host::pending_opened_urls`.

Three calls reach the running shell from a host's own code: `host::show_main`
and `host::quit` (see "The menu-bar item"), and `host::open_settings` (see
"Opening Settings").

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
field (`welcome_note: None` keeps today's note, `product_name: None` keeps
"Quit rotli"), or use `..Default::default()` only when it leaves at least one
field unset. With every field set, the struct update has no effect: clippy's
`needless_update` rejects it in a crate that denies warnings (plain `rustc`
accepts it). `product_name` arrived after `welcome_note` (2026-11-27), and
`existing_vault_file` after that (2026-11-27), so a host that lists every
field adds each when it repins. A host that set its own `existing_vault` and
wants its own words for a file too sets `existing_vault_file`; otherwise a
file gets Rotli's neutral file sentence.

### The menu-bar item

Standalone Rotli has one menu-bar item (tray id `rotli`): its mark, a menu
with "Open rotli" and "Quit rotli", and a left click that shows or hides the
main window. A host keeps it by default, and `HostWords::product_name`
renames both items and the app menu's Quit ("Open Synthetic", "Quit
Synthetic"). `None`, an empty name or one of only spaces keeps Rotli's
strings exactly, lower-case included. The labels come from `host::open_label`
and `host::quit_label`.

A host that ships one menu-bar item of its own calls `without_tray()`. Rotli
then builds no tray icon and no tray menu: every tray API Rotli touches is in
`host::build_tray`, which the shell calls only with the tray on, and nothing
else in Rotli (Rust or the front end) looks a tray up, sets its title or swaps
its icon. A fence (`host::tests`) keeps it that way. Rotli's closed windows
hide rather than close, as before; the host's item is then the way back, or the
Dock icon when "Show in Dock" is on. Rotli starts as a menu-bar app
(`Accessory`) until the person's Dock setting applies, as it always has.

The host's tray calls two functions, each a thin wrapper over what Rotli's own
items do:

- **`rotli_lib::host::show_main(&AppHandle)`** shows and focuses the main
  window (`SummonIntent::ShowMain`, Rotli's "Open rotli").
- **`rotli_lib::host::quit(&AppHandle)`** quits as ⌘Q does (`graceful_quit`):
  every window saves and flushes first, then the app exits. It returns at
  once. A window that can't save keeps the app open and says why in the main
  window.

```rust
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::TrayIconBuilder;

let host = rotli_lib::AppHost::new(context)
    .without_tray()
    .words(rotli_lib::HostWords { product_name: Some("Synthetic".into()), ..Default::default() })
    .plugin(
        tauri::plugin::Builder::<tauri::Wry>::new("synthetic-tray")
            .setup(|app, _| {
                let notes = MenuItemBuilder::with_id("synthetic-notes", "Open Notes").build(app)?;
                let quit = MenuItemBuilder::with_id("synthetic-quit", "Quit Synthetic").build(app)?;
                let menu = MenuBuilder::new(app).items(&[&notes, &quit]).build()?;
                TrayIconBuilder::with_id("synthetic")
                    .icon(tauri::image::Image::from_bytes(include_bytes!("../icons/tray.png"))?)
                    .menu(&menu)
                    .on_menu_event(|app, event| match event.id().as_ref() {
                        "synthetic-notes" => rotli_lib::host::show_main(app),
                        "synthetic-quit" => rotli_lib::host::quit(app),
                        _ => {}
                    })
                    .build(app)?;
                Ok(())
            })
            .build(),
    );
rotli_lib::run_with_host(host);
```

Give the host's items ids other than `open`, `quit` and Rotli's app-menu ids
(`quit-app`, `close-tab`, `close-window`, `edit-undo`, `edit-redo`): Rotli's
app-wide menu handler matches those. A host's own Quit should call
`host::quit`, never `AppHandle::exit`, which skips the flush.

### Opened URLs

macOS hands an app the files and URLs it opens (Open With, a Dock drop, a
link in the host's own scheme from `CFBundleURLTypes`) as
`RunEvent::Opened`. Under `run_with_host` Rotli owns the run loop, so a host
passes a handler:

```rust
rotli_lib::AppHost::new(context).on_opened_urls(|app, urls| {
    for url in urls {
        // synthetic-host://… : the host's own routing
    }
});
```

- **What the host gets:** every URL in the event that isn't a `file:` URL,
  in order, in one call (URLs held until setup come together in one call). A `rotli://` URL is the host's too: it never reaches
  Rotli's link handling in a host build. An event with no such URL makes no
  call.
- **What Rotli keeps:** the `file:` URLs, files and folders. Rotli opens them
  after the hook returns, as Finder's Open With opens them in standalone Rotli
  (`open_from_finder`), behind the vault refusal (see "Where Rust checks").
  The host's bundle must declare the document types itself
  (`CFBundleDocumentTypes`) for Finder to offer it.
- **When:** never before Rotli's setup is done. AppKit can send the files a
  launch was asked to open before the app finishes launching, so before
  setup has checked the identity (exit 78), opened the vaults or made the
  main window. `host::on_run_event`, the first statement of the run loop's
  closure, holds every `Opened` URL that arrives before then
  (`host::OpenedQueue`). Setup releases them, in the order they came, right
  after the vaults open, where standalone sweeps its deep-link plugin's
  `get_current()`. So the hook can run during setup, with the main window
  made and `show_main` safe, but before Rotli's own tray (when on) and its
  app-menu Quit exist; a host's plugins have already run their setup. After
  setup, each event goes straight through. A file refused on a cold launch
  raises its notice during setup, before the page listens; the notice is
  held until it does (see "Held for the page").
- **Read early, delivered later:** `host::pending_opened_urls()` shows a
  `start_hidden` predicate the held URLs and takes none of them (see "A quiet
  start").
- **Order within an event:** the hook runs first, in one call, then Rotli
  opens the files (`host::dispatch`, unit-tested with recording closures).
  Fences keep the queue in front of both and the release after the identity
  check and the vaults.
- **The hook must never block or run a modal.** It runs on the main thread,
  inside tao's handler for the event, so hand slow work off and show any
  window or dialog after it returns (`app.run_on_main_thread` from a spawned
  thread, for example). A nested run loop (a blocking dialog, say) during the
  hook lets a second `Opened` arrive while tao still holds its handler lock,
  and tao locks it again: the app deadlocks or panics. Standalone's deep-link
  path has the same rule.
- **Standalone** passes no hook and its deep-link plugin takes every URL, as
  before: the run-loop path runs only when `owns_shared_state()` is false. A
  crate that calls `run_with_host` but is built with Rotli's own bundle ID is
  standalone, so its `on_opened_urls` hook is never called.

### Opening Settings

`rotli_lib::host::open_settings(&AppHandle, pane_id: &str)` shows the main
window on Settings › that pane, Rotli's or the host's:

```rust
rotli_lib::host::open_settings(app, "synthetic-account"); // a host pane
rotli_lib::host::open_settings(app, "appearance");        // a built-in pane
```

- **It follows a pane link's rules** (`openPane`, `opensPane` in
  `settingsNav.ts`). An id no pane has does nothing, and warns in the
  console under the dev server (a link throws there; a request from outside
  only warns). A pane whose `visible` says no, a notes pane in a host
  without notes, and a pane this platform doesn't show do nothing too. Only
  the page knows the host's panes, so Rust sends the id and the page judges
  it (`src/services/hostRequests.ts`, `settingsPaneOpens`).
- **What "nothing" means.** For an id that opens nothing, Settings doesn't
  open and the window doesn't come forward, with one exception: a request
  held from before the page listened (see "A cold launch"). For one that does, the page
  sets the same store request the app's own links use
  (`setSettingsPaneRequest`, then `setSettingsOpen(true)`) and then asks
  Rust to show the window (`show_main_window`). In a host without notes,
  Settings is already the whole window, so only the pane request is set:
  the open flag would switch the titlebar to its Settings identity.
- **The route.** No Rust-to-page Settings event existed, so there is one
  now, `rotli:open-settings`, and it ends in that existing store route.
- **A cold launch.** A request made before the page listens (from a host
  plugin's setup, or during `start_hidden`'s quiet launch) is held and
  delivered once it does (see "Held for the page"). Several held requests
  run in order; the last pane that opens is the one shown.
- **When the pane is judged.** A held request is judged when the page first
  listens, not later. A host pane whose `visible` depends on state the host
  loads afterwards doesn't show yet, so the request opens no pane. It still
  brings the window forward, on whatever it shows, so a quiet start never
  swallows an explicit request. To land on such a pane, request it again
  once its `visible` says yes. A request made after the page listens is
  judged when it arrives, and one that opens nothing does nothing.
- **Behind a setup screen.** In a host with notes, a request during first
  run or another setup screen sets the pane request behind that screen: the
  window comes forward on setup, and Settings shows on the pane once setup
  ends.
- It returns at once and reports nothing back: the host can't tell whether
  the pane opened.

### A quiet start

A host that registers as a login item (`SMAppService`) wants that launch to
start with no window. A host with a URL scheme may want the same for a launch
through one of its URLs, so that only its own window shows. It passes
`AppHost::start_hidden(|| …)` and reads both inside it, with
`rotli_lib::host::launched_as_login_item()` and
`rotli_lib::host::pending_opened_urls()`:

```rust
rotli_lib::AppHost::new(context)
    .start_hidden(|| {
        rotli_lib::host::launched_as_login_item()
            || rotli_lib::host::pending_opened_urls().iter().any(|url| url.scheme() == "synthetic-host")
    })
    .on_opened_urls(|app, urls| {
        // synthetic-host://run/… : show the host's own window for it, after
        // this returns (see "Opened URLs")
    });
```

A host whose other URLs should still open `main` narrows the test, to
`url.host_str() == Some("run")` as well, say.
`pending_opened_urls()` holds every waiting URL except `file:` ones, and
that includes `rotli://` deep links, so `!is_empty()` alone would hide `main`
for a Rotli link too. Test the scheme, as above.

- **When it is asked.** Once, at the start of Rotli's setup, right after the
  identity check (`host::decide_at_launch`). Setup runs inside
  `applicationDidFinishLaunching`. tao's delegate calls
  `AppState::launched`, which dispatches `NewEvents(StartCause::Init)`
  synchronously (tao 0.35.3 `app_delegate.rs:125`, `app_state.rs:284-307`).
  tauri-runtime-wry maps that to `RunEvent::Ready` (2.11.4 `lib.rs:4173`).
  tauri runs `setup` inline there (2.11.5 `app.rs:1423`), building the config
  windows (`app.rs:2524`) and then calling Rotli's setup closure. That is the
  one moment the launch's Apple event is current. A plain AppKit probe saw
  no current event in `applicationWillFinishLaunching`, the `oapp` event in
  `applicationDidFinishLaunching`, and none a run-loop turn later. So a
  predicate asked in `launch()`, before `run`, could never see the login
  flag.
- **`pending_opened_urls()`** returns the URLs already held for setup, `file:`
  ones left out (`host::OpenedQueue`), and takes nothing: the hook is handed
  the same URLs when setup releases them. It is meant for the predicate. It is
  empty in standalone Rotli, which never fills the queue, after the release,
  and off macOS. It answers with or without an `on_opened_urls` hook, but a
  host that stays hidden for a URL needs the hook to show anything for it.
- **A launch URL has been there in time in every run seen, but nothing
  guarantees it.** tao and tauri add no delay and no order
  of their own: tao installs the run loop's callback before `[NSApp run]`
  (0.35.3 `event_loop.rs:233-234`) and passes `application:openURLs:` straight
  to it (`app_state.rs:309-311`); tauri-runtime-wry forwards `Opened`
  (2.11.4 `lib.rs:4387`) and tauri hands it to the app's closure without
  waiting for setup (2.11.5 `app.rs:1438`, `app.rs:2630`), where Rotli holds
  it. The order itself is AppKit's. A bare tao 0.35.3 app on macOS 27.0.1,
  launched with a URL by `open -a`, got `Opened` before
  `applicationDidFinishLaunching` in 8 launches of 8. That is one probe, not
  a promise: if a launch URL ever arrives after the decision, the predicate
  sees none and answers as for a plain launch, `main` shows, and the hook
  still gets the URL.
- **A URL can still arrive after the decision.** One opened while the app is
  already launching or running is not part of the launch: in the same probe, a
  second URL opened right behind the first arrived just after
  `applicationDidFinishLaunching`. The predicate doesn't see it. It goes to the
  `on_opened_urls` hook, which setup has released by then. So show the host's
  window from the hook, for every URL that wants it, whatever the predicate
  answered. After a no, `main` is already up, and a late URL doesn't hide it.
- **`launched_as_login_item()`** is true when the current Apple event is
  `kAEOpenApplication` and its `keyAEPropData` is
  `keyAELaunchedAsLogInItem`. It is false anywhere else: outside the
  predicate, on other platforms, and in a launch from Finder, the Dock or
  `open`. A host can read the flag its own way, at the same point.
- **Why nothing can flash.** With a predicate, `host::apply_at_launch` sets
  `visible: false` on the context's `main` entry before `.build(context)`,
  whatever the predicate will say. tao never orders a hidden window front
  (`makeKeyAndOrderFront` runs only when `visible`), and the page loads in
  it. The page's load-time call (`persist.ts`, which passes `atLaunch`) is
  skipped until the decision, and after a yes, so the page can't show the
  window first. A no shows the window in setup, then the page's call shows
  it as standalone's does. tao still zooms the window (`maximized`) after
  making it. A plain AppKit probe showed `zoom:` leaves a window that was
  never ordered front off screen, and that it shows zoomed later.
- **Nothing here hides a window**, so a show before the decision stands: a
  request held for the page, or a `show_main` from a host's
  `on_opened_urls` hook. A `show_main` from a host plugin's own `setup` does
  nothing: plugin setup runs inside `build()`, before the `main` window
  exists, so after a yes the window stays hidden. A host that wants the
  window up from its plugin setup returns no from its predicate instead, or
  calls `open_settings`, which is held for the page.
  After a yes, the load-time call is skipped on every load of `main` in the
  process, a reload included. That changes nothing, since a reload leaves
  the window as it was.
- **A relaunch shows its window.** Rotli's relaunch (a demo-mode switch, an
  update, a vault change) goes through `open -n` or a direct start. Neither
  is a login launch: the probe's `open -n … --args --synthetic-login` got an
  `oapp` with no login flag. So the predicate above answers no, whatever
  arguments the relaunch carries, and it carries no URL. So the example above
  answers no. A predicate keyed on an argument would answer yes again, which
  is why it reads the flag.
- **Showing it later:** `host::show_main(app)`, `host::open_settings(app,
  …)`, or the Dock icon when "Show in Dock" is on (macOS sends `Reopen`;
  it shows the window only when none of Rotli's windows is up). So do a
  second launch of the app and `rotli open` (both nudge the running
  instance, which shows the window), a file opened from Finder and a refused
  one, because each says where it went, and a failed quit flush.
- **Onboarding waits too.** A quiet start skips the load-time show on a
  first run as well, so a new install launched quietly shows its onboarding
  only once the host shows the window.
- **Standalone** passes no predicate. The window list is untouched, nothing
  is asked in setup, and the page's call shows the window exactly as before,
  at the same moment. Unit tests compare the whole window list with the
  config's.
- **Fences** tie the wires together: launch arms the one state the command
  reads, setup decides after the identity check and before the opened-URL
  release, and `persist.ts` and `tauri.ts` send `atLaunch`. Reverting any
  of them fails a test.

### Held for the page

Rotli's setup runs before the main page loads, and a page hears only the
events sent after it listens. So Rust holds what it sends the main page
until the page says it listens:

- **What is held:** main's refusal notices (`host::notice`: a file refused
  under a host, a folder refused in either build) and `open_settings`
  requests. A fence keeps every main-bound `rotli:open-notice` and every
  `rotli:open-settings` in `host.rs`, behind the hold.
- **How it is released.** The page registers both listeners, waits until
  they are registered, then calls `host_page_ready`, which returns what was
  held (notices first, then Settings requests, each in the order it came).
  From then on each one is sent as it comes. Listening before taking means
  nothing falls between the two (`attachPageRequests`). Several held
  notices show as one, since the notice line shows one at a time. If the
  call fails after Rust let go, the dev server warns in the console.
- **The first load only.** The hold ends at the first `host_page_ready`. A
  notice or request sent while `main` reloads (after a content-process
  crash, say) goes to no listener, as before.
- **Only main releases.** Every window loads the same bundle; a call from
  any other window gets nothing and releases nothing.
- **React's development double mount** tears down the first mount before it
  listens, so that mount never takes; the second does. A mount torn down
  after it took still delivers, since Rust has already let go.
- **Standalone** takes the same path: a folder Finder opens Rotli with on a
  cold launch that `reject_privileged_root` refuses is held like a host's
  notice, where before it went to no listener. That it then shows is not
  proven live (see "Proof"). A warm notice arrives as before.
- **Where a notice shows:** the sidebar's error line, as before. A host
  without notes has no sidebar, so a notice shows nothing there (as before).

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

## Scoping Rotli's commands

**A host that adds local webviews of its own must do this, and close what
"What command permissions don't cover" lists.** Standalone
Rotli's `build.rs` declares no app manifest, and a host's doesn't by default.
Without one, Tauri 2.11 checks permissions only for plugin commands and for
remote origins. Rotli's own commands (`corpus_read`,
`corpus_write_file_bytes`, `app_settings_write` and the rest) then run for any
local page, and a page on a URI scheme the host registered is local. Remote
pages, Rotli's private browser and pinned sites among them, are refused either
way.

### The list

`src-tauri/app-commands.json` is checked in so a build script can read it
without depending on `rotli_lib`:

```json
{ "version": 1, "commands": ["agent_bridge_ready", "…"], "webviews": ["capture", "chat", "finder_*", "main", "quick"] }
```

- `commands`: every command in Rotli's `generate_handler!`, by the name the
  front end invokes, sorted.
- `webviews`: the webview labels and label patterns Rotli's capability files
  name. `finder_*` is a folder window.

`check:ipc` fails when:

- `commands` differs from the handler in either direction, or `webviews` from
  `src-tauri/capabilities/**`;
- either list is unsorted or repeats a name;
- a label is a glob pattern other than `finder_*`. Tauri reads labels as
  patterns, so a `*` would give every local webview every command;
- a capability targets `windows` or grants `remote` pages, since each label it
  names is published as one that gets every command;
- a capability is in a shape the check doesn't read (a list of capabilities,
  TOML, JSON5, or one written inline in a `tauri*.conf.json`);
- there is more than one `invoke_handler` (Tauri keeps the last), a handler
  entry isn't a plain path, or a `#[command(rename = …)]` would register a
  name the list can't show.

### The host's `build.rs`

`serde_json` goes in `[build-dependencies]`. Point `ROTLI_COMMANDS` at the
list in the same Rotli checkout the host compiles, so the list and the code
can't come from different commits.

```rust
use std::fs;

/// Rotli's list, in the checkout this host pins, relative to the host crate.
const ROTLI_COMMANDS: &str = "../rotli/src-tauri/app-commands.json";
const COMMAND_SET: &str = "permissions/rotli-commands.toml";

fn main() {
    println!("cargo:rerun-if-changed={ROTLI_COMMANDS}");
    let text = fs::read_to_string(ROTLI_COMMANDS).expect("read Rotli's command list");
    let list: serde_json::Value = serde_json::from_str(&text).expect("the list is JSON");
    assert_eq!(list["version"], 1, "unknown command list version");
    let names: Vec<String> =
        serde_json::from_value(list["commands"].clone()).expect("command names");
    // with no names Tauri builds no app manifest, and so checks no app command
    assert!(!names.is_empty(), "Rotli's command list is empty");

    // one set holding every allow-<command>, so the capability names one thing
    let allow: Vec<String> = names
        .iter()
        .map(|name| format!("allow-{}", name.replace('_', "-")))
        .collect();
    let set = format!(
        "[[set]]\nidentifier = \"rotli-commands\"\ndescription = \"Rotli's app commands\"\npermissions = {}\n",
        serde_json::to_string(&allow).expect("a TOML array")
    );
    fs::create_dir_all("permissions").expect("create permissions/");
    if fs::read_to_string(COMMAND_SET).ok().as_deref() != Some(set.as_str()) {
        fs::write(COMMAND_SET, set).expect("write the command set");
    }

    // AppManifest wants 'static names; a build script may leak them
    let commands: Vec<&'static str> = names.into_iter().map(|name| &*name.leak()).collect();
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(commands.leak())),
    )
    .expect("tauri build");
}
```

### The host's capability

`capabilities/rotli-commands.json`:

```json
{
  "identifier": "rotli-commands",
  "description": "Rotli's app commands, for Rotli's own webviews only",
  "webviews": ["capture", "chat", "finder_*", "main", "quick"],
  "permissions": ["rotli-commands"]
}
```

- **`webviews`, never `windows`.** A `windows` grant covers every webview
  inside that window, so a host page added as a child of `main` would get every
  command.
- **The labels** are the list's `webviews`. A host that would rather not keep
  them in step by hand can write this file from `build.rs` the same way. A
  Rotli window missing from it is refused every command.
- **Host labels.** No host webview may take one of those labels or start with
  `finder_`, whether Rust creates it or a page does at run time. Give host
  webviews none of `core:webview:allow-create-webview`,
  `core:webview:allow-create-webview-window` and `core:window:allow-create`:
  with them a page could open a `finder_…` webview on its own scheme and get
  every command.
- **Rotli's other capabilities** (core and plugin permissions,
  `src-tauri/capabilities/`) are unchanged by this. The host's context carries
  its own copies, for Rotli's labels only, by `webviews`.

### Permission identifiers

For each name given to `AppManifest::commands`, `tauri-build` 2.6.3 (through
`tauri-utils` 2.9.3) generates two permissions:

| For `corpus_read` | Rule |
|---|---|
| `allow-corpus-read` | `allow-` and the command with `_` turned into `-` |
| `deny-corpus-read` | the same with `deny-` |

- They take **no prefix** in a capability. `allow-corpus_read` fails the build
  as an invalid identifier.
- Tauri generates **no `default` or set** for an app manifest. `rotli-commands`
  above is a set `build.rs` writes. Listing every `allow-…` in the capability
  works too.
- A capability that names a permission the manifest lacks fails the build.
- Tauri writes `permissions/autogenerated/<command>.toml` into the host crate.
  Those files and `permissions/rotli-commands.toml` are generated, so the host
  can leave them out of git. Tauri doesn't delete the file of a command that
  left the list; the set no longer names it.

### What changes, and what doesn't

- Once the manifest exists, **every app command is checked for every webview**,
  Rotli's included. A command missing from the grant is refused in Rotli's own
  windows, which is why the check above runs in both directions.
- Folder windows get every command, as they do in standalone Rotli.
- A host's own commands are plugin commands and keep their own permissions.

### What command permissions don't cover

Command permissions are one layer, not a sandbox. Load into a host's webviews
only pages the host ships, never third-party content. This list isn't claimed
to be complete.

- **Code in Rotli's webviews.** Scoping separates webviews, not code. The panes
  and blocks a host registers (see "The host registry") are bundled into
  Rotli's front end and run in Rotli's webviews, so they can call every
  command. A host page that shouldn't have that belongs in a webview of its
  own.
- **Events: give host webviews no `core:event` permission at all.** They are a
  way to read and a way to write, and neither needs an app command.
  - *Read.* `listen` defaults to the target `Any`, and Tauri hands an `Any`
    listener every event, those emitted to `main` by label included. A host
    page that may listen gets what Rotli's windows tell each other, the text
    of a quick capture (`rotli:capture`) among it, which Rotli files as a
    secure note.
  - *Write.* A page that may emit can send `rotli:capture` itself, and `main`
    then writes a secure note into the open vault.
  - `core:default` contains `core:event:default`. Don't copy Rotli's
    `default.json` or `folder-windows.json` grants to a host webview.
- **`asset:` reads files.** Tauri registers `asset:` on every webview, checks
  one app-wide scope, and answers with the asking webview's own origin in
  `Access-Control-Allow-Origin`. Rotli adds every open vault, folder window
  and Finder-opened file to that scope. So a host page can `fetch()` any file
  there whose path it knows or guesses, secure notes included.
  - Dot-files and dot-folders, `.rotli/` among them, stay out by default. The
    host's own `tauri.conf.json` decides:
    `app.security.assetProtocol.scope.requireLiteralLeadingDot`, true on macOS
    when unset. Don't set it to `false`.
  - Tauri adds `app.security.csp` only to its own pages. A page on a host
    scheme has no CSP unless the host's scheme handler sends one, so send one
    that leaves `asset:` out on every page:

    ```http
    Content-Security-Policy: default-src 'self'; connect-src 'self' ipc: http://ipc.localhost; object-src 'none'; base-uri 'none'; form-action 'none'
    ```

    `ipc:` is for the page's own commands; `default-src 'self'` keeps
    `asset:` out of fetches, images, media and frames.

The scope results come from a mock-runtime probe (see "Proof"). The event
routing, the CORS header, the missing CSP and the header's effect are read from
the Tauri 2.11.5 sources and the CSP rules, not run in a WKWebView.

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
  it while rendering, so it must be cheap, change nothing and not throw (a
  throw takes Settings down with it). If the answer can change while Settings
  is open, also give `subscribeVisible(onChange)`, which calls `onChange` when
  it may differ and returns the unsubscribe; a zustand store's `subscribe` is
  one. Without it, Settings reads `visible` again only when it next renders. A
  pane that hides while open gives way to General and stays there if the pane
  comes back.

  ```ts
  { id: "synthetic", label: "Synthetic", glyph, Pane: SyntheticPane,
    visible: () => useSyntheticStore.getState().ready,
    subscribeVisible: useSyntheticStore.subscribe }
  ```
- **Focus after either switch.** When a link or a hidden pane takes the
  focused control with it, focus moves to the new pane's nav row instead of
  dropping to the page. Focus that survives the switch stays where it is, and
  clicking a nav row is as before.
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
  wherever the app's copy means the running app (see "The words, everywhere"),
  in Settings including the nav's foot,
  Connections' lead, the Dock row's explanation, the connected-tool setup
  steps, "Why a copy?" and the Keybindings titles "Hide …" and "Open or hide
  …" (what stays is listed under "What a host still sees"); `version`, which
  replaces the bundle's version at the foot of the nav; and `aboutLabel`,
  which replaces "About Rotli" as the nav row and the pane's heading. The
  About pane's body stays Rotli's; a host adds to it with `paneBlocks`.
  Rotli's defaults are exactly today's text. The first read of `productName()`
  locks the registry, so nothing may read it before the host registers. After
  that it is safe, module loads included: the host's registration module runs
  before `main.tsx` is imported, and `app.tsx` reads the name as it loads
  (`registerDefaultActions()`), which fixes the two action titles for the
  app's life. So the module that calls `registerHost`, and anything it
  imports, must not read it before that call.
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
  `productName`. In a host build, the note under them and the hint on each
  system-wide row of Keybindings agree: with a `productName`, both say that
  app takes no system-wide shortcuts; without one, both keep Rotli's words,
  that the shortcuts stay with Rotli.
- **`words.aboutBody`**: what the About pane says. A string is one paragraph in
  place of Rotli's own: the lead, the website link, and the feedback link and
  its note. `null` or an empty string drops them. Either way the heading, the
  host's `about` blocks, the version row and the "Built in" credits stay. The
  credits are attribution for third-party editors the host app ships too
  (Excalidraw, Univer), so no word removes them. The version row and the
  credits' sentence use `productName`, and the version row `version`, where a
  host gave them.
- **`aboutGlyph`**: the About row's glyph, where Rotli shows its quokka.

## The words, everywhere

`productName` is not only Settings' word. Wherever Rotli's copy says "Rotli"
and means the running app, the copy reads it: first run and the vault screens,
Home's activity card and the dashboard, the search field, chat's notices,
Breve's panes, dialogs, and the errors and notices from the services and from
Rust. With no host every sentence reads exactly as before.

- **`productName()`** (`src/host/registry.ts`) where Rotli writes "Rotli".
- **`inlineName()`** where Rotli writes its lower-case wordmark: "Message
  rotli…", "read-only for rotli". It is the host's `words.inlineName`, else its
  `productName`, else "rotli".
- **Rust.** `app_identity::app_name()` ("Rotli") and
  `app_identity::product_name()` ("rotli"), both from
  `HostWords::product_name`, so a host repinning sets no new field. The
  folder pickers' titles ("Add a folder to rotli"), the quit refusals, the
  Finder-open refusals, and the vault and file errors a person reads use
  them.
- **The window title.** Under a host the page sets `document.title` to
  `productName` as `app.tsx` loads; standalone leaves `index.html`'s title
  alone. The native window's title and the app menu's name come from the
  host's own Tauri config.
- **Never as a module loads.** A host's registration module imports its own
  panes, and they import Rotli's components and stores before it calls
  `registerHost`, so a constant that read the name at import would lock the
  registry first and registering would throw. Every routed constant reads it
  inside a function or a getter (`mainReloadedNotice()`,
  `HEALTH_LABELS.managed`), and `check:product-name` fails a `productName()`,
  `inlineName()` or `appHost()` call at a module's top level anywhere but
  `src/app.tsx`, which loads after the host has registered.
- **The theme family a parsed settings file lacks** is the host's too
  (`parseSettings`), because a host's first launch already has its scratch
  vault bound and reads that vault's empty settings.
- **The note card's "Saved in … at …"** comes from the host's own note flow,
  not from Rotli, so the host words it.

### Keeping the name honest

`check:product-name` (`scripts/check-product-name.mjs`, in both lint chains)
reads every string a person can read that names the app: TS and TSX under
`src/` with the TypeScript compiler (string literals, template parts and JSX
text; not comments, imports, class names or console lines), Rust string
literals under `src-tauri/src/` (not test modules, printed lines or `rotli: `
log lines), and `index.html`'s title. Each one either goes through the words
above or is listed in `scripts/product-name-allowlist.json` with a category.
A new string fails, and so does a listed string that is gone or has no
category. It doesn't read JSON assets (the Welcome catalog), CSS `content`
or Markdown notes; those are listed under "What a host still sees".

## The look

- **`themeFamily`**: the theme family a fresh install, first run, Skip setup
  and Settings › Reset start on, any of Rotli's family ids (`ocean`,
  `grove`…); an unknown id throws at registration. A saved choice still wins.
  It is read at each use (`defaultAppearance()` in
  `src/state/appearanceDefaults.ts`, and the start of
  `hydratePersistedState`), never kept in a module constant. Standalone
  starts on `warm` as before. Every family keeps its tuned light and dark
  environments; the host picks one, it doesn't add one.
- **`mascot: "none"`**: no quokka anywhere. `Character` draws nothing, so the
  chat buddy, the Settings banners' character, first run's companion and
  intro, the vault screen and the thank-you banner lose it; the quokka mark
  (the search field) gives way to `productMark`, or to nothing.
  Appearance drops the Chat buddy studio and the two quokka navigator trails
  (a stored trail falls back to the quiet lines), and the copy that names the
  quokka (the first-run lede, the Settings hint) leaves it out. Standalone
  keeps the quokka (`"quokka"`, the default). Rotli's pane heads keep their
  objects (a lamp, a shield) without the quokka; `paneHeads: "plain"` takes
  those away too. The thank-you card keeps its scenery until the plain first
  run replaces it with words alone.
- **`productMark`**: the host's own mark, a component like a Settings glyph
  that takes a `size`, drawn in `.host-product-mark` where the quokka mark
  was, tinted by `--text`. `aboutGlyph` is still the About row's.
- **Not covered:** the tray icon (a host replaces it with `without_tray()` and
  its own), the Dock and app icons (the host's bundle), and the web build's
  favicon and brand mark, which no host ships.

## What a host still sees

Everything left saying "Rotli" is listed in
`scripts/product-name-allowlist.json` with its category:

- **Rotli's names** (`rotli-name`). The theme family and the Markdown source
  palette called Rotli, "Rotli's own format" under General › Link format,
  "from the Rotli studio" under Ambient audio, the "What's new in Rotli"
  action (the highlights are Rotli's releases), Breve's "Rotli linen, cocoa,
  and clay" PDF themes, and "a Rotli vault" where a vault's kind is meant.
- **Rotli the project** (`rotli-project`). The thank-you card's GitHub star
  and share line, and the feedback issue's build line ("Rotli 1.9.7").
- **Promises from Rotli's maintainers** (`maintainers`). "Rotli reviews these
  boundaries…" under AI Models, "Older versions of Rotli" under Security, and
  About's own body until `aboutBody` replaces it.
- **Standalone only** (`standalone-only`): the updater, the Finder Quick
  Action, Breve's scheduler and login item. **Web only** (`web-only`): Rotli
  Web, Rotli Helper and "Rotli for Mac". **Development only** (`dev-only`):
  Rotli (dev) and the agent card.
- **What models read** (`model-read`): prompts, tool descriptions and tool
  results. Rewording them needs the model evals.
- **The headless CLI and MCP server** (`cli-mcp`), which never read host
  words.
- **The vault's format** (`vault-format`): folder names such as
  "Trash (Rotli)", `MAP.md`'s first line, the format version's wording.
- **Matched words** (`keyed`, `parity-pinned`): sentences another side
  recognises by their words. The settings-unreadable refusal and the
  secure-notes warming notice (a Rust↔TS twin), "Rotli is already finishing
  saves…" (compared in code), "outside Rotli storage", and the Cursor pause
  message (pinned in `scripts/fixtures/parity.json`).
- **Not routed yet** (`not-yet`): the connected-provider refusal and the
  Library-script line, both Rust constants.
- **Not read by the guard**: the Welcome catalog (`src/assets/welcome.json`)
  and Rotli's own welcome note, which `welcome_note` replaces for a host's
  empty folder.

Some words are shared with Settings, so they follow `productName` outside it
too: "Why a copy?", the connected-tool setup steps, and the two action titles.
The command palette lists both "Hide …" and "Open or hide …"; the ⌘-hold list
shows "Hide …" only, since it leaves system-wide chords out.

## Not built yet

- **Hosts can't add yet:** sidebar fronts or first-run steps.
- **No seam for a host's own windows or pages.** A host plugin can still
  create webviews of its own, and then "Scoping Rotli's commands" applies.
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

## Limits of the single-instance lock

- **Only builds that carry the lock take part.** A build from before this
  change, running on the same support folder, holds no lock: a new build
  launched beside it takes the lock and runs launch setup anyway, and its
  `rotli open` sees no holder and opens its own bundle.
- **A writer of the support folder can defeat it.** Renaming or replacing
  `instance/` or `instance/lock` while a holder runs lets the next launch
  lock a new file. It is the same attacker as "The host-identity boundary"
  in the threat model, which can already plant a registry.
- **The nudge has no answer.** The CLI can't tell a holder that heard the
  nudge from one whose watcher failed (it prints a line at launch and the
  request waits for the next activation or launch). FSEvents can also
  coalesce or delay events; a missed nudge leaves the request in the mailbox
  until then.
- **One HOME, one folder.** The lock and the CLI find the support folder
  from `HOME`. A CLI run under another `HOME` sees another folder and no
  holder. Whether `open -a` hands the launched app the caller's `HOME` is up
  to Launch Services; the live run that found this issue saw it do so.
- **A probe at the wrong moment slows a launch.** A launch that meets the
  CLI's probe waits it out; one that meets a real holder waits two seconds
  before it exits 75.
- **A home without file locks doesn't start.** Any `flock` error exits 73,
  so a host build on a home whose file system refuses `flock` (an NFS mount
  with `nolocks`, some network homes) never starts. That fails closed on
  purpose: without the lock, two processes could rewrite one support folder.

## Proof

This list says only what was run.

- **The words everywhere, the look, and the name guard** (2026-11-28, tests
  and the browser lane; no native build launched).
  - TypeScript: `src/host/registry.test.ts` (`inlineName`, `hostThemeFamily`,
    `mascotShown`, `productMark`, and the refusal of an unknown family or
    mascot), `src/state/appearanceDefaultsHost.test.ts` (a host's family on
    every fresh start, read at each use, and in parsed settings with no
    family), `src/state/chatNavigatorStyle.test.ts` (no quokka trail without
    the mascot), `src/host/mascot.test.tsx`
    (no quokka drawn, the host's mark in the quokka mark's place). Each failed
    on `origin/dev` before the change.
  - `scripts/check-product-name.test.ts`: what counts as naming the app, in
    TS, JSX and Rust; an unlisted, a stale and an uncategorised entry fail; a
    name read at module load fails; the tree passes. A raw "Files Rotli didn’t
    open" put back into the sidebar failed the guard, and the module-load rule
    lists all 21 reads an earlier cut of this change made.
  - The synthetic host's entry imports Rotli's Settings, chat and first-run
    components and the Main and views stores before it registers, then the
    app's entry, as a host build's entry does. With the earlier cut's
    module-load reads the page threw "A host registers before the app
    starts"; on `origin/dev` and now it doesn't.
  - Rust: `sentences_name_the_app_a_host_names_and_rotli_otherwise`
    (`app_identity_tests.rs`), standalone and under
    `ROTLI_APP_IDENTIFIER=com.example.host`.
  - Browser lane, synthetic host (`e2e/host-identity.spec.ts`): the window
    title, the Ocean family, "Example Host activity" on Home, the host's mark
    in the search field, Settings › Appearance with two navigator trails and
    no studio, About, and first run through Skip to the thank-you card, each
    with no `.quokka`, `.quokka-mark` or `[data-pose]` and no "quokka" in the
    shell's words. The chat composer doesn't render in the twin (no vault), so
    its placeholder is proven by the guard only.
  - Standalone, browser lane: the note, Home's dashboard, chat, all 12
    Settings panes and every first-run screen (the four steps, Skip's folder
    prompt, the thank-you card and the Settings hint), three runs on
    `origin/dev` and three on the change, taken back to back. The DOM matched
    in all 66 after shots (ULIDs and relative times aside). The pixels that
    differed were the Settings banners' scenery (at most 627 against the
    closest base; two base runs differ by up to 3,895) and the note's "19m"
    age line.

- **Pending URLs in `start_hidden`** (2026-11-27, tests and an ordering probe;
  no Rotli build launched).
  - Rust (`host_tests.rs`): held URLs are visible to the predicate's call,
    `file:` URLs left out; asking takes none, the release still hands over
    everything and the hook part of it equals what was seen. Nothing is
    pending after the release or in a process that never received `Opened`;
    the `host.rs` fence keeps the queue's one way in behind the standalone
    gate. The first test fails against a stub that sees nothing and against
    an implementation that consumes the queue; the empty case holds for the
    stub too.
  - Probe (bare tao 0.35.3, `com.example.openorderprobe`, no declared URL
    scheme, `open -a`, macOS 27.0.1): `Opened` before
    `applicationDidFinishLaunching` in 8 cold launches of 8 with a URL; no
    `Opened` on a plain launch; a URL sent to the running app arrived as
    `Opened`; of two sent back to back to a cold app, the first arrived before
    and the second just after (one run).
  - Not run: a host build launched by a click on its own scheme.

- **Opening Settings, a quiet start and held notices** (2026-11-27, tests
  and the browser lane; no native build launched).
  - Rust (`host_tests.rs`, standalone and under
    `ROTLI_APP_IDENTIFIER=com.example.host`): standalone's whole window list
    is unchanged by the launch step, and so is a host's that answers no; a
    yes asks once and changes only `main`'s `visible`; only the page's
    load-time show is skipped, and only after a quiet start; only the main
    page takes what was held, once; a fence keeps every main-bound notice and
    Settings request behind the hold, and the launch step before
    `.build(context)`. A fence ties the quiet start's wires together: launch arms the state
    `show_main_window` reads, setup decides after the identity check and
    before the opened-URL release, `persist.ts` makes its load-time show
    with `atLaunch`, and `tauri.ts` sends it. A predicate always has `main`
    made hidden and is never asked at launch; setup asks it once and shows
    the window on a no. `launched_as_login_item` reads an open-application
    event built in the test, with and without the login flag. Reverting
    each wire fails a test (`red3-wire-reverts.txt` in the PR's evidence). `open_requests::tests`: a file refused under a host
    gets the file sentence; a file in the host's own marked vault mounts.
    `app_identity_tests`: the folder sentence is unchanged and other
    refusals pass through.
  - TypeScript (`src/services/hostRequests.test.ts`): pane judgement
    (built-in, host, hidden, notes-off, web, unknown with and without the
    dev warning); a request that opens nothing opens no Settings and shows
    no window; the store route; listen-then-take order; held items in order;
    the double mount; a mount torn down mid-answer; a host without notes
    gets the pane and no open flag; a held request that opens nothing
    still brings the window forward and a live one doesn't; held notices
    show as one; a failed take warns under the dev server.
  - Each new test failed first against stubs with the old behaviour; the
    red runs are saved with the PR's evidence.
  - Browser lane (`e2e/host-settings-requests.spec.ts`, synthetic host): a
    request lands on Appearance and on a host pane; an unknown id and a
    hidden pane leave notes showing and Settings closed (with the dev
    warning); a hidden pane leaves an open Settings where it is; a held
    notice shows in the sidebar once the page listens; a host without notes
    changes pane with its chrome as it was. The spec calls the
    functions the listeners call: the event transport and Rust's hold are
    proven by unit tests only.
  - Standalone, browser lane: notes, Settings › General and Settings ›
    Appearance captured twice on `c8ae0bef` and twice on this branch. Notes
    matched to the pixel; the Settings panes differed before vs after by no
    more than two runs of the same commit differ (the banner's scenery).
  - AppKit probe (no Rotli): the launch Apple event is current in
    `applicationDidFinishLaunching` only, and `open -n … --args
    --synthetic-login` delivers `oapp` with no login flag.
  - **Live, by the host lead, at `e042daea`** (a host build, before the
    `start_hidden` redesign), all six steps passed:
    1. a quiet start with no window;
    2. `show_main` after it;
    3. a warm `open_settings`;
    4. `open_settings` after a quiet start, both to a pane and with an
       unknown id;
    5. a cold `open_settings`;
    6. the cold refusal notice.

    That run used a forced predicate. It found that a predicate asked in
    `launch()` can't see the login flag, which led to the redesign above.
  - **Live, by the host lead, at `0037af2a`** (the redesign, forced
    predicate, sandbox HOME): a quiet start kept the window hidden for 15 s;
    the predicate was asked 4 to 21 ms before `RunEvent::Ready` with the
    launch event current, and `launched_as_login_item()` was false on a plain
    `open -a`; after a quiet start `open_settings` to a pane showed it and an
    unknown id stayed hidden; a normal launch with the real predicate showed
    the window.
  - **Not proven live:** a real login-item launch (it waits for an installed
    build); standalone's cold refused-folder notice.

- **`asset:` scope (2026-11-27).** In the same synthetic crate, after
  `allow_directory(vault, true)` the scope allowed a note and a file under
  `wiki/_secure/`, and refused `.rotli/main.json` and a dot-file. With
  `requireLiteralLeadingDot: false` it allowed all four. No file was fetched
  from a page.
- **Command scoping (2026-11-27).** A synthetic host crate used the `build.rs`
  and capability from "Scoping Rotli's commands" with the checked-in list (222
  commands), tauri 2.11.5 and tauri-build 2.6.3, and called two stub commands
  under Tauri's mock runtime. `main`, `capture` and a `finder_…` window ran
  them; a host window and a host child webview inside `main`, both on a host
  URI scheme, were refused. With no app manifest all five ran them. A
  `windows` grant let the child webview run them. A list without one command
  refused it in Rotli's windows. One directly named `allow-…` granted only its
  command, and a misspelled or unlisted identifier failed the build.
- **Command scoping, live (2026-11-27, at `d960272f`).** A host build (real
  WKWebView, sandbox HOME) read `app-commands.json` and granted it by
  webview to Rotli's five labels. From the host's own popover and card pages,
  `corpus_read`, `corpus_write_file_bytes` and `app_settings_write` were
  refused by the ACL and changed nothing; `corpus_read` from `main` worked;
  `listen` and `emit` of a Rotli event were refused (no event permission);
  creating a `finder_…` webview was refused; an `asset:` fetch and image
  failed under the host's own CSP. **Not proven:** a positive `asset:`
  control (a file in scope loading in `main` in the same run).
- **One process per support folder, live (2026-11-26, at `0a1a3da0`).** The
  host lead ran a Developer ID signed host build from two bundle copies,
  each binary run directly in a sandbox HOME. All six steps passed:
  1. A first launch came up.
  2. A second launch of the same binary exited 75 after about 2 s, and the
     holder stayed the only process.
  3. A second bundle copy at another path exited 75 the same way.
  4. `open` with a holder exited 0 and launched nothing; the holder's
     FSEvents watcher consumed the request within 4 s.
  5. `open` with no holder launched the bundle containing the CLI's binary,
     with the caller's HOME.
  6. After `kill -9`, an immediate relaunch took the lock and started.

  `open` from a binary outside an `.app` exited 1 and queued nothing.
  **Not run live:** the exit-73 paths (a linked support folder, a missing
  `HOME`, a support-folder mismatch), a home without file locks, and a
  request sent during first run.
- **One process per support folder, tests (2026-11-26).**
  `single_instance_tests.rs`:
  - a second claim on one support folder is refused, and the next succeeds
    once the first descriptor closes; each folder has its own lock;
  - a launch waits out a brief holder; the CLI's probe sees a holder and
    writes nothing;
  - a linked support folder is refused with nothing written to its target;
    a link at the lock or its folder is set aside, not followed;
  - the folder is 0700 and the file 0600, an older looser file included; a
    spawned child doesn't keep the lock;
  - a nudge reaches the holder's watcher (polling backend under test);
  - the standalone ID takes no lock and creates nothing, and its real
    `open_plan()` is `open -a rotli`; a context naming another ID takes no
    lock;
  - `rotli open`'s plan for each identity, holder and binary path, and a
    source fence that the plan comes before the request is queued.

  `launch_checks_identity_then_settles_scratch_before_binding_anything`
  (`app_identity_tests.rs`) also fences the lock before the Tauri builder,
  the headless CLI before `launch()`, and the support-folder check before
  the scratch vault. The red run used a stub module with the old behaviour
  (no lock, `open -b <ID>`), so every test compiled; 11 of the first 14
  failed. Each fence and each later guard was mutation-checked and failed:
  the lock after the builder, the folder check after the scratch vault, the
  request written before the plan, an older lock file left loose, and a
  lock taken whatever the context's ID. Run in the standalone build and
  under `ROTLI_APP_IDENTIFIER=com.example.host`.

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
  The markup and screenshot comparisons were repeated after the review fixes,
  with the same results. `e2e/host-panes.spec.ts` now keeps the focus handoff,
  a dropped pane request, the unsubscribe on close and the dev-server throw
  under the same kind of host. No native build was launched.
- **The menu-bar item and opened URLs** (2026-11-27, tests only). The labels
  are pure functions, standalone's strings pinned exactly; the shell options'
  builder; how an `Opened` event splits between the host and Rotli; source
  fences for no tray API outside `build_tray`; the queue that holds `Opened`
  URLs until setup and the fences that it comes first and drains after the
  identity check and the vaults; `host::dispatch` (the hook once, with only
  non-file URLs, before any file opens); `mount_opened_file` mounting a file
  outside any vault and refusing one inside a vault the host doesn't own;
  and `check:vault-binds` on the refusals in `open_from_finder` and
  `mount_opened_file`. Each new test failed with its change reverted. No
  native build was launched, so a host's own tray, a URL in its scheme
  reaching the hook, a Finder-opened file in a host build and a cold launch
  by a file are not proven live.
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
  `breve_dev_roots.rs`, `app_host.rs`, `host.rs` and `host_tests.rs`.
- **TypeScript:** `src/lib/appIdentity.test.ts`, `src/host/registry.test.ts`,
  `src/components/settings/settingsNav.test.ts`,
  `src/components/settings/connectionsSettings.test.tsx`,
  `src/components/settings/settingsSurfaceHost.test.tsx` and, in the browser,
  `e2e/host-panes.spec.ts`.
