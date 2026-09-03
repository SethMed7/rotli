# Window and host events

The cross-window and Rust→webview event registry. Every event name below is a
string literal in exactly two places by design: a sender and a receiver. The
webview side always lives in `src/lib/tauri.ts` (or `src/lib/quitFlush.ts`
for the quit lane) as an `emit*`/`on*` pair, so components never touch Tauri's
event API directly. `check:window-events` proves every literal in `src/` and
`src-tauri/src/` has a row here and that each row is still wired on both
sides. Add a row when you add an event; remove it when the last use goes.

Direction: **R→W** Rust host to a webview, **W→W** one webview to another
(always through Tauri's event bus; the main window is the settings/manifest
writer, the floating windows announce), **W→R** webview to Rust.

| Event | Direction | Purpose |
|---|---|---|
| `rotli:appearance` | W→W | Main broadcasts its whole app-settings snapshot (theme, accent, quokka, syntax palette, hotkey peek, rebinds, per-note typography) so the Quick Note and capture webviews apply it live. |
| `rotli:brain-journal` | R→W | The organizer appended a journal entry; the Activity surface refreshes. |
| `rotli:capture` | W→W | The capture card hands a typed capture (id, body, open flag) to the main window, which owns the corpus and files it. |
| `rotli:capture-ack` | W→W | Main confirms a capture was durably saved; the card clears its draft (never before). |
| `rotli:capture-show` | R→W | The capture window was summoned; refocus its field. |
| `rotli:close-tab` | R→W | The native Close menu item / ⌘W route asks the main webview to close its focused tab (visitor windows hide instead). |
| `rotli:corpus-changed` | R→W | The watcher or an internal write changed the vault; listings and the note universe refetch. |
| `rotli:flush-before-quit` | R→W | Quit was requested; every webview flushes pending saves before the host exits. |
| `rotli:local-queue` | R→W | The on-device model queue changed (position, running, prioritized); chat rows update. |
| `rotli:native-drag` | R→W | A Finder drag is hovering (physical pointer, file count) or has left; the editor under the pointer draws its drop line. |
| `rotli:native-drop-authorized` | R→W | The host issued one-shot import grants for a Finder drop and reports the paths plus drop position. |
| `rotli:open-request` | R→W | `rotli open <id>` (CLI/deep link) or a Reopen wants the main webview to consume the open mailbox. |
| `rotli:organizer-progress` | R→W | Librarian run progress for the live Activity lane. |
| `rotli:quick-created` | W→W | A note was born in the Quick Note window; main files it into Main so it is a full note, never a capture. |
| `rotli:quick-set` | W→W | The quick-access set (ids, active id, folder, vault) changed in one webview; the other applies it and main persists it. |
| `rotli:quick-show` | R→W | The Quick Note window was summoned; refocus its editor. |
| `rotli:quit-flush-failed` | R→W | A quit-time flush could not save; the app stays open and the main webview shows why. |
| `rotli:rebind` | W→W | A keybinding changed in one webview; the other applies the same override (one keymap, two webviews). |
| `rotli:summon-chat` | R→W | The global chat chord fired; main opens or focuses a chat. |
| `rotli:summon-search` | R→W | The global find chord fired; main opens the ⌘K palette. |
| `rotli:vault-changed` | R→W | The active vault was switched or a root added/removed; webviews replace their vault-scoped caches without remounting. |
| `private-browser-state` | R→W | The private browser child webview reports navigation/title/loading state for its tab chrome. |
| `private-browser-new-window` | R→W | A page inside the private browser asked for a new window; the surface opens it as a tab. |
