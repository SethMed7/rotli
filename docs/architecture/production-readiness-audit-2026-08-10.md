# Production-readiness audit — 2026-08-10

Scope: repository-wide architecture, data integrity, security/privacy,
filesystem, concurrency, lifecycle, conventional-file, CLI/MCP, Librarian,
Breve, updater, performance, and test-boundary audit of Rotli 0.80.0. Code is
the description of current behavior; contracts are the comparison target.

## Executive assessment

| Dimension | Rating | Assessment |
|---|---|---|
| Data integrity | **FAIR** | Exact-byte optimistic revisions now protect editors, boards, office files, generic managed files, headless writes, chats, Main, views, chat folders, and raw metadata; atomic replacement is consistent. Crash-only draft loss, non-transactional Librarian/projection operations, and a residual external-writer TOCTOU remain. |
| Security | **POOR** | Path/root/AI/headless/Breve gaps found in this audit were closed or materially narrowed. The stated hostile-webview model is nevertheless incompatible with displaying secure plaintext in the same principal that may invoke generic egress; transformed exfiltration remains possible. |
| Architectural integrity | **FAIR** | The Rust corpus boundary is substantive, but composition and application workflow leak through module singletons, presentation imports adapters/state directly, and remote AI orchestration is still in the untrusted webview. |
| Concurrency safety | **FAIR** | Exact revisions reject stale saves and GUI/CLI/MCP/Librarian processes now cooperate through shared filesystem locks. External editors do not share those locks, and several multi-file workflows are recoverable only by best-effort rollback rather than transactions. |
| Maintainability | **FAIR** | Contracts and mechanical guards are unusually strong, but 159 IPC commands, duplicate TS/Rust policy, very large corpus/host modules, and implicit singleton composition raise change risk. |
| Test confidence | **FAIR** | Focused TS and Rust tests exercise real temporary files and important refusal paths. Playwright and browser integration still use the in-memory twin; packaged lifecycle, menus, Keychain, updater, scheduler, and multi-webview behavior lack automated native proof. |
| Production readiness | **POOR** | Suitable for continued beta use with backups and explicit limitations. It should not yet make an absolute secure-note promise or be entrusted as the sole working copy of irreplaceable knowledge at large scale. |

## Architecture actually discovered

### Composition roots and trust boundaries

| Runtime | Concrete start | Actual ownership and lifetime |
|---|---|---|
| Packaged executable / CLI / MCP | `src-tauri/src/main.rs:4` | Parses argv first. `run_headless_if_requested` dispatches CLI/MCP without starting Tauri; otherwise `rotli_lib::run` owns the desktop process. CLI and MCP instantiate the same `Workspace`/`CorpusStore` application boundary, but are separate processes and do not share GUI mutexes or caches. |
| Tauri host | `src-tauri/src/lib.rs`, setup in `run` | Registers plugins, 159 commands, window/menu/tray/global-shortcut state, root registry, one `CorpusStore` and watcher per usable root, secure-prose ledger warming, organizer, compute/provider state, model-usage aggregation, and the Breve supervisor. Rust is the only filesystem/process/Keychain authority, but every webview has the same default command capability. |
| Main React webview | `src/main.tsx:27`, `src/app.tsx:107` | Hydrates persisted state before React StrictMode, creates the shared Query client and module stores, and selects the main surface from `?window=`. The main surface starts listener effects, corpus invalidation, organizer status, editor/session objects, and user workflows. |
| Quick Note webview | `src/app.tsx:533` | Same JS bundle and IPC capability set, selected by `?window=quick`; owns its own React/module editor buffers and acknowledges the same quit-flush attempt. Hiding is not process termination. |
| Quick Capture webview | `src/app.tsx:532` | Same bundle/capabilities, selected by `?window=capture`; capture routing is TS application logic, persistence is Rust IPC, and quit flush is acknowledged independently. |
| Browser twin | `src/services/notes.ts:306-519` | Module-time composition chooses `InMemoryNotesService`; there is no filesystem, watcher, native lifecycle, Keychain, process, updater, or IPC boundary. It is a deterministic UI twin, not a security/persistence implementation. |
| Editor/save pipeline | `src/editor/model.ts:117-281` | One module-level buffer and revision per note per webview. A 400 ms timer saves; note switches, pane/tab close, blur, hidden, pagehide, and quit flush accelerate it. Conflict keeps the dirty buffer and does not blind-retry. Separate webviews are independent editors and meet only at the Rust revision gate. |
| Filesystem watcher | `src-tauri/src/corpus.rs:5963-5990` | One notify watcher thread per registered root (poll watcher in tests). Events are suppressed for known internal writes, debounced/coalesced, update the store/index, feed the organizer, and emit `rotli:corpus-changed`; TS invalidates infinite-stale Query projections and re-reads disk truth. Event order is not treated as truth. |
| Librarian | `src-tauri/src/organizer.rs:1210`, worker at `:2059` | Rust thread with queue/status/settings state. It snapshots candidates without holding the corpus lock, calls a model, then re-enters the routed write window and rechecks body/fields/secure/locked gates. It writes declared AI metadata, moves files, generated indexes, journal, and rebuildable organizer state; it does not intentionally rewrite prose. |
| Chat / agent loop | `src/components/chat/chatSurface.tsx`, `src/ai/loop.ts`, `src/ai/host.ts` | Provider/tool loop and taint state are primarily TypeScript. Rust independently gates AI reads/writes and all known egress seams. Remote CLI children and image generation are supervised in `provider.rs`; local HTTP model calls live in `chat.rs`. This split is the unresolved hostile-webview problem. |
| Breve | `src-tauri/src/routines.rs`, managed runtime in `breve-runtime/` | Rust stages and frozen-installs an immutable code/dependency bundle at `.rotli/breve-runtime`, atomically activates it, and leaves mutable/private state at `.rotli/breve`. Stable aliases preserve existing paths. The supervisor owns one Bun scheduler process group; parent-PID monitoring and per-routine locks handle abrupt death and overlap. Interrupted activation restores the previous complete bundle. |
| Updater | Tauri updater plugin at `src-tauri/src/lib.rs:1532`, Settings seam in `src/lib/tauri.ts` | The feed is now queried only by an explicit Settings action. Install is plugin-owned; relaunch invokes the narrow Rust `restart_after_flush` command rather than the broad process restart capability. |
| Shutdown | `src-tauri/src/lib.rs:320-412`, RunEvent at `:2070`; TS `src/lib/quitFlush.ts` | Menu/tray quit and in-app relaunch emit one attempt id to main/quick/capture, wait up to 15 seconds, and exit/restart only after all acknowledge successful flush. Failure cancels shutdown, re-shows main, and emits a visible error. Forced OS/process termination cannot run this protocol. |

