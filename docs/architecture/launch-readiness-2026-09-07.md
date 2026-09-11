# Launch readiness — 2026-09-07

**Recommendation: continue toward a focused Mac beta; do not promote this tree to
an unrestricted 1.0 launch yet.** Core workspace regression evidence is strong.
Native acceptance, document fidelity, dependency advisories, the recorded
security boundary, and live site reliability still need closure. A green test suite is not proof of every
supported format, live provider, or operating-system integration.

This is a dated evaluation and launch plan, not a replacement for the owning
contracts in [the documentation map](../README.md). The initial audit began from
a clean worktree and made no commit, push, deployment, release, native installation,
Keychain change, scheduler change, or live user-vault mutation. Subsequent explicitly
authorized website deployments are recorded below.

## Step-by-step launch plan

| Step | Deliverable and exit condition | Current status |
|---|---|---|
| 1. Establish the baseline | Run the complete local CI twin; review current contracts and known open risks | Baseline `bun run verify` passed all lanes |
| 2. Set the release scope | Keep demonstrated workspace features; gate experimental editing; describe format limits honestly | Mermaid Visual gated; remaining recommendations below |
| 3. Make onboarding useful | Fresh vault opens app practice; no sample note writes until explicit save; an obvious next action | Implemented ten-lesson Playground and browser review route |
| 4. Prove the practice lifecycle | Exercise edits, switches, empty/save/failure states, persistence exclusion, themes, narrow windows | New unit, native import, and browser regression coverage |
| 5. Complete native acceptance | Use a disposable folder; inspect disk before/after save; quit/relaunch; exercise permission failures | Checklist below; browser evidence does not close this gate |
| 6. Close integrity and security blockers | Resolve DOCX round-trip mismatch and the hostile-webview trust boundary, with regressions | Open; scoped evidence below |
| 7. Validate optional capabilities | Local model, supported connected providers, file surfaces, Breve, and MCP on the exact release candidate | Deterministic tests available; live acceptance still needed |
| 8. Prepare the public site | Reliable origin, accurate claims, verified links and artifacts, correct robots/download policy | Local copy/Playground improvements done; live MCP returned 522 |
| 9. Review campaign material | Export actual-product landscape/portrait videos; validate legibility and prelaunch copy | Two Remotion films and poster rendered locally |
| 10. Review and release | Greptile-reviewed PR, exact-commit CI, native sign-off, signed/notarized artifacts and release evidence | No PR or publication requested/performed |

## Production scope and feature decisions

“Candidate” below means suitable for the native beta acceptance pass, not certified
for all production workloads.

