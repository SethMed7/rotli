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
import "@excalidraw/excalidraw/index.css";
import "./styles/canvas.css";
import { CaptureCard } from "./components/CaptureCard";
import { MemorySurface } from "./components/MemorySurface";
import { NotesSurface } from "./components/NotesSurface";
import { Onboarding } from "./components/Onboarding";
import { Palette } from "./components/Palette";
import { QuickNote } from "./components/QuickNote";
import { SettingsSurface } from "./components/SettingsSurface";
import { Titlebar } from "./components/Titlebar";
import { WhichKey } from "./components/WhichKey";
import { registerDefaultActions } from "./keys/actions";
import { type Surface, applyRebind, attachDispatcher, dispatch } from "./keys/registry";
import { useHeldModifier } from "./keys/useHeldModifier";
import { GLASS_BG_SRC } from "./lib/glassBackgrounds";
import {
  checkForUpdate,
  emitCaptureAck,
  emitThemeSet,
  isTauri,
  onCaptureSave,
  onCorpusChanged,
  onQuickSet,
  onRebind,
  onThemeSet,
  setDockVisible,
  setHideOnBlur,
} from "./lib/tauri";
import { activeInstance, isWritable } from "./memex/config";
import {
  captureToInbox,
  chooseFolder,
  initMemexAsCorpus,
  loadConfig as memexLoadConfig,
} from "./memex/service";
import { flushSettingsNow } from "./state/persist";
import { useMemexStore } from "./state/memex";
import { DEST } from "./services/destinations";
import { invalidateFolders, invalidateNotes } from "./services/hooks";
import { notesService } from "./services/notes";
import { activeTabOf, leaves, usePanesStore } from "./state/panes";
import { applyQuickState } from "./state/quick";
import { applyTheme } from "./state/theme";
import {
  type GlassBackground,
  type GlassBlur,
  type GlassCanvas,
  type GlassClarity,
  type GlassTint,
  useUiStore,
} from "./state/ui";

registerDefaultActions();