### Actual dependency direction

The pure/domain core and Rust store mostly follow the intended direction, but
the live TS graph is closer to:

`domain-ish modules → service modules ↔ module singletons/Zustand/Query → React`

with `src/lib/tauri.ts` imported from both service and presentation modules.
Notable concrete drift:

- `src/services/brainFiling.ts` coordinates IPC, Zustand pane retargeting,
  Query invalidation, and journaling in one application function. This is
  architectural debt and a correctness risk because the move and journal are
  not one trusted operation.
- `src/services/notes.ts` performs composition at module import time. This is an
  intentional simple browser/native seam, but it is implicit global composition
  and makes multi-runtime tests easier to misread.
- React surfaces contain application lifecycle and orchestration effects. Most
  are reasonable presentation adapters; update polling was not and was removed.
- Secure/locked/taint rules are intentionally duplicated in TS and Rust for
  fast UX plus trusted enforcement. That duplication is reasonable only while
  parity guards and Rust refusal tests remain authoritative.
- Provider/tool orchestration in TypeScript is a security risk under the stated
  untrusted-webview model, not merely layering debt.

## Critical and significant findings

| Severity | Finding, failure path, root cause | Disposition and regression proof |
|---|---|---|
| **P0 / security** | **Hostile webview can transform secure plaintext before egress.** A generic user read legitimately returns a secure note to render; the same principal can invoke chat/CLI/web/image/open-url egress. Paraphrase, translation, encoding, reordering, or ≤4-word chunks defeat the Rust phrase ledger. Invariant: remote models never receive protected information. Root cause: display and egress capabilities share a principal while remote context is caller-authored. Affected: `src-tauri/src/corpus.rs`, `chat.rs`, `provider.rs`, `web.rs`, `web_search.rs`, `src/ai/*`. | **Not fixed.** Content gates and one-way chat taint stop honest/buggy verbatim flows but cannot prove information-flow security. Requires isolated secure rendering or trusted-side remote context/capabilities. Documented as open P0 in `egress-threat-model.md`. |
| **P0 / data** | **Stale editors and office sessions overwrote newer bytes.** Two panes/windows or MCP/external edits could read A, write B, then have the stale A session save C over B. Root cause: mutation APIs had no expected revision. | **Fixed.** Exact revisions now cross note/board/file/office/headless APIs; Rust compares before replacement; conflict retains dirty state. Rust stale-note/same-size-file tests plus focused editor/board/document/sheet tests. |
| **P0 / data** | **Updater and several root/demo relaunches bypassed save completion.** Direct process restart could terminate with a 400 ms editor debounce or dirty office canvas pending; some flows changed configuration before learning save failed. | **Fixed.** Removed process restart dependency/capability. All relaunch/quit paths use the all-webview handshake; config mutations occur only after a successful synchronous flush. Quit-flush tests cover all-settled failure propagation. |
| **P0 / security** | **Arbitrary absolute path/root authority from webview.** Caller-provided drag/import/folder paths and permissive root registration could expose or mutate home/config/credential trees and poison the local-model trust registry. | **Fixed.** Exact canonical short-lived native grants, no-follow containment, write-capability checks, and privileged-root overlap refusal. Rust regressions cover grant use and forbidden roots. |
| **P0 / security** | **Breve remote agents could read the live whole vault, including secure notes.** The old broad sandbox and an unwrapped Codex fallback bypassed corpus read gates entirely. | **Mitigated/fixed for stable files.** Per-spawn profile denies secure/tainted/derived/Git reads and locked writes; `--require` fails closed; unsafe Codex knowledge fallback removed. New Breve sandbox-policy test. A scan-to-open TOCTOU remains for externally reclassified files outside `_secure`. |
| **P1 / data** | **External rename/delete evicted a dirty Markdown buffer.** Save returned `unknown note`; the catch path removed the module document, making unsaved prose unreachable. | **Fixed.** Unknown-note is now a durable conflict: retain buffer, surface error, no blind retry. `src/editor/model.test.ts` reproduces external rename with a dirty draft. |
| **P1 / security/data** | **Saved-chat collision, stale writes, and taint downgrade.** Create could replace the same slug, concurrent windows could overwrite transcripts, and a stale writer could erase `secureContext`. | **Fixed.** Collision refusal, revision-required update under the chat file lock, and one-way taint in the same critical section. Rust and TS chat regressions. |
| **P1 / structure** | **Concurrent projection and metadata writes could silently replace newer organization.** Main, named views, chat folders, and raw metadata used whole-file last-writer-wins saves; two webviews or GUI versus CLI/MCP/Librarian could erase references or fields. Named-view rollback could also restore an old whole note after a newer body edit. | **Fixed.** Versioned reads/writes, serialized frontend queues, and shared cross-process file locks now cover these paths. Semantic headless mutations run inside the same lock. Named-view metadata merges from freshly locked note bytes and rollback restores only the exact bytes it applied. Stale projection/raw-metadata and rollback regressions added. |
| **P1 / lifecycle** | **Breve upgrades modified executable files in place before dependency validation.** Disk exhaustion, crash, or failed `bun install` could leave a mixed old/new runtime and no trustworthy dependency graph. | **Fixed.** Immutable code/dependencies are built in a sibling staging directory, frozen-installed, then directory-swapped. Mutable state is never snapshotted or replaced; code aliases are recoverable. Failed-install, successful-upgrade, and interrupted-swap Rust regressions added. |
| **P1 / isolation** | **Duplicate/malformed root ids could replace a registry route.** HashMap insertion made a later root silently redirect operations intended for an earlier memex. | **Fixed.** Empty/colon ids and duplicates fail; setup disables the bad registration. `duplicate_or_malformed_root_ids_never_replace_an_existing_route`. |
| **P1 / security** | **Connected read-only/added-folder configurations were not consistently authoritative at older memex mutation commands.** GUI state could say read-only while Rust still mutated. | **Fixed.** All memex mutators resolve through configured write authority; added folders cannot be treated as writable brains. Rust configuration matrix regression. |
| **P1 / privacy** | **Headless Main/views/status leaked secure structure and absolute roots.** Agents could difference manifests against filtered lists and queue an unvalidated open. | **Fixed.** Recursive remote filtering, filtered metrics/mutation returns, opaque status roots, visible-item/mutable-workspace open gate. Rust workspace regression. |
| **P1 / privacy** | **Rotli contacted the updater feed automatically despite “nothing phones home.”** Mount, visibility, and three-hour timer made an undisclosed network request. | **Fixed.** Settings-only explicit check. `check:security` mechanically rejects any other TS caller. |
| **P1 / format integrity** | **Conventional adapters could silently drop unsupported state.** Excalidraw unknown fields, DOCX unsupported inline/package data, and XLSX advanced OOXML could be lost on a minimal save. | **Fixed/narrowed.** Excalidraw merges unknown scene/element fields; DOCX preserves source/unknown XML and refuses unsafe advanced edits; XLSX refuses known destructive feature packages. Round-trip/refusal tests added. Unknown future XLSX feature families remain a gap. |
| **P1 / Librarian** | **“Everything undoable” is stronger than the implementation.** Classification may write `area`, `filed_by`, `filed_at`, move, append journal, and persist state as separate atomic operations. Disk/journal failure can leave a partially applied but reachable note; approval/undo freshness checks and writes also have a same-user TOCTOU. | **Not fixed.** Secure/locked and body/field rechecks are strong and prose is not intentionally rewritten, but full reversibility requires a transaction/journal protocol with recovery and revisioned metadata operations. |
| **P1 / lifecycle** | **Forced termination still loses in-memory debounce/conflict drafts.** The graceful handshake cannot run after crash, SIGKILL, power loss, or OS forced termination. | **Not fixed.** Maximum ordinary debounce exposure is about 400 ms, but a conflict buffer can live longer. A durable draft/recovery journal is required. |
| **P2 / lifecycle** | **Context-menu focus restoration dereferenced React's cleared event.** Closing several menus ran `event.currentTarget.focus()` asynchronously; React had already cleared the property, producing uncaught page errors while E2E still reported success. | **Fixed.** All three callers capture the concrete trigger element before registering the callback. The affected sidebar/view E2E specs now close without the error. The harness should still fail on unexpected page errors. |