| Surface | Assessment | Required evidence before promotion |
|---|---|---|
| Markdown editing, tasks/results, choices/toggles, tables, links | Beta candidate. Broad parser, editor, keyboard, and browser tests; real hover-checkbox bug fixed in this pass | Native save/reopen, long notes, external edits/conflicts, IME and accessibility spot checks |
| Main/named views, tabs/splits, search, file lifecycle | Beta candidate. Existing E2E covers real controls, pointer drag, empty tabs, views, folder management, trash, and selection | Native rename/trash/restore and reboot; confirm projection removal never deletes content |
| App-owned Playground | Implemented and exercised. Ten real Markdown lessons; session buffers; explicit save into Main; no practice content in persisted preferences/layout | Fresh native vault and restart/switch validation; inspect actual files |
| Mermaid View and Code | Retain production viewing/source editing; View/Code-only and source Apply verified manually in the production browser build | Native apply/reopen |
| Mermaid Visual editor | **Development-only**, `LAUNCH_FEATURES.mermaidVisualEditing` | Promote only after supported-subset round-trip and interaction acceptance; unsupported source must remain intact |
| JSXGraph, usage charts, Excalidraw | No Tailwind chart implementation was found. Existing surfaces were not broadly disabled | Identify the user's intended chart if different; native board/import/save and real graph fixtures |
| DOCX | **Hold broad production claims.** Current source still has confirmed fidelity risks listed below | Restrict unsupported toolbar actions or implement complete codec support; real Word-authored round-trip fixtures |
| Sheets/CSV | Treat as bounded beta capability, with explicit supported-format scope | Excel/LibreOffice-authored formulas, formatting, merged cells, dates, large files, concurrent writes, reopen and source-app comparison |
| Images/video, PDF/audio/other files | Images/video are preview-only by product law; other advertised supported formats need editable or explicit conversion paths | Test real files and each offered conversion. Do not imply generic support from a thumbnail or parser test |
| Chat/local models/Librarian | Optional; core writing works without setup | Actual model download/cancel/retry, offline behavior, stop generation, artifact save, secure/locked policy under each lane |
| Connected providers | Advertise Claude Code/Codex and Cursor code chat according to current capabilities; removed stale Google/Antigravity wording in touched copy | Native install/auth/status/errors, cancellation and policy checks without real private notes |
| Breve and scheduling | **Development-only** through the frontend and native build policy. Hidden and refused in stable; deterministic tests do not prove delivery | Disposable config, actual scheduler lifecycle, sleep/wake, restart, exactly-once delivery and recovery |
| Local CLI/MCP and remote agents | Local transport plus explicit session opt-in; hosted relay is not launched | Run disposable packaged CLI self-test; test pairing/reconnect/revocation with a controlled relay |
| Themes/appearance | Twelve environments covered by existing guards and browser tests; new Playground controls fit all twelve and 760px window | Human/native text contrast, keyboard/VoiceOver, system appearance and multiwindow synchronization |
| Signing/updater/release | Separate launch gate | Exact reviewed source, CI success, notarization/stapling, update/rollback, and retained release evidence |

The chart request was ambiguous: no Tailwind/Recharts/Tremor code or dependency was
found. An early clarification received no answer. The implemented assumption is
**Mermaid Visual editing**, not all Mermaid diagrams or JSXGraph. This is a
central build-time flag, not a user-toggled setting or URL override.

## Open blockers and evidence

1. **Security trust boundary:** [egress threat model](egress-threat-model.md) still
   records OPEN P0. The same webview can display secure plaintext and invoke
   outbound commands. Phrase detection cannot enforce information flow after
   paraphrasing/encoding. This pass did not reproduce an exploit or claim to fix
   that architecture. Resolve capability isolation/trusted context construction
   before asserting hostile-webview non-disclosure. Site copy now describes the
   actual remote-context policy and avoids “never leaves your Mac.”
2. **DOCX fidelity:** rechecked current `src/documents/codec/docx.ts`: numbered-list
   decoding assumes `numId === "2"`, encoding writes `numId="1"`, and
   `sameParagraph` still uses JSON string equality. The current Univer preset
   enables its general toolbar without a capability menu restriction. This
   supports carrying forward the [September 1 audit](system-audit-2026-09-01.md)
   as an unresolved launch concern; it is not a new live Word round-trip test.
   Do not market arbitrary Word fidelity until external fixtures and native
   reopen comparisons pass.
3. **Native acceptance remains unproven:** browser fixtures never create a real
   vault or touch bookmarks, native titlebars, global shortcuts, Keychain,
   updater, or scheduler. Rust temporary-directory tests cover specific adapters,
   not the installed-app experience.
4. **Live site availability:** Chrome computer use reached `https://rotli.co/`
   (coming soon) and `https://dev.rotli.co/` (full preview). Clicking MCP reached
   a Cloudflare 522 at `https://dev.rotli.co/mcp/` on 2026-09-07 at 20:46 UTC;
   retry also timed out. Local `/mcp/` renders correctly. Inspect Railway origin
   health and Cloudflare-to-origin connectivity before publication; no DNS or
   production service changes were made.
5. **Release assurance:** [release contract](../operations/release-and-supply-chain.md)
   still records hardening gaps for SBOM/provenance, channels/rollback, and key
   recovery. The September 9 changes retain notary evidence but still need an
   owner-authorized signing/notarization acceptance run. Local verification does not sign off
   these operational requirements.