if (import.meta.env.DEV) {
  // Review automation can drive any registry action: __rotli.dispatch("palette.toggle")
  (window as Window & { __rotli?: { dispatch: (actionId: string) => void } }).__rotli = {
    dispatch,
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

function MainShell() {
  const settingsOpen = useUiStore((s) => s.settingsOpen);
  const memoryOpen = useUiStore((s) => s.memoryOpen);
  const paletteOpen = useUiStore((s) => s.paletteOpen);
  const setPaletteOpen = useUiStore((s) => s.setPaletteOpen);
  const focusMode = useUiStore((s) => s.focusMode);
  const onboarded = useUiStore((s) => s.onboarded);
  const setOnboarded = useUiStore((s) => s.setOnboarded);
  // first run (the real app only — the browser/dev demo never onboards)
  const showOnboarding = isTauri() && !onboarded;

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
  // Settings → Memory → "Send quick captures to the brain inbox" reroutes ⌥C to
  // the active writable memex's inbox.md instead (no Board card). The brain path
  // resolves the active instance imperatively each time (it's not in a store yet
  // here), and falls back to the Board on ANY failure — a capture must never be
  // lost. The card clears ONLY when we ack, so we ack ONLY on a confirmed save —
  // on total failure the draft stays put for the next summon.
  useEffect(
    () =>
      onCaptureSave(({ id, body, open }) => {
        const toBoard = async () => {
          await notesService.createNote(DEST.board, body);
          await invalidateNotes();
          if (open) useUiStore.getState().setContentView("board");
        };
        void (async () => {
          let saved = false;
          try {
            // Quick capture has ONE default home (not a user setting): the active
            // brain's inbox.md when there's a writable brain, else the Board.
            const cfg = await memexLoadConfig();
            const inst = activeInstance(cfg);
            if (inst && isWritable(inst)) {
              // routed to inbox — there's no board note to open, so ⌘Enter
              // just lands the capture; nothing to surface
              await captureToInbox(inst, body);
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
      }),
    [],
  );

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
        panes.length === 1 &&
        !!onlyTab &&
        onlyTab.surfaceKind === "note" &&
        onlyTab.noteId === "";
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
        <Onboarding
          onDone={() => {
            setOnboarded(true);
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
            if (choice?.path && (choice.kind === "use" || choice.kind === "init")) {
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
      </div>
    );
  }

  return (
    <div className="app-window">
      <Titlebar />
      <main className="app-content">
        {/* Settings + Memory are still full-surface fronts. Chat is NOT anymore —
            it folded into the left-menu Chat section and renders inside
            NotesSurface's content area (contentView "chat"), like Board and
            All-notes, so the three sections stay visible (Seth, 2026-06-26). */}
        {settingsOpen ? (
          <SettingsSurface />
        ) : memoryOpen ? (
          <MemorySurface />
        ) : (
          <NotesSurface />
        )}
      </main>
      {paletteOpen && <Palette onClose={() => setPaletteOpen(false)} />}
      {whichKey && <WhichKey onClose={() => setWhichKey(false)} />}
    </div>
  );
}

export default function App() {
  const theme = useUiStore((s) => s.theme);
  const themeFamily = useUiStore((s) => s.themeFamily);
  const matchLightFamily = useUiStore((s) => s.matchLightFamily);
  const matchDarkFamily = useUiStore((s) => s.matchDarkFamily);
  const glassMode = useUiStore((s) => s.glassMode);
  const glassTint = useUiStore((s) => s.glassTint);
  const glassCanvas = useUiStore((s) => s.glassCanvas);
  const glassBackground = useUiStore((s) => s.glassBackground);
  const customBackground = useUiStore((s) => s.customBackground);
  const surface = surfaceFromUrl();

  useEffect(
    () =>
      applyTheme(theme, themeFamily, glassMode, glassTint, {
        light: matchLightFamily,
        dark: matchDarkFamily,
      }),
    [theme, themeFamily, glassMode, glassTint, matchLightFamily, matchDarkFamily],
  );
  useEffect(() => {
    document.documentElement.dataset.glassCanvas = glassCanvas;
  }, [glassCanvas]);
  const glassClarity = useUiStore((s) => s.glassClarity);
  const glassBlur = useUiStore((s) => s.glassBlur);
  useEffect(() => {
    document.documentElement.dataset.glassClarity = glassClarity;
    document.documentElement.dataset.glassBlur = glassBlur;
  }, [glassClarity, glassBlur]);

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
      glassMode,
      glassTint,
      glassBackground,
      glassClarity,
      glassBlur,
      glassCanvas,
      customBackground,
    });
  }, [
    surface,
    theme,
    themeFamily,
    matchLightFamily,
    matchDarkFamily,
    glassMode,
    glassTint,
    glassBackground,
    glassClarity,
    glassBlur,
    glassCanvas,
    customBackground,
  ]);
  useEffect(() => {
    if (surface === "main") return;
    return onThemeSet((p) =>
      useUiStore.setState({
        theme: p.theme,
        themeFamily: p.themeFamily,
        matchLightFamily: p.matchLightFamily,
        matchDarkFamily: p.matchDarkFamily,
        glassMode: p.glassMode,
        glassTint: p.glassTint as GlassTint,
        glassBackground: p.glassBackground as GlassBackground,
        glassClarity: p.glassClarity as GlassClarity,
        glassBlur: p.glassBlur as GlassBlur,
        glassCanvas: p.glassCanvas as GlassCanvas,
        customBackground: p.customBackground,
      }),
    );
  }, [surface]);
  useEffect(() => {
    const root = document.documentElement;
    const src =
      glassBackground === "custom"
        ? customBackground
        : glassBackground === "field"
          ? null
          : GLASS_BG_SRC[glassBackground];
    if (!glassMode || !src) {
      root.dataset.glassBg = "field";
      root.style.removeProperty("--glass-wallpaper");
      return;
    }
    root.dataset.glassBg = "image";
    root.style.setProperty("--glass-wallpaper", `url("${src}")`);
  }, [glassMode, glassBackground, customBackground]);

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

  if (surface === "capture") return <CaptureCard />;
  if (surface === "quick") return <QuickNote />;
  return <MainShell />;
}