## Data, identity, and filesystem conclusions

- Durable note identity is frontmatter `id`; paths are selectors. Internal
  user/Librarian moves preserve id and now rewrite the source then rename, so a
  failed rename leaves one reachable old-path file rather than duplicate ids.
- External files without Rotli ids necessarily use path identity. External
  rename cannot be correlated reliably; dirty buffers are retained for manual
  recovery rather than guessed onto a new file.
- Main and named views hold references, never corpus copies. Internal moves keep
  references because note ids are stable; boards/binaries remain path-identified
  and require explicit retargeting.
- `split_root_id` uses the first ASCII colon. Relative-path validation forbids
  colons and traversal; registry ids now forbid empty/colon values and duplicates.
  Bare ids route only to the configured default. Unknown/stale roots fail rather
  than falling back.
- Existing components are checked with no-follow metadata and canonical root
  containment. Destination parents are checked before temp creation/move. A
  same-user process can still race path/file replacement after validation; the
  app does not claim protection against a malicious local account peer.
- Same-directory temp + sync + replace preserves the old target on common
  disk-full/serialization/permission failures. Parent-directory sync is
  best-effort. Rotli GUI, CLI, MCP, and Librarian processes share per-target
  filesystem locks; an uncooperative external editor does not. A
  compare-to-rename TOCTOU therefore remains if that editor writes in the exact
  interval between Rotli's revision verification and replacement.
