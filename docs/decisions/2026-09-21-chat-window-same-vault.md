# The Chat window: a second shell window over the same vault

**Date:** 2026-09-21 · **Status:** accepted, in the work (development builds)

## Context

The owner's roadmap: pull "Chat" out of the Home | Chat switch into a window of
its own that shows only what belongs to Chat; an icon groups it back; Home can
never be pulled out — main is where Home lives.

The 2026-07-27 spike
([`2026-07-26-stage-plan-vault-platform.md`](2026-07-26-stage-plan-vault-platform.md))
ruled **no-go** on a window per *vault* (XL: it inverts the single-active-corpus
design) and priced a second window over the **same** active vault at **M**:
"event routing, QuitFlush label list, summon/blur laws — the Quick window proves
the multi-webview pattern." This is that M. Nothing in the no-go is reopened:
both windows share one vault, one Rust store, one watcher, one settings file.

## Decision

1. **Pre-declared, shown and hidden — never created or destroyed.** The `chat`
   window sits in `tauri.conf.json` beside `quick` and `capture`, running the
   same bundle at `index.html?window=chat`. The summon law holds: closing never
   destroys. Its close button asks the webview to hand its chats back first,
   because a hidden window must not strand them.
2. **Main stays the one writer.** Viewstate, settings, and `.rotli/main.json`
   are written by main alone (the existing `isMainSurface` gates already refuse
   everyone else). The chat window *reports*: the saved chats open in it (main
   folds them into the layout it saves, so a quit with the window up loses
   nothing — the next launch finds them regrouped) and additions it computed for
   Main (main merges the fragment). This is the Quick window's
   `rotli:quick-set` / `rotli:quick-created` shape, as one event with a `kind`.
3. **A chat moves as a reference, with its unsent text.** Each webview keeps
   session drafts in its own memory. A draft holding image attachments cannot
   cross webviews (their sources are that window's object URLs), so pop-out
   waits for it — in plain words — rather than leave that tab behind in main.
   On regroup the window is about to hide, so everything goes back and such
   images are dropped rather than stranded.
4. **One chat is never open in both windows** (two writers on one transcript).
   Three rules hold it: `panes.openChat` in main routes every chat to the
   window while Chat is out; main keeps an invariant that moves any chat tab
   that turns up there anyway (a split, ⌘⇧T reopening one); and within a
   window a handed-over chat already open is brought forward, never opened as
   a second tab.
5. **A running chat does not move, in either direction.** A turn lives in the
   webview it runs in (React refs, a stream channel bound to that webview);
   Rust is stateless per turn. Moving it would orphan the reply and leave the
   model process running for nothing. Pop-out refuses; regroup (the button in
   main, or the window's close button) keeps the window up, brings it forward,
   and says why. Handing a live run across webviews needs a Rust-side run
   registry — a separate, larger decision.
6. **The shell windows hear the same vault events.** `rotli:corpus-changed` and
   `rotli:local-queue` go to every shell window (`chat_window::SHELL_LABELS`). A
   shell that misses `corpus-changed` shows a stale chat and then fails its next
   save on the revision gate — silently, with no CI proof. `⌥A` goes to
   whichever window Chat lives in, and follows the same policy in both: back to
   the chat already open, else the newest, else a fresh one.
   While handing back, the window does not report its (emptying) tabs: an
   interim empty report reaching main before the hand-back would drop those
   chats from the layout main saves, and a quit in between would lose them.
7. **Keys are opted in, not shared.** The key registry gains a `chat` surface;
   main's tab, pane, zoom, and New chat actions are opted in one by one
   (`alsoOnSurface`). `shared` would also fire them in Quick and Capture, and no
   note command may reach a window made of chats.
8. **Pop out by button, not by drag — yet.** The roadmap says "hold and drag
   Chat out". Pointer drags here are hand-rolled (`lib/pointerDrag.ts`: HTML5
   drag is dead in WKWebView) and listen on `window` without pointer capture;
   whether WKWebView keeps delivering `pointermove` outside the window's bounds
   is unverified and cannot be proven in CI. The drag form waits on a half-day
   native spike. Until then: the companion button on the Chat segment, its
   context menu, and the `chat.window` action.
9. **Not on the web.** A second browser tab would be a second writer with no
   revision coordination between them.

## Status: behind `LAUNCH_FEATURES.chatWindow`

Development builds only, like Sheets. The reason is proof, not polish: Playwright
drives the browser twin, so the second webview, the events between the windows,
the four-window quit handshake, and the close/blur laws are **not** covered by
CI. `e2e/chat-window.spec.ts` proves the shell is chat-only; the unit suites
prove the hand-off rules. The rest is the owner's native checklist in the PR.
Public release is one line in `src/lib/featurePolicy.ts` (`chatWindow: desktop`)
once that checklist passes.

## Consequences

- A public build still declares the hidden `chat` window (a fourth webview that
  loads the bundle at launch, like Quick and Capture). It is in the quit-flush
  label list and acks at once, because it holds nothing dirty.
- Main's sidebar run badges do not reflect runs inside the chat window: each
  webview has its own `chatRuns` store. Accepted for now; mirroring is a small
  follow-up over the same event.
- Window geometry is remembered while the app runs and lost on relaunch
  (`tauri-plugin-window-state` is not installed) — the Quick window's existing
  limitation.
