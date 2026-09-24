# Window and host events

The cross-window and Rust→webview event registry. Every event name below is a
string literal in exactly two places by design: a sender and a receiver. The
webview side always lives in `src/lib/tauri.ts` (or `src/lib/quitFlush.ts`
for the quit lane, `src/lib/chatWindowBridge.ts` for the Chat window) as an
`emit*`/`on*` pair, so components never touch Tauri's
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
| `rotli:chat-window` | W→W | The two shell windows' hand-off while Chat lives in its own window, one event with a `kind`: main → chat `open` (chats to open, each with its unsent text; no slug = a fresh chat) and `regroup`; chat → main `tabs` (the saved chats open there, which main folds into the layout it saves — main is the one writer), `regrouped` (everything handed back; the window has hidden), `file-into-main` (additions a non-main window computed for Main, which main merges into the real tree); and Quick Note → main `note-chat` (⌘⇧C there: open that note's chat and come forward — the Quick Note cannot host one). |
| `rotli:chat-window-regroup` | R→W | The chat window's close button was pressed. The window only ever hides, so its webview hands its chats back to main first and then hides itself. |
| `rotli:chat-window-show` | R→W | The chat window was shown; its webview refocuses. |
| `rotli:close-tab` | R→W | The native Close menu item / ⌘W route asks the focused SHELL webview (main, or the Chat window) to close its focused tab (visitor windows hide instead). |
| `rotli:corpus-changed` | R→W | The watcher or an internal write changed the vault; listings and the note universe refetch. Sent to every shell window (main and the Chat window): a shell that misses it shows stale content and fails its next save on the revision gate. |
| `rotli:flush-before-quit` | R→W | Quit was requested; every webview flushes pending saves before the host exits. |
| `rotli:local-queue` | R→W | The on-device model queue changed (position, running, prioritized); chat rows update — in both shell windows. |
| `rotli:native-drag` | R→W | A native drag is hovering (physical pointer, item count) or has left; the editor under the pointer draws its drop line. A pathless drag that promises a file or carries image bytes (the macOS screenshot thumbnail, a browser image) counts as one item so the line still draws. |
| `rotli:native-drop-authorized` | R→W | The host issued one-shot import grants for a native drop and reports the paths plus drop position. A file promise resolves after the drop, so this can arrive a moment later, always with the ORIGINAL drop position. |
| `rotli:native-drop-refused` | R→W | A native drop delivered nothing that could be granted (folders, files gone mid-drag, a drag with no path, promise, or image bytes); the webview shows a notice instead of doing nothing. |
| `rotli:open-request` | R→W | `rotli open <id>` (CLI/deep link) or a Reopen wants the main webview to consume the open mailbox. |
| `rotli:organizer-progress` | R→W | Librarian run progress for the live Activity lane. |
| `rotli:quick-created` | W→W | A note was born in the Quick Note window; main files it into Main so it is a full note, never a capture. |
| `rotli:quick-set` | W→W | The quick-access set (ids, active id, folder, vault) changed in one webview; the other applies it and main persists it. |
| `rotli:quick-show` | R→W | The Quick Note window was summoned; refocus its editor. |
| `rotli:quit-flush-failed` | R→W | A quit-time flush could not save; the app stays open and the main webview shows why. |
| `rotli:rebind` | W→W | A keybinding changed in one webview; the other applies the same override (one keymap, two webviews). |
| `rotli:summon-chat` | R→W | The global chat chord fired; the window Chat lives in (main, or the Chat window while it is open) opens or focuses a chat. |
| `rotli:summon-search` | R→W | The global find chord fired; main opens the ⌘K palette. |
| `rotli:vault-changed` | R→W | The active vault was switched or a root added/removed; webviews replace their vault-scoped caches without remounting. |
| `private-browser-state` | R→W | The private browser child webview reports navigation/title/loading state for its tab chrome. |
| `private-browser-new-window` | R→W | A page inside the private browser asked for a new window; the surface opens it as a tab. |