- Watcher events are hints. Duplicate/out-of-order events invalidate caches and
  trigger a fresh disk read; they do not directly overwrite editor state. Clean
  buffers reload; dirty buffers retain local bytes and rely on revision conflict.

## Tauri IPC inventory

All 159 commands below are reachable from any app webview under the default
capability and therefore take attacker-controlled arguments. “Caller” names the
honest adapter, not an authorization assumption. `Result<_, String>` is the
dominant error model; async filesystem/network work generally uses
`spawn_blocking`, but several short filesystem commands remain synchronous.

| Command(s), every registered command enumerated | Honest caller / parameters | Effects | Rust enforcement and error behavior |
|---|---|---|---|
| `toggle_main_window`, `hide_main_window`, `show_main_window`, `hide_capture_window`, `finish_capture_window`, `toggle_quick_window`, `hide_quick_window`, `summon`, `set_hide_on_blur`, `set_dock_visible`, `set_app_icon`, `set_summon_shortcut`, `demo_mode`, `set_demo_mode`, `quit_flush_done`, `restart_after_flush` | App/window chrome; booleans, shortcut/action ids, quit attempt result | Window/app state; demo/root restart; process exit/restart | Shortcut parser/allowlisted action ids; demo mutation and restart require completed all-webview flush. Attempt ids and per-window acks bound shutdown; failures cancel. |
| `corpus_reveal`, `corpus_status`, `corpus_list_config`, `corpus_add_folder`, `corpus_forget_folder`, `corpus_inspect_folder`, `corpus_import_vault_copy`, `corpus_choose_folder`, `corpus_init_memex`, `corpus_create_practice_vault`, `corpus_connect_brain`, `corpus_forget_brain`, `corpus_set_active_brain`, `corpus_set_brain_perms` | Onboarding/settings; optional picker path, root/brain ids, perms | Root config, directory inspection/copy/init, Finder reveal, restart | Native exact grants for caller paths; canonical/no-follow checks; privileged-root rejection; config lane mutex; writable/memex contract validation; flush before mutation requiring restart. |
| `app_settings_read`, `app_settings_write` | Settings composition; JSON string | App config file | Fixed app-data path, JSON shape validation, atomic write; no arbitrary path. |
| `corpus_list`, `corpus_search`, `corpus_read`, `corpus_tasks`, `corpus_toggle_task`, `corpus_resolve_ref`, `corpus_overview`, `corpus_note_path` | Notes/query/tasks UI; ids/query/line identity | Reads; task line mutation | Root-qualified routing, containment, corpus surface rules; task exact-line freshness and ordinary write gate; revision returned by read. User lane may return secure content by design. |
| `corpus_open_file`, `corpus_reveal_file`, `corpus_open_with_apps`, `corpus_open_file_with`, `corpus_abs` | File UI; id and allowlisted app | Native open/reveal; absolute path disclosure | Item must resolve within root; open-with app is fixed allowlist. `corpus_abs` is intentionally powerful user-lane metadata and participates in the unresolved hostile-webview risk. |
| `corpus_file_text`, `corpus_file_bytes`, `corpus_file_stat`, `corpus_move_file_to_sink`, `corpus_restore_file`, `corpus_write_file_bytes`, `corpus_new_file_bytes`, `corpus_create_managed_file`, `corpus_create_image_asset`, `corpus_convert_document`, `corpus_export_pdf`, `corpus_managed_file_creation_available`, `corpus_import_file` | Document/sheet/asset adapters; id, bytes/text, expected revision, destination kind, granted source | Read/write/import/convert/export/lifecycle conventional files | Extension/lane/size/containment gates; exact drag grant for import; image signature validation; local fixed converter; replacement requires exact revision; conversion/export are rooted, source-preserving, and atomic. |
| `corpus_frontmatter`, `corpus_raw_frontmatter`, `corpus_write_frontmatter_raw`, `corpus_set_locked`, `corpus_set_pinned`, `corpus_set_field` | Note metadata UI; id/key/value/raw fields, expected raw revision | Markdown metadata mutation | Reserved-key/type/ownership gates and ordinary writable lane; secure relocation/ignore policy where applicable. Raw metadata requires an exact whole-file revision; semantic fields re-read and merge under the shared note lock. Uncooperative external editors retain a narrow TOCTOU. |
| `corpus_set_ai_field`, `corpus_file_note`, `corpus_filer_move`, `corpus_write_index`, `corpus_journal_append`, `corpus_journal_read`, `corpus_journal_prune`, `organizer_learn_field` | Librarian/application services; id/field/area/body/journal | AI metadata, move, generated index, sidecar journal/state | Vault Library/lane/permission gate; fresh secure/locked refusal; AI-key allowlist; relative area validation; shared locks for metadata/index/journal/moves. Operations are individually atomic, not transactionally grouped. |
| `corpus_set_secure`, `corpus_secure_repair_scan`, `corpus_secure_repair_apply`, `corpus_set_local_ai_access` | Security UI; id/boolean | Metadata, protected move, `.gitignore`, content-free journal | Fresh explicit/detector validation; stable id; protected destination ignore-before-move; note/vault local-AI policy. Repair journal can fail after a successful protected move. |
| `corpus_read_ai`, `corpus_readable_ids`, `corpus_search_ai`, `corpus_notes_ai`, `corpus_write_ai` | TS agent host; id(s), locality/model, expected revision/body | AI-filtered reads/search/map and AI writes | Locality re-derived in Rust; hidden/secure/local-policy/locked/taint gates; remote filtering happens before return; writes require revision and prevent protected-to-unprotected laundering. |
| `corpus_write`, `corpus_create`, `corpus_delete`, `corpus_discard_blank`, `corpus_move`, `corpus_rename_board`, `corpus_purge`, `corpus_create_folder` | Notes/board lifecycle UI; ids, title/body/folder, expected revision | Create/update/move/trash/purge/folder | Root/lane/permission/containment; note writes require revision; stable id move; purge is explicit user destructive lane. Some create + Main-reference composition spans separate writes. |
| `corpus_read_board`, `corpus_write_board`, `corpus_create_board` | Canvas/CLI adapter; id, raw JSON, expected revision | Excalidraw read/write/create | Rust bounds bytes/elements/files/strings/depth/nodes/coordinates; writes require revision and reject malformed source. |
| `corpus_settings_read`, `corpus_settings_write`, `corpus_main_read`, `corpus_main_write`, `corpus_views_read`, `corpus_views_write` | Persisted UI/Main/view composition; JSON projections and expected revisions | `.rotli` explicit settings and reference projections | Fixed sidecar names, schema/version validation, atomic writes. Main/views require exact revisions and serialize semantic GUI/CLI/MCP updates under cross-process locks; settings/viewstate remain last-writer-wins. |
| `workspace_take_open_request` | App startup/listener; no caller path | Consume/delete rebuildable mailbox | Default registered root only; workspace producer validates visible item. Returns id/kind only. |
| `breve_snapshot`, `breve_import_legacy`, `breve_write_config`, `breve_brief_skill`, `breve_write_brief_skill`, `breve_write_watchlist`, `breve_delivery_settings`, `breve_write_delivery_settings`, `breve_store_resend_key`, `breve_remove_resend_key`, `breve_test_email`, `breve_test_signal`, `breve_takeover`, `breve_retire_legacy` | Breve settings/lifecycle; bounded config/watchlist/credential/test intent | Managed runtime/config, Keychain, child/delivery, legacy takeover/retire | Fixed active vault/runtime paths, config validation, debug refusals for live tests, Keychain boundary, ordered takeover/retirement checks. Immutable code/dependencies stage and frozen-install before atomic activation; interrupted swaps recover the previous bundle without replacing mutable state. |
| `chat_models`, `chat_messages`, `chat_messages_stream` | Chat composition; model/messages/options | Loopback or remote model network calls, streaming events | Endpoint/model locality re-derived; provider registry and endpoint clamps; remote content gate/ledger; bounded request. Caller-authored transformed content is the open P0. |
| `cli_detect`, `cli_complete`, `cli_cancel`, `generate_image` | Provider adapter; provider/model/request id/transcript/prompt | Spawn/kill Claude/Codex/Antigravity; image file | Provider/model/argv allowlists, no shell interpolation, bounded children tracked by request id, remote content gate, pinned image destination and postcondition. Child stderr readers are joined; cancellation kills tracked child. |
| `web_search`, `web_fetch`, `open_url` | Agent/web evidence and link UI; provider/query/url/cap | External network/browser | Literal search providers, Keychain key, query/size caps; HTTP scheme/SSRF/redirect checks; open-url scheme allowlist; all call remote content gate. DNS lookup happens before private-address verdict, leaving DNS-name exfil residual. |
| `local_model_install`, `local_model_install_progress`, `local_model_install_cancel`, `local_model_set_default`, `local_model_default`, `local_model_uninstall`, `system_profile` | Model Settings; validated model id | Spawn installer, mutate model registry/files, system inspection | Model-name allowlist, fixed cache/registry roots, tracked cancel state, blocking work off async executor. Cross-process registry RMW is not transactional. |
| `local_queue_status`, `local_queue_prioritize`, `local_queue_cancel` | Chat compute UX; ticket id | In-process queue state/cancel | Narrow ids and mutex-owned state; no filesystem or process authority. |
| `model_usage` | Dashboard; bounded range and explicit refresh flag | Reads provider-owned local session histories and returns aggregate counters/estimated API-equivalent cost | Fixed provider-history roots, bounded supported ranges, aggregate-only return values, no prompt/response/path/session identifiers, and cached incremental scans. |
| `secret_store`, `secret_exists`, `secret_delete` | Connections/Breve settings; allowlisted account and value | macOS Keychain mutation/existence | Exact secret-name allowlist; plaintext values never returned. Errors are sanitized strings. |
| `organizer_status`, `organizer_run_once`, `organizer_stop`, `organizer_set_brain`, `organizer_set_trust`, `organizer_secure_hints`, `organizer_dismiss_secure` | Librarian UI; trust/enable/relative note | Worker state, settings sidecar, secure-review dismissal | Strict trust enum; candidate relative-path grammar; fresh secure state; no secure content in hints/journal. Stop is cooperative between model calls. |
| `memex_detect`, `memex_read_contract`, `memex_read`, `memex_read_chat`, `memex_list_chats`, `memex_chat_folders`, `memex_write_chat_folders`, `memex_write_chat`, `memex_rename_chat`, `memex_delete_chat`, `memex_archive_chat`, `memex_reveal_chat`, `memex_write_note`, `memex_validate`, `memex_pick_folder` | Vault/chat UI through legacy-named contract commands; granted folder, slug, expected revision, body/config | Vault/chat reads and mutations, picker/reveal, validation | Configured writable-root authority, exact picker grants, slug/relative-path checks, versioned chat and chat-folder updates, one-way taint, shared file locks, and atomic writes. Validation no longer executes vault-provided scripts. |

