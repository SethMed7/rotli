import { useEffect, useState } from "react";
import "./styles/base.css";
import "./styles/app.css";
import "./styles/notes.css";
import "./styles/editor.css";
import "./styles/render.css";
import "./styles/command.css";
import "./styles/quick.css";
import "./styles/onboarding.css";
import "./styles/board.css";
import "./styles/memex.css";
import "./styles/breve.css";
import "@excalidraw/excalidraw/index.css";
import "./styles/canvas.css";
import { Suspense, lazy } from "react";
import { CaptureCard } from "./components/captureCard";
import { NotesSurface } from "./components/notesSurface";
import { Palette } from "./components/palette";
import { PreviewModal } from "./components/previewModal";
import { ContextMenu } from "./components/contextMenu";
import { QuickNote } from "./components/quickNote";
import { RenameDialog } from "./components/renameDialog";
import { Titlebar } from "./components/titlebar";
import { WhichKey } from "./components/whichKey";
import { registerDefaultActions } from "./keys/actions";
import { type Surface, applyRebind, attachDispatcher, dispatch } from "./keys/registry";
import { useHeldModifier } from "./keys/useHeldModifier";
import {
  checkForUpdate,
  corpusImportFile,
  emitCaptureAck,
  emitThemeSet,
  isTauri,
  onBrainJournal,
  onCaptureSave,
  onCorpusChanged,
  onOpenRequest,
  onOrganizerProgress,
  onQuickSet,
  onRebind,
  onSummonChat,
  onSummonSearch,
  onThemeSet,
  setAppIcon,
  setDockVisible,
  setHideOnBlur,
  workspaceTakeOpenRequest,
} from "./lib/tauri";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { EditorView } from "@codemirror/view";
import { activeInstance, isWritable } from "./memex/config";
import {
  chooseFolder,
  createPracticeVault,
  initMemexAsCorpus,
  loadConfig as memexLoadConfig,
  writeNote,
} from "./memex/service";
import { summonChat } from "./services/chatSummon";
import { adoptPendingAtOrganize } from "./services/librarianAutoAdopt";
import { useOrganizerLive } from "./state/organizerLive";
import { flushSettingsNow } from "./state/persist";
import { hydrateMain } from "./state/main";
import { hydrateViews } from "./state/views";
import { useMemexStore } from "./state/memex";
import { DEST } from "./services/destinations";
import { invalidateFolders, invalidateJournal, invalidateNotes } from "./services/hooks";
import { queryClient } from "./services/query";
import { notesService } from "./services/notes";
import { activeTabOf, leaves, usePanesStore } from "./state/panes";
import { applyQuickState } from "./state/quick";
import { applyAccent, applySyntaxPalette, applyTheme } from "./state/theme";
import { useUiStore } from "./state/ui";

// Settings and Onboarding are full-surface fronts most sessions never (or
// once) open — split them off the entry chunk like paneTree's CanvasSurface
// (perf audit 2026-07-30, #18). Suspense falls back to nothing for a frame.
const SettingsSurface = lazy(() =>
  import("./components/settingsSurface").then((m) => ({ default: m.SettingsSurface })),
);
const Onboarding = lazy(() => import("./components/onboarding").then((m) => ({ default: m.Onboarding })));

registerDefaultActions();

if (import.meta.env.DEV) {
  // Review automation can drive any registry action (__rotli.dispatch) and
  // observe cache behavior (__rotli.queryClient — the e2e proof that typing
  // no longer refetches the notes universe, audit 2026-07-30 #1).
  (
    window as Window & {
      __rotli?: { dispatch: (actionId: string) => void; queryClient: typeof queryClient };
    }
  ).__rotli = {
    dispatch,
    queryClient,
  };
}

/** Which surface this webview shows. Default = the main window;
 *  `?window=capture` = the quick-capture card; `?window=quick` = the floating
 *  Quick Note window. */
function surfaceFromUrl(): Surface {
  const param = new URLSearchParams(window.location.search).get("window");
  if (param === "capture") return "capture";
  if (param === "quick") return "quick";
  return "main";
}

declare const __APP_VERSION__: string;
const APP_VERSION = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "0.0.0";