## Dependency advisory gate

The advisory audit is outside `bun run verify`; it was run separately against
the current lockfiles on 2026-09-07. No dependency versions were changed by this
launch pass except the isolated new marketing project.

| Audit | Result | Launch action |
|---|---|---|
| App `bun audit` | **13 advisories: 8 high, 5 moderate**, nonzero exit | Review reachability and update through the repository dependency workflow; rerun full proof |
| Site `bun audit` | No vulnerabilities reported, 358 packages | Retain lockfile and rescan at release |
| Marketing `bun audit` | No vulnerabilities reported, 280 packages | Isolated build-tool dependencies; rescan before reuse |
| `cargo audit --file src-tauri/Cargo.lock` | 619 crates; 20 allowed warnings: 17 unmaintained, 2 unsound, 1 yanked; no fatal vulnerability finding | Record target-specific reachability and update/review affected dependencies |

The app findings name `lodash-es` (including a vulnerable 4.17.21 path), old
`nanoid` transitive versions, `sharp` 0.34.5/libvips, and `uuid` 8.3.2. Relevant
upstream advisories include [Lodash template injection](https://github.com/advisories/GHSA-r5fr-rjxr-66jc),
[nanoid non-secure generator bounds](https://github.com/advisories/GHSA-28wg-ghj8-5hjv),
[sharp/libvips](https://github.com/advisories/GHSA-f88m-g3jw-g9cj), and
[uuid buffer bounds](https://github.com/advisories/GHSA-w5hq-g745-h8pq).
An advisory match is not proof of an exploitable Rotli call path; neither is it a
reason to waive the finding without review.

For Rust, the Apple-silicon target tree confirms `lru` 0.16.4 is reached through
`tantivy` 0.26.1, so its [panic-safety warning](https://rustsec.org/advisories/RUSTSEC-2026-0253)
needs Mac-side review. `glib` has no reverse dependency on that target; many GTK3
warnings are Linux-related. The yanked `chacha20` and remaining unmaintained
crates also need a documented disposition. Do not apply cross-major forced
overrides merely to turn an advisory counter green.

## Playground and onboarding acceptance

Revised 2026-09-10: the new-vault flow seeds a **Welcome** folder in Main
holding the real `Welcome to Rotli.md` and nine ordinary lesson notes, and
opens the welcome note as a note tab. The session-only Playground tab, its
lesson dropdown, the named-view import, and the practice-vault option are
gone. Settings → General → **Open welcome folder** re-seeds missing lessons
and reopens the welcome note; opening an existing vault never writes. Intact
lessons are reused by title without overwriting user edits; they are not
silently upgraded.

| Lesson | Exercise | Proof in this pass |
|---|---|---|
| Start here | Understand practice vs save and choose a first task | Rendered, no Main entries |
| Writing and formatting | Edit text, lists, headings, slash insertion, raw source | Draft edit/switch retention, selected lesson/saved status on return, and empty-save disabled; existing Markdown E2E |
| Tasks and progress | Task checkbox, pass/fail and labeled results, inspect source | Computer use, explicit save E2E, pointer overlap regression |
| Choices and toggles | Radio-like choices, independent squares, switches | Lesson rendering plus existing deterministic grammar/interaction coverage |
| Tables and code | Edit table cells, resize, preserve inline literals, math/code | Lesson rendering; existing table/editor tests; practice widths excluded from settings |
| Links and finding | Save, create a note, link, search, rename alias | Explicit user steps; existing search/link tests; native acceptance still required |
| Main and named views | Same note in two projections; remove view vs trash file | Existing named-view/lifecycle E2E; lesson rendered |
| Files and attachments | Disposable DOCX/sheet/board/image/video/PDF | Native checklist; does not pretend browser fixtures prove durable formats |
| AI and privacy | Optional AI, offline writing, secure read and locked write refusal | Deterministic policy tests; no live provider or private note access performed |
| Your launch checklist | Create/find/rename/trash/restore, tabs, themes, save/reopen | Editable acceptance record; native checks remain explicit |

Lessons are ordinary notes from the first moment: they enter search, Tasks,
Library, and Main like any file, and every edit saves to the lesson file. Main
filing failures remain visible and the next open retries them without creating
files; a vault switch during seeding refuses the stale result. The table above
records the 2026-09-07 pass against the earlier session-tab model; the E2E
coverage in `docs/development/testing.md` describes the current proof.

## Disposable native acceptance script

Use one explicitly selected new temporary folder and synthetic content. Record
macOS version and exact app build. This list is deliberately not marked passed.

- [ ] Launch on a clean app profile; choose name/appearance/window behavior using real controls.
- [ ] Cancel folder choice, reject Home/credential roots/nonempty fresh target; create a valid empty folder.
- [ ] Test both Raw and Librarian choices; cancel/fail activation and confirm setup remains recoverable.
- [ ] Finish or skip models; Playground appears immediately in Home; Main has no lesson references.
- [ ] Inspect folder contents before/after editing three practice lessons: no lesson files or practice metadata.
- [ ] Quit/relaunch and switch vaults: unsaved practice resets without lost-save warnings or leakage.
- [ ] Explicitly save a lesson; inspect ordinary Markdown, Main reference, Tasks/search membership, and reopen after restart.
- [ ] Force a save/Main write failure on a disposable target; retry without duplicate files or false saved state.
- [ ] Create/edit/search/rename a user note, follow its old alias, make a named view, remove the view, then trash/restore the file.
- [ ] Open an existing disposable Markdown vault and a copied import; cancel review and verify original bytes remain unchanged.
- [ ] Exercise two panes, many tabs, last-tab close, narrow window, Tab navigation and VoiceOver.
- [ ] Verify all six theme families in light/dark, system changes, titlebar/menu, summon/capture hotkeys and floating windows.
- [ ] Edit a long note with tables/code/diagrams; test undo, external edits, conflict errors and disk full/read-only.
- [ ] Save/reopen Word-authored DOCX with supported/unsupported formatting and compare in Word.
- [ ] Save/reopen Excel/LibreOffice-authored sheets with formulas/dates/styles and compare in their source app.
- [ ] Save/reopen a real Excalidraw board and Mermaid source; unsupported visual source must remain unchanged.
- [ ] Attach/drop real images/video; test rename/move/missing file and narrow-window playback.
- [ ] Confirm PDF/audio/unsupported-format editing or explicit conversion states match the capability contract.
- [ ] With synthetic secure/locked notes, test every enabled model/agent lane and inspect resulting files and context.
- [ ] Download/cancel/retry a local model; disconnect network; stop a run; save chat and artifact; restart.
- [ ] Check provider unavailable/auth-expired/quota cases; no automatic fallback to an unapproved provider.
- [ ] Run packaged `rotli agent self-test`; test local stdio and a controlled relay session's disconnect/revoke behavior.
- [ ] Test optional Breve routine lifecycle, sleep/wake, failed delivery and retry in disposable configuration.
- [ ] Validate signed/notarized app+DMG, upgrade from current beta, failed update, and rollback without vault loss.

## Site and campaign review

The dev header mode toggle and Grove family preview changed correctly in Chrome.
In the production app preview, `?onboarding` did not activate test setup. Settings
opened Playground; a task click changed `[ ]` to `[x]`, an explicit save added
one note to Main, and Open saved copy preserved the edit. New → Mermaid opened
a real diagram whose workspace showed View and Code only; source edits applied.
The manual return-to-Playground reset was reproduced in E2E and fixed by keeping
selection, save receipts, and saved status for the app session.
The local revised site exposes the new Playground capture, corrected provider and
accessory claims, and an MCP guide with an explicit unlaunched-hosted-relay notice.
The coming-soon page now has a GitHub development CTA without adding a collection
service. Full/dev/coming-soon build policies remain centralized in `site/src/site.ts`.
Do not enable `SITE_MODE=full` until the intended signed release link is verified.

[Marketing source and instructions](../../marketing/README.md) provide two muted
18-second Remotion films, landscape 1920×1080 and portrait 1080×1920, plus a poster.
Both use canonical brand assets and the actual browser capture. Intro/product/end
frames were visually reviewed; metadata confirmed H.264 and 30fps. Copy is
prelaunch-safe. Nothing has been posted.

## Verification record

Final working-tree `bun run verify` **passed quality, E2E, and Rust** on
2026-09-07. Results:

| Check | Result |
|---|---|
| Frozen app/Breve/site installs | Passed, no lockfile drift |
| App unit suite | 1,632 passed, zero failed |
| Breve Bun suite | 46 passed, zero failed, plus deterministic script checks |
| Repository tooling suite | 79 passed, zero failed |
| MCP relay suite | 7 passed, zero failed |
| Deterministic model eval selection | 155 passed, zero failed; overlaps the app unit suite |
| TypeScript/Oxc/architecture/IPC/structure/security/design/docs/coverage gates | Passed |
| Production app build and dependency convergence/license checks | Passed |
| Astro check | Zero errors, warnings, or hints |
| Site full and coming-soon builds | Passed in the canonical verify chain |
| Site dev build | Passed separately with `SITE_MODE=dev` and the dev canonical URL |
| Chromium E2E | 114 passed, zero failed |
| Rust clippy | Passed with warnings treated as errors |
| Rust tests | 462 passed, zero failed, one ignored search performance benchmark |
| Marketing frozen install/typecheck | Passed |
| Marketing renders | Both compositions completed; metadata and representative frames reviewed |
| `git diff --check` / final docs check | Passed |

Full verification log (`_review/launch-2026-09-07/verify.log`, local only),
app advisories (`_review/launch-2026-09-07/rotli-launch-dependency-audit.log`),
and Rust advisory warnings (`_review/launch-2026-09-07/rotli-launch-cargo-audit.log`)
are local review artifacts, intentionally ignored by Git. Earlier targeted
failures reproduced the checkbox overlap, Playground return-state loss, and
concurrent-draft save mismatch; all corresponding final checks pass.

Computer-use review was performed in Chrome on the browser twin, production
preview, public sites, and the local revised site. Ocean Light/Dark and narrow
Playground captures and representative film frames were visually inspected.
No native/manual acceptance checkbox above is implied passed by those results.

### Follow-up: Retina images and consistent site appearance

The initial 1× media was visibly soft on Retina displays. The site now uses
fresh lossless 3× captures: six theme images at 3840 × 2400 and the Playground
at 4320 × 2700. New `@3x.png` URLs retire cached 1× images. Companion artwork is
rendered from the canonical SVGs at 1536px through the existing fill pipeline;
the app's 512px exports are unchanged. Media regeneration belongs to
[`site/README.md`](../../site/README.md).

The site is fixed to Rotli Light, with Paper confined to the hero and alternate
app themes confined to the theme showcase. The global appearance toggle and
saved family/mode application are removed. The low-resolution coastline is no
longer stretched behind the Paper hero. The original image remains in the repo.

Chrome computer use confirmed the Paper hero and isolated Grove selection.
Separate browser checks at 375, 760, and 1440px, each with 3× density, a dark OS,
and stale Midnight/Dark site preferences, passed: all six theme controls change
only their preview, every displayed image has at least 3× its CSS width, all
images decode, and the document has no horizontal overflow. Narrow Playground
screenshots, native-pixel text detail, and companion art were visually reviewed.
Both Remotion films were rerendered with Rotli Light high-resolution assets;
product frames and H.264/30fps/dimension/duration metadata were rechecked.
The final full `bun run verify` passed again with the same counts above
(1,632 app unit, 114 browser E2E, and 462 Rust tests; one ignored benchmark).
Astro diagnostics remain at zero errors/warnings/hints. The first verification
attempts caught missing registration/documentation for the capture command;
both were corrected before the final full pass. Follow-up evidence is in
`_review/retina-site/` (local only), including verification,
responsive, capture, and marketing render logs. No deployment was performed.

Local development previews are left available for review at
`http://localhost:1430/?onboarding` (fresh in-memory onboarding) and
`http://127.0.0.1:4330/#playground` (revised site). Reloading browser onboarding
resets its simulated vault. The temporary production smoke-test server is stopped.
The pre-existing site server on port 4321 was left untouched.

### Authorized website publication — 21:47–21:51 UTC

The user requested the original coastline back at low opacity, publication to
dev, and a refreshed main-domain coming-soon page. The coastline now appears
only in the landing hero at 10% opacity over Paper. The holding page uses Rotli
Light, the sharp Playground capture, concise onboarding copy, an early GitHub
CTA, and a compact mobile quokka. This preserves the intent of the live mobile
fix from `f49ff2d`, which was ahead of the local checkout.

Both Railway deployments succeeded, in project `rotli-site`, service `site`:

| Environment | Deployment | Public result |
|---|---|---|
| dev | `5315676b-958b-4314-adf2-2b5c37ff9949` | `https://dev.rotli.co/` and `/mcp/` return 200; full preview, no downloads, noindex |
| production | `62af7eaf-61f8-445a-8f28-fd7df3da9677` | `https://rotli.co/` returns 200; coming-soon only, no downloads, indexing allowed; `/mcp/` correctly returns 404 |

The upload was a 42-file, 3.4 MB site-only snapshot, including the two imported
canonical SVGs and fonts. All source hashes matched the verified tree. No app
source, vault, secrets, marketing render dependencies, or unrelated work was
uploaded. No Git commit/push, branch promotion, native installation, app release,
or DNS change was made. The source changes remain in the local worktree; a later
automatic branch deployment must include them to retain this revision.

The final `bun run verify` passed all lanes again: 1,632 app unit tests, 114
Chromium E2E tests, 462 Rust tests and one intentionally ignored benchmark;
Astro reported zero errors/warnings/hints. Local dev/holding-page checks passed
at 375, 760, 1024, and 1440px with dark OS and stale saved theme preferences.
Image decoding, 3× product-image density, no horizontal overflow, hero opacity,
and prelaunch controls were checked. Chrome computer use visually confirmed
both public deployments. All seven live dev captures and the main Playground
image matched the reviewed source bytes. The earlier intermittent MCP 522 was
absent in the pre- and post-deployment HTTP checks; this is current availability
evidence, not a claim of sustained uptime.

Caddy logs contained only the expected configuration warnings: admin endpoint
disabled and HTTP/2/HTTP/3 skipped on the internal plain-HTTP listener behind
Railway/Cloudflare TLS. Cloudflare's existing bot-specific robots rules were
preserved. The main site's general indexing allow and sitemap remain present.

Source manifest, build/deployment logs, full verification log, and responsive
screenshots are in `_review/site-publish-2026-09-07/` (local only).
An additional local coming-soon preview was started at `http://127.0.0.1:4331/`.
Browser proof still does not cover native OS integrations or actual vault I/O.


### September 9: focused public launch preparation

The current owner decision is **notes and chat first; Breve in development only**.
This is a launch-scope decision, not an assertion that the native release has
passed acceptance. Existing conventional file adapters are preserved while their
fidelity/promotion gates remain open; do not market them as launch-ready.

`src/lib/featurePolicy.ts` owns frontend availability. Vite serves `dev` by
default and builds `stable` by default; explicit `ROTLI_BUILD_CHANNEL=dev` permits
an experimental preview build. Rust's build script consumes the same variable,
defaulting debug to dev and optimized release to stable. The release script forces
stable. Neither persisted settings nor URLs or runtime environment can promote a
compiled stable build. Mermaid Visual and Breve are off in stable. A dev Git branch
is not itself a runtime security boundary: use the explicit channel for packaged
dev builds, with the existing separate development app identity/configuration.

Since September 11, `agents` joins the policy: stable builds hide Settings →
Connections → Remote agents and the Claude Code extension prompt, refuse the
five `remote_agent_*` commands, and refuse `rotli mcp` and `rotli agent …` from
the packaged binary. The plain JSON CLI stays available. The site shows the MCP
guide and the agent lanes only on the dev site.

Breve's stable gate covers its sidebar control, action registry, pane render,
settings restoration, all 16 IPC commands, login-agent installation, runtime sync,
and scheduler startup/rebind. Existing local Breve data and installed launch items
are not deleted by preparation or this gate. Debug/native preview retains its
existing simulated delivery and no-background-scheduler behavior. Tests compile
the stable native policy and prove refusal before credential commands; installed
app lifecycle acceptance remains outstanding.

Repository controls and outstanding historical/privacy review are recorded in
[repository access](../operations/repository-access.md). GitHub full-SHA action
pinning was enabled and read back. Main/dev rule application is blocked by GitHub's
private-repository plan requirement. No repository visibility change, invitation,
commit, push, signing, notarization, app installation, or deployment was performed
in this pass. Signing hardening is source/test verified only; revised Gatekeeper
and notary behavior still need an explicitly authorized candidate run.

The built-app privacy gate also inspects ignored bundled resources, binary
home-path strings, and external symlinks before any Apple upload. Breve resource
files must occur in the clean source manifest; arbitrary ignored personal notes
cannot enter the bundle. Compiler paths are remapped to generic build paths.
Developer ID signer identity remains public by design and needs the owner's
review before a public artifact is approved.

The website now has a fail-closed private-source toggle and a public notes/chat
story. Broader features are described only on the dev site. This marketing
visibility does not disable conventional file adapters in the app. Removed image
generation is not advertised as a functioning development feature. All three
site modes have a click-to-play film slot and an explicit playback failure state;
the slot requires nonempty MP4, poster, and VTT artifacts.

The [HyperFrames film record](../../marketing/HYPERFRAMES.md) owns the 44-second
promo, its Fable/Astra creative workflow, original audio provenance, synthetic
capture boundary, and the initial unintended Gemini frame-description call.
The final export uses 2880×1800 source footage and delivers 1080p/30fps H.264
with captions, music and sound effects, no voiceover. The film is placed below
the hero. No native notes or model conversations were captured.

Current local evidence:

- `bun run verify` covers secrets, quality, browser E2E, and Rust. The passing
  run includes 1,633 app unit tests, 114 browser tests, and 464 Rust tests with
  one ignored benchmark. An earlier isolated Rust run hit a transient
  `workspace::tests::loopback_http_requires_its_bearer_and_serves_the_same_tool_list`
  failure; subsequent complete runs passed unchanged.
- Full, dev, and coming-soon pages were checked at 360/760/1080/1440px, with
  no horizontal overflow, decoded product images, source links absent,
  the correct downloads/experiments/robots/MCP boundary, keyboard playback,
  loaded captions, and a visible failed-playback fallback. Chrome computer use
  confirmed actual Playground controls and video playback with audio.
- HyperFrames passed runtime, motion, layout, and all 11 contrast checks;
  final media is 44.000 seconds, −19.2 LUFS, −3.0 dBTP. Three advisory renderer
  warnings remain (duplicate static media discovery and dense tracks).
  The inherited JSXGraph direct-eval warning remains an acknowledged build
  warning. A human listening pass is still appropriate for subjective audio
  approval; technical metering does not substitute for listening.
- A temporary local Caddy container proved `text/vtt`, `video/mp4`, same-origin
  media policy, nosniff, and 206 byte-range responses. Its restricted read-only
  storage produced a cache-maintenance warning; plain HTTP also skips HTTP/2/3.
  The container was stopped after inspection. This does not prove deployed CDN
  behavior. Review screenshots are under `_review/site-launch-review/`.

**Not cleared for launch:** GitHub plan-gated branch enforcement; historical
secret-fixture provenance and prior personal-path review before any source
publication; the existing open P0 in the egress threat model; native acceptance;
and the remaining release provenance/recovery gates above. Local preparation
does not change the live sites or authorize signing, notarization, or publication.