No registered command bypasses root containment for corpus content. Several
commands intentionally bypass `CorpusStore` because they own app config,
Keychain, network, windows, or managed runtime; those use fixed paths or narrow
allowlists. The API is still broader than capability-style ideal: every webview
receives all 159 commands, including Keychain, provider, root mutation, and
purge. Per-window capability files and narrower composite Rust operations would
materially reduce attack surface.

## Concurrency and lifecycle inventory

| Activity | Owner/start | Cancellation/shutdown | Failure behavior / remaining risk |
|---|---|---|---|
| React effects/listeners | Component mount in each webview | Effect cleanup/unlisten; StrictMode exercises mount cleanup | Most listeners use stopped/alive guards. Module singletons survive component remount and can hide duplicate ownership. |
| Markdown autosave | Editor module, 400 ms per note | Flush on switch/close/blur/hide/pagehide/quit | Error stays visible and dirty. Forced death loses RAM-only work. |
| Board/document/sheet/settings saves | Session/debounced tasks | Explicit quit flusher registration | Flush rejects on persistence failure. Some UI close paths depend on component cleanup and need native packaged exercise. |
| Query invalidation | Main App watcher listeners | Unlisten on unmount | Disk is canonical. Infinite stale time makes a missed event persistent until another invalidation/manual action. |
| Filesystem watchers | Rust setup, one thread/root | Watcher object held for app lifetime; dropped on process exit | Root setup failure disables that root cleanly. No dynamic watcher add without restart. |
| Organizer | One Rust worker thread | Stop is cooperative; process exit ends thread | Model calls can take up to 45 s; trust/brain/stop rechecked between calls and before writes. No explicit thread join on shutdown. |
| Provider CLI children | Rust provider state | Explicit cancel kills; normal path waits/joins stderr | App exit does not have one centralized sweep proving every provider child was killed; orphan behavior needs packaged failure testing. |
| Local model installer | Async blocking task + child/stderr thread | Cancel flag kills tracked child | Progress state is in-process; crash leaves downloaded cache artifacts, not corpus data. |
| Breve scheduler/jobs | Rust supervisor + Bun parent-PID monitor + process locks | Supervisor kills process group; scheduler self-terminates when Rotli parent disappears | Code/dependencies activate through an atomic sibling swap with crash recovery. Mutable state remains separate. Native process-group behavior still lacks packaged automation. |
| Quit/restart | Rust coordinator + three JS ack sets | 15 s bound; only success exits | Native menu shape is required at setup and fails closed if it cannot replace direct quit. Packaged proof remains manual. |