/** Compare dotted versions numerically: <0 if a<b, 0 if equal, >0 if a>b. */
function cmpVersion(a: string, b: string): number {
  const pa = a.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

// The onboardingVersion gate. While 0.x (beta), re-onboard on EVERY version change
// (the flow keeps evolving). Post-1.0, freeze the bar at 1.0.0 so updates never
// re-onboard — only a fresh install (no prior onboardingVersion) does.
const REQUIRED_ONBOARDING_VERSION =
  (Number.parseInt(APP_VERSION.split(".")[0] ?? "0", 10) || 0) >= 1 ? "1.0.0" : APP_VERSION;

function MainShell() {
  const settingsOpen = useUiStore((s) => s.settingsOpen);
  const paletteOpen = useUiStore((s) => s.paletteOpen);
  const setPaletteOpen = useUiStore((s) => s.setPaletteOpen);
  const focusMode = useUiStore((s) => s.focusMode);
  const onboarded = useUiStore((s) => s.onboarded);
  const setOnboarded = useUiStore((s) => s.setOnboarded);
  const onboardingVersion = useUiStore((s) => s.onboardingVersion);
  const setOnboardingVersion = useUiStore((s) => s.setOnboardingVersion);
  // first run (the real app only). The version gate ALSO re-onboards on every 0.x
  // update — bulletproof regardless of the `onboarded` flag's state on disk.
  const showOnboarding =
    isTauri() &&
    !import.meta.env.DEV &&
    (!onboarded || cmpVersion(onboardingVersion, REQUIRED_ONBOARDING_VERSION) < 0);

  // hold ⌘ ~0.5s on the main surface → the non-modal shortcut map. Gated off
  // while the palette or settings own the keyboard, so it never doubles up; the
  // hook releases the moment a real chord fires (Seth, 2026-06-13).
  const [whichKey, setWhichKey] = useState(false);
  useHeldModifier({
    modifier: "Meta",
    delayMs: 500,
    enabled: !paletteOpen && !settingsOpen && !showOnboarding,
    onHold: () => setWhichKey(true),
    onRelease: () => setWhichKey(false),
  });

  // focus mode is window-wide: chrome everywhere reacts to one attribute
  useEffect(() => {
    if (focusMode) document.documentElement.dataset.focus = "true";
    else delete document.documentElement.dataset.focus;
  }, [focusMode]);

  // the capture card lives in another webview; this window owns the corpus — it
  // drops the capture onto the BOARD as a card (a real .md in Board/, NOT a note
  // in your list), then acks so the card may clear. Plain Enter never surfaces
  // the app (open=false); ⌘Enter (open=true) opens the Board so you can see it.
  //
  // With a writable memex, ⌥C lands as a STAGED NOTE in wiki/_inbox/ instead (no
  // Board card; inbox.md is not a rotli write surface — #96, audit 2026-07). The
  // brain path resolves the active instance imperatively each time (it's not in a
  // store yet here), and falls back to the Board on ANY failure — a capture must
  // never be lost. The card clears ONLY when we ack, so we ack ONLY on a confirmed
  // save — on total failure the draft stays put for the next summon.
  useEffect(
    () =>
      onCaptureSave(({ id, body, open }) => {
        const toBoard = async () => {
          await notesService.createNote(DEST.board, body, { secure: true });
          await invalidateNotes();
          if (open) useUiStore.getState().setContentView("board");
        };
        void (async () => {
          let saved = false;
          try {
            // Quick capture has ONE default home (not a user setting): a staged
            // note in the brain's wiki/_inbox when writable, else the Board.
            const cfg = await memexLoadConfig();
            const inst = activeInstance(cfg);
            if (inst && isWritable(inst)) {
              // a quick capture is a STAGED NOTE in wiki/_inbox → it shows in the
              // one Captures surface (Seth, 2026-06-30). ⌘Enter surfaces Captures.
              await writeNote({ instance: inst, body, secure: true });
              await invalidateNotes();
              if (open) useUiStore.getState().setContentView("board");
            } else {
              await toBoard();
            }
            saved = true;
          } catch {
            // any failure (inbox write refused, memex gone) → never drop the
            // capture; try the Board as a fallback
            try {
              await toBoard();
              saved = true;
            } catch {
              /* total failure — leave the draft UN-acked so the next summon resumes it */
            }
          }
          // ack ONLY on a confirmed save: the ack clears the card's draft, so on
          // total failure we must NOT ack (a capture must never be lost)
          if (saved) emitCaptureAck(id);
        })();
      }),
    [],
  );

  // the corpus changed UNDER the app (a folder dropped in, a note edited in
  // another editor) — refetch everything; content appears when ready
  useEffect(
    () =>
      onCorpusChanged(() => {
        void invalidateFolders();
        void invalidateNotes();
        void hydrateMain();
        void hydrateViews();
        // the same watcher callback that emits this ALSO feeds the daemon's
        // queue, so the organizer status ("N waiting") moves here — event, not
        // a 60s poll (perf audit 2026-07-30, finding 23)
        void invalidateJournal();
      }),
    [],
  );

  // `rotli open <id>` (CLI/MCP) writes one tiny request beside the corpus
  // sidecars, then activates the app — Rust forwards that activation as
  // "rotli:open-request" (perf audit 2026-07-30, #15: this was a 750ms poll
  // for the app's lifetime, ~115k IPC calls/day). Consume once at startup for
  // a request queued while Rotli wasn't running, then on each event.
  useEffect(() => {
    if (!isTauri()) return;
    let stopped = false;
    let reading = false;
    const consume = () => {
      if (reading || stopped) return;
      reading = true;
      void workspaceTakeOpenRequest()
        .then((request) => {
          if (!request || stopped) return;
          useUiStore.getState().setContentView("panes");
          usePanesStore.getState().openSummary(request);
        })
        .catch(() => {})
        .finally(() => {
          reading = false;
        });
    };
    consume();
    const unlisten = onOpenRequest(consume);
    return () => {
      stopped = true;
      unlisten();
    };
  }, []);

  // the daemon journaled (a proposal or an auto-applied action) — refetch the
  // journal (Activity + the sidebar badge) AND the notes an apply may have
  // moved. At Organize, stale metadata suggestions also adopt themselves
  // (Seth, 2026-07-31: "it is working for me in the back") — same guarded
  // approve lane the buttons use, journaled and undoable.
  useEffect(
    () =>
      onBrainJournal(() => {
        void invalidateJournal();
        void invalidateNotes();
        void adoptPendingAtOrganize();
      }),
    [],
  );
  // and once at startup — a backlog left by an older version clears itself
  useEffect(() => {
    if (!isTauri()) return;
    void adoptPendingAtOrganize();
  }, []);

  // the ambient working signal (Seth, 2026-07-31): the daemon's narration
  // feeds a tiny store the sidebar's footer dot reads — the Librarian's work
  // is visible from anywhere, not only inside its surface
  useEffect(
    () =>
      onOrganizerProgress((p) => {
        const live = useOrganizerLive.getState();
        if (p.phase === "start") live.setLive(true);
        else if (p.phase === "note") live.setLive(true, p.title ?? null);
        else live.setLive(false);
        // a cycle boundary is where daemon STATUS moves (busy, the queue
        // draining, last run/error, the secure-skip set) — Activity and the
        // sidebar badge read it from this event instead of a 60s poll (perf
        // audit 2026-07-30, finding 23). Per-note ticks carry no status change.
        if (p.phase !== "note") void invalidateJournal();
      }),
    [],
  );

  // ⌥A fired OS-side (Rust already showed the window) — land in a chat
  useEffect(() => onSummonChat(() => void summonChat()), []);

  // ⌥F fired OS-side — land in the ⌘K palette ("find", ⌥A's search twin)
  useEffect(() => onSummonSearch(() => useUiStore.getState().setPaletteOpen(true)), []);

  // external file drop. Tauri's OS drag-drop gives PATHS + the drop position. An
  // IMAGE dropped over the editor is imported into storage/ AND inserted at the
  // caret as a `![](storage:…)` link; everything else just lands in storage/.
  useEffect(() => {
    if (!isTauri()) return;
    let stopped = false;
    const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|bmp|svg|heic|heif|tiff?)$/i;
    const handleDrop = async (paths: string[], px: number, py: number) => {
      const dpr = window.devicePixelRatio || 1;
      const x = px / dpr;
      const y = py / dpr;
      const el = document.elementFromPoint(x, y) as HTMLElement | null;
      const view = el ? EditorView.findFromDOM(el) : null;
      const images = view ? paths.filter((p) => IMAGE_EXT.test(p)) : [];
      const toStorage = view ? paths.filter((p) => !IMAGE_EXT.test(p)) : paths;
      if (toStorage.length) {
        await Promise.all(toStorage.map((p) => corpusImportFile("default", p)));
      }
      if (view && images.length) {
        // import together, insert in drop order (audit 2026-07-30, batch half)
        const wires = await Promise.all(images.map((p) => corpusImportFile("default", p)));
        let insert = "";
        for (const wire of wires) {
          if (wire) insert += `\n![](storage:${wire.replace(/^storage\//i, "")})\n`;
        }
        if (insert) {
          const at = view.posAtCoords({ x, y }) ?? view.state.selection.main.head;
          view.dispatch({
            changes: { from: at, insert },
            selection: { anchor: at + insert.length },
          });
          view.focus();
        }
      }
      await invalidateNotes();
    };
    // the registration is async: on a fast unmount the `.then` hadn't run yet,
    // so a cleanup that read a not-yet-assigned `unlisten` unregistered nothing
    // and leaked the listener (perf audit 2026-07-30, finding 26). Hold the
    // PROMISE and resolve it in cleanup; `stopped` keeps a drop that lands in
    // the same gap from touching an unmounted tree.
    const listening = getCurrentWebview().onDragDropEvent((event) => {
      if (stopped) return;
      if (event.payload.type === "drop" && event.payload.paths.length > 0) {
        void handleDrop(event.payload.paths, event.payload.position.x, event.payload.position.y).catch(
          () => {},
        );
      }
    });
    void listening.catch(() => {});
    return () => {
      stopped = true;
      void listening.then((un) => un()).catch(() => {});
    };
  }, []);

  // fs mode: the window opens on the freshest note. The in-memory seed decides
  // this synchronously at module init; the disk corpus answers async — fill
  // the pristine startup tab once, never replacing anything the user opened.
  useEffect(() => {
    if (!isTauri()) return;
    void notesService.listNotes().then((notes) => {
      const freshest = notes[0];
      if (!freshest) return;
      const { root, openNote } = usePanesStore.getState();
      const panes = leaves(root);
      const only = panes[0];
      const onlyTab = only && only.tabs.length === 1 ? activeTabOf(only) : null;
      const pristine =
        panes.length === 1 && !!onlyTab && onlyTab.surfaceKind === "note" && onlyTab.noteId === "";
      if (pristine) openNote(freshest.id);
    });
  }, []);

  // Updates (Part 2): one quiet on-mount check, main surface only, never
  // blocking. CARL rule 2 — NO auto-download, NO modal, NO nag: a SILENT check of
  // the signed feed that, if a newer build is offered, just sets a transient ui
  // flag → the quiet dot on the titlebar Settings button (the titlebar reads it).
  // We check on launch, again whenever the app is summoned (it may have been
  // hidden for days), and on a slow 3-hour timer — throttled so a flurry of
  // show/hide can't hammer it. Any failure (offline, feed down) is swallowed.
  useEffect(() => {
    if (!isTauri()) return;
    let last = 0;
    const runCheck = () => {
      const now = Date.now();
      if (now - last < 600_000) return; // at most once / 10 min
      last = now;
      void checkForUpdate()
        .then((status) => {
          if (!status.available) return;
          useUiStore.getState().setUpdateAvailable(true);
          useUiStore.getState().setUpdateVersion(status.version ?? null);
        })
        .catch(() => {});
    };
    runCheck();
    const onVisible = () => {
      if (!document.hidden) runCheck();
    };
    document.addEventListener("visibilitychange", onVisible);
    const timer = setInterval(runCheck, 3 * 60 * 60 * 1000);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(timer);
    };
  }, []);

  // While onboarding, the window must NOT vanish on blur (it normally hides) —
  // the flow would disappear the moment focus slips. The real behavior is
  // (re)applied on finish from the user's chosen Stay-open value.
  useEffect(() => {
    if (showOnboarding) void setHideOnBlur(false);
  }, [showOnboarding]);

  if (showOnboarding) {
    return (
      <div className="app-window">
        <Suspense fallback={null}>
          <Onboarding
            onDone={() => {
              setOnboarded(true);
              setOnboardingVersion(APP_VERSION);
              // apply the deferred window choices now (changing them live during
              // onboarding can kill the frameless window — #1)
              const ui = useUiStore.getState();
              void setHideOnBlur(!ui.stayOpen);
              void setDockVisible(ui.showInDock);
              // commit the deferred brain choice from the "Your brain" step: "use"
              // adopts an existing memex AS the corpus, "init" scaffolds a new one.
              // Both RELAUNCH, so flush `onboarded` to disk FIRST or first-run loops
              // back into onboarding (the 500 ms debounced writer wouldn't fire in time).
              const choice = useMemexStore.getState().pendingChoice;
              useMemexStore.getState().setPendingChoice(null);
              // "keep" (the pre-seeded re-onboard default, #12) deliberately
              // commits NOTHING — the corpus stays exactly where it is.
              if (choice?.kind === "practice") {
                // the practice vault (2026-07-26): settings flush first so the
                // Librarian-vs-raw pick rides along (carry_settings), then Rust
                // scaffolds the scratch vault, registers the outgoing vault as a
                // connected library, and relaunches — no existing file touched
                void flushSettingsNow()
                  .then(() => createPracticeVault())
                  .catch(() => {});
              } else if (choice?.path && (choice.kind === "use" || choice.kind === "init")) {
                const path = choice.path;
                const kind = choice.kind;
                void flushSettingsNow()
                  .then(async () => {
                    if (kind === "init") await initMemexAsCorpus(path);
                    else await chooseFolder(path);
                  })
                  .catch(() => {});
              }
            }}
          />
        </Suspense>
      </div>
    );
  }

  return (
    <div className="app-window">
      <Titlebar />
      <main className="app-content">
        {/* Settings is the one full-surface front. Chat · Board · All-notes ·
            Recent all render inside NotesSurface's content area (contentView), so
            the three left-menu sections stay visible (Seth, 2026-06-26). Memory is
            no longer a front — the brain is browsed via the Vault tree (2026-06-28). */}
        {settingsOpen ? (
          <Suspense fallback={null}>
            <SettingsSurface />
          </Suspense>
        ) : (
          <NotesSurface />
        )}
      </main>
      {paletteOpen && <Palette onClose={() => setPaletteOpen(false)} />}
      <PreviewModal />
      {whichKey && <WhichKey onClose={() => setWhichKey(false)} />}
      <ContextMenu />
      <RenameDialog />
    </div>
  );
}

