import { useEffect, useState } from "react";
import "./styles/base.css";
import "./styles/app.css";
import "./styles/notes.css";
import "./styles/editor.css";
import "./styles/command.css";
import "./styles/quick.css";
import "./styles/onboarding.css";
import "./styles/board.css";
import { BoardSurface } from "./components/BoardSurface";
import { CaptureCard } from "./components/CaptureCard";
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
  const boardOpen = useUiStore((s) => s.boardOpen);
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
  useEffect(
    () =>
      onCaptureSave(({ id, body, open }) => {
        void notesService.createNote(DEST.board, body).then(async () => {
          await invalidateNotes();
          if (open) useUiStore.getState().setBoardOpen(true);
          emitCaptureAck(id);
        });
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
      const pristine =
        panes.length === 1 && only && only.tabs.length === 1 && activeTabOf(only).noteId === "";
      if (pristine) openNote(freshest.id);
    });
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
          }}
        />
      </div>
    );
  }

  return (
    <div className="app-window">
      <Titlebar />
      <main className="app-content">
        {boardOpen ? <BoardSurface /> : settingsOpen ? <SettingsSurface /> : <NotesSurface />}
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