## Browser twin versus production proof

| Behavior | Browser unit/integration | Playwright browser E2E | Rust tests with temp files | Actual packaged Tauri |
|---|---|---|---|---|
| UI workflows, keyboard, responsive states | Strong | Strong | N/A | Manual smoke only |
| Notes CRUD semantics | In-memory twin | In-memory twin | Real `CorpusStore` | Real filesystem |
| Atomic/revision writes | Mocked interface behavior | No | Strong focused tests | Not automated end-to-end |
| External watcher events/query refresh | Listener mocks at best | No native watcher | Watcher/store unit coverage | Not automated |
| Multi-window save conflicts | Separate model tests | No real webviews | Revision gate tests | Not automated |
| Quit/menu/restart flush | TS coordinator tests | Browser lifecycle only | Rust coordinator logic compiles/tests | Requires packaged click/menu/crash matrix |
| Root containment/IPC argument validation | No | No | Strong temp-filesystem command/store tests | Capability packaging not automated |
| Secure/locked/taint | TS fast-fail/evals | Twin only | Strong Rust gates/evals | Hostile-webview noninterference unproven |
| Keychain/updater/native dialogs | No | No | Shape/unit checks only | Manual/live environment |
| CLI/MCP | No | No | Real headless workspace and protocol tests | Packaged binary smoke needed |
| Librarian/Breve scheduler/process groups | UI mocks | No | Deterministic organizer/runtime policy tests | No real model/delivery; scheduler lifecycle manual |