export default function App() {
  const theme = useUiStore((s) => s.theme);
  const themeFamily = useUiStore((s) => s.themeFamily);
  const matchLightFamily = useUiStore((s) => s.matchLightFamily);
  const matchDarkFamily = useUiStore((s) => s.matchDarkFamily);
  const syntaxPalette = useUiStore((s) => s.syntaxPalette);
  const accentColor = useUiStore((s) => s.accentColor);
  const surface = surfaceFromUrl();

  useEffect(
    () =>
      applyTheme(theme, themeFamily, {
        light: matchLightFamily,
        dark: matchDarkFamily,
      }),
    [theme, themeFamily, matchLightFamily, matchDarkFamily],
  );
  useEffect(() => applySyntaxPalette(syntaxPalette), [syntaxPalette]);
  useEffect(() => applyAccent(accentColor), [accentColor]);

  // theme is broadcast from the MAIN window so the quick + capture webviews
  // follow it LIVE (each applies its own theme; without this they only read it
  // from settings.json at launch and go stale — issue #4). Main is the source
  // and never listens; the others listen and never emit, so there's no echo.
  useEffect(() => {
    if (surface !== "main") return;
    emitThemeSet({
      theme,
      themeFamily,
      matchLightFamily,
      matchDarkFamily,
    });
  }, [surface, theme, themeFamily, matchLightFamily, matchDarkFamily]);
  useEffect(() => {
    if (surface === "main") return;
    return onThemeSet((p) =>
      useUiStore.setState({
        theme: p.theme,
        themeFamily: p.themeFamily,
        matchLightFamily: p.matchLightFamily,
        matchDarkFamily: p.matchDarkFamily,
      }),
    );
  }, [surface]);

  useEffect(() => {
    document.body.dataset.surface = surface;
  }, [surface]);

  // one dispatcher per webview, scoped to its surface
  useEffect(() => attachDispatcher(surface), [surface]);

  // rebinds made in the other webview land here too (one keymap, two webviews)
  useEffect(() => onRebind(({ actionId, chord }) => applyRebind(actionId, chord)), []);

  // the quick-access set is kept in step across webviews (the same pattern) —
  // the quick window emits its edits, the main window records + persists them
  useEffect(() => onQuickSet(applyQuickState), []);

  // apply the persisted Dock/app icon on startup (macOS; no-op elsewhere) —
  // main only: the quick/capture webviews would each repeat the same
  // main-thread NSApp icon call at boot for nothing
  useEffect(() => {
    if (isTauri() && surface === "main") void setAppIcon(useUiStore.getState().appIcon);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (surface === "capture") return <CaptureCard />;
  if (surface === "quick") return <QuickNote />;
  return <MainShell />;
}