The largest false-confidence risk is treating Playwright success as persistence,
security, or native lifecycle proof. It exercises the twin by design.

## Architectural/documentation drift

| Documented | Actual | Impact | Recommendation |
|---|---|---|---|
| Secure remote non-disclosure holds with an untrusted webview | Same webview receives secure plaintext and generic egress; ledger catches only verbatim overlap | **P0 security** | Isolate secure rendering/capabilities or construct all remote context in trusted Rust from opaque ids. Do not advertise absolute noninterference until proven. |
| “Everything [Librarian does] is journaled and undoable” | Multi-step metadata/move/journal/state operations can partially succeed; repair deliberately is not journal-undoable | **P1 reliability/honesty** | Introduce a durable intent/commit/recovery journal and atomic composite Rust commands; narrow copy to “recorded where possible” meanwhile. |
| `domain → application → adapters → composition → presentation` | Services and React import Tauri/Zustand/Query directly; composition is often module-global | **P2 evolvability** | Establish explicit per-webview composition roots and application use cases; keep React intent-only. |
| “Nothing phones home” | App formerly checked updater feed on mount/show/timer | **P1 privacy**, now fixed | Keep `check:security` Settings-only tripwire and document updater as explicit egress. |
| Breve providers share equivalent confinement | Old Codex fallback lacked secure-file read denies | **P0 privacy**, now fixed/narrowed | Keep only providers expressible by the generated policy; move toward an immutable filtered projection. |
| Browser twin reflects the app | It reflects application interfaces, not native persistence/security/lifecycle | **P2 test interpretation** | Add a packaged Tauri smoke harness and label E2E results by boundary. |
| User files are durable truth and `.rotli` is rebuildable projections/settings | Correct for vault content. Main/views/chat folders/raw metadata are now revisioned and cross-process serialized; settings/viewstate still use full-file last-writer-wins persistence. | **P1 settings consistency, narrowed** | Extend revision/merge discipline to the remaining user-authored settings that can be changed by multiple webviews. |

## Performance and scale

- Around 1,000 notes, full walks, metadata maps, and per-hit security rereads are
  likely acceptable; large editors/codecs dominate isolated interactions.
- Around 10,000 notes, startup root walks, secure-ledger phrase hashing, Tasks,
  list projections, and recursive headless manifest filtering become visible.
  Tantivy avoids repeated full-text scans, but security gates still reread files.
- Around 100,000 notes, every-root startup warming and Breve's synchronous full
  Markdown policy scan on each model spawn are algorithmic blockers. Whole-file
  journal append and whole Main/views serialization also grow without bound.
- The correct optimization is incremental, trusted metadata/projection caching
  with invalidation from disk—not a corpus database. Secure decisions must still
  fail closed on stale/missing cache state.

## Dependency and dead-code observations

- The broad `@tauri-apps/plugin-process`/Rust process plugin and restart
  capability became unused after the safe relaunch fix and were removed.
- Provider detection/completion implementations are intentionally parallel for
  Claude/Codex/Antigravity; they are not dead, but their duplicated argv and
  sandbox policy needs parity fixtures.
- `provider_chain`/compatibility paths marked dead remain referenced by tests or
  migration contracts; this audit did not delete them without runtime proof.
- Large direct dependency surfaces (Excalidraw, Univer, ExcelJS, JSZip, model
  runtimes) are used. No remaining dependency was removed solely from a static
  “unused” signal.

## Remaining risks, ranked

### P0 — data loss or security

1. Hostile-webview transformed exfiltration defeats content-overlap gates.
2. Breve live-root scan-to-open TOCTOU for an externally reclassified secure
   file outside the protected directory.

### P1 — major reliability/correctness

1. No durable crash/conflict draft journal.
2. Librarian approval/auto-apply/undo is not a recoverable transaction.
3. External writers can hit the narrow compare-to-atomic-replace TOCTOU because
   they do not share Rotli's lock.
4. Packaged menu/quit/process-child behavior lacks automated native proof.
5. Future XLSX/OOXML constructs not in the refusal inventory may still be lost.
6. Settings/viewstate persistence is serialized per webview but still lacks a
   cross-process revision/merge contract.

### P2 — architecture debt

1. All webviews receive one broad 156-command capability.
2. TS composition/application/presentation boundaries are porous and global.
3. Secure/locked/taint policy has necessary but costly duplicate implementations.
4. Startup and Breve scans do not scale to 100,000 notes.

### P3 — quality/cleanup

1. IPC errors are mostly untyped strings, complicating reliable UX branching.
2. Several long modules (`corpus.rs`, `lib.rs`, chat/settings surfaces) increase
   review cost even where their internal policy is sound.

## Test gaps

- Real packaged three-webview concurrent editing, menu Quit, tray Quit, updater
  restart, root switch, and flush failure.
- Power-loss/process-kill recovery during note save, Main/view write, Librarian
  move/journal, and Breve runtime upgrade.
- Property/state-machine sequences across GUI + external edit + Librarian +
  CLI/MCP + move/delete/restore with invariant checks after every transition.
- Real macOS Seatbelt tests proving secure read/locked write denial against a
  spawned child, including policy-generation races.
- Cross-process CLI/MCP versus GUI concurrent Main/view/metadata updates.
- Filesystem case-sensitivity and Unicode normalization fixtures on both
  case-sensitive and case-insensitive volumes.
- Golden DOCX/XLSX corpora with comments, relationships, images, formulas,
  dates, names, pivots/charts/macros and repeated minimal edit cycles.
- Packaged capability inspection proving quick/capture windows receive only
  necessary commands after capability narrowing.
- A global Playwright page-error assertion. The current Vite bridge prints an
  uncaught application error without failing the scenario; known browser-only
  `ResizeObserver` noise will need a narrow explicit exclusion.

## Top ten next engineering investments

| Rank | Investment | Impact / risk reduced | Difficulty | Subsystem |
|---:|---|---|---|---|
| 1 | Isolate secure plaintext from remote-egress authority, or move remote context construction/tools into trusted Rust using opaque handles | Closes P0 privacy contradiction; makes secure promise defensible | **Very high** | Tauri capabilities, AI host, secure editor |
| 2 | Durable encrypted/local draft and conflict-recovery journal with startup reconciliation | Prevents crash/power-loss loss of unsaved or conflicted prose | **High** | Editor, lifecycle, corpus |
| 3 | Transactional Librarian intent/commit/recovery protocol and atomic composite apply/undo commands | Prevents partial filing metadata/journal state; makes undo claim true | **High** | Organizer, CorpusStore, journal |
| 4 | Immutable filtered Breve knowledge projection, atomically swapped per policy generation | Removes live-root TOCTOU and repeated full scans | **High** | Breve, scheduler, security |
| 5 | Native packaged test harness for three webviews, menus, quit/restart, watcher, Keychain stubs, and process supervision | Converts highest-risk manual behavior into release evidence | **High** | QA/CI, Tauri lifecycle |
| 6 | Filesystem state-machine/property suite with external writer and real CLI/MCP processes | Finds sequence-dependent identity/data-loss races and proves OS-lock behavior | **Medium-high** | Corpus, watcher, workspace |
| 7 | Per-window capability manifests and narrower Rust composite commands | Reduces 156-command blast radius and application-layer partial operations | **Medium** | IPC/composition/security |
| 8 | Revision/merge semantics for remaining multi-webview settings and typed conflict errors | Prevents residual control-state lost updates and makes refusal UX reliable | **Medium** | Settings, IPC, lifecycle |
| 9 | Incremental trusted policy metadata and bounded projection/journal storage | Makes 10k–100k vaults usable without weakening disk truth | **Medium-high** | Corpus index, security ledger, Breve, Main/views |
| 10 | Golden conventional-file corpus plus case/Unicode identity fixtures | Prevents unsupported OOXML and filesystem-identity regressions on real-world filesystems | **Medium-high** | DOCX/XLSX, identity, filesystem |

## Validation performed

- `bun run check` — pass after the final changes (architecture, IPC, security,
  docs, structure, TypeScript, dead-code, unit, Breve, and design-system gates).
- `cargo test --manifest-path src-tauri/Cargo.toml` — 391 passed, 1 ignored.
- `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`
  — pass.
- `bun run test:e2e` — 82 passed.
- `NODE_OPTIONS=--max-old-space-size=4096 bun run build` — pass, with two
  existing ineffective-dynamic-import bundle warnings.
- `bun run tauri build --debug --no-bundle` — pass; native application binary
  compiled successfully. Tauri also reported the existing warning that the
  `com.rotli.app` bundle identifier ends in `.app`.
- `git diff --check` — pass.
- `bun run check:dup` — pass; it reports review candidates without changing
  repository files or treating similarity as proof of dead code.

No live vault, installed application, Keychain, scheduler, daemon, updater
feed, provider, or delivery channel was exercised or mutated. Native proof here
means compilation and temporary-filesystem Rust tests, not a launched packaged
application.
