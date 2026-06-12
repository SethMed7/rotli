import { useEffect } from "react";
import "./styles/base.css";
import "./styles/app.css";
import "./styles/notes.css";
import "./styles/editor.css";
import "./styles/command.css";
import { CaptureCard } from "./components/CaptureCard";
import { NotesSurface } from "./components/NotesSurface";
import { Palette } from "./components/Palette";
import { SettingsSurface } from "./components/SettingsSurface";
import { Titlebar } from "./components/Titlebar";
import { registerDefaultActions } from "./keys/actions";
import { type Surface, applyRebind, attachDispatcher, dispatch } from "./keys/registry";
import { GLASS_BG_SRC } from "./lib/glassBackgrounds";
import { emitCaptureAck, isTauri, onCaptureSave, onCorpusChanged, onRebind } from "./lib/tauri";
import { invalidateFolders, invalidateNotes } from "./services/hooks";
import { inboxFolderId, notesService } from "./services/notes";
import { activeTabOf, leaves, usePanesStore } from "./state/panes";
import { applyTheme } from "./state/theme";
import { useUiStore } from "./state/ui";

registerDefaultActions();

if (import.meta.env.DEV) {
  // Review automation can drive any registry action: __rotli.dispatch("palette.toggle")
  (window as Window & { __rotli?: { dispatch: (actionId: string) => void } }).__rotli = {
    dispatch,
  };
}

/** Which surface this webview shows. Default = the main window;
 *  `?window=capture` = the quick-capture card. */
function surfaceFromUrl(): Surface {
  const param = new URLSearchParams(window.location.search).get("window");
  return param === "capture" ? "capture" : "main";
}

function MainShell() {
  const settingsOpen = useUiStore((s) => s.settingsOpen);
  const paletteOpen = useUiStore((s) => s.paletteOpen);
  const setPaletteOpen = useUiStore((s) => s.setPaletteOpen);
  const focusMode = useUiStore((s) => s.focusMode);

  // focus mode is window-wide: chrome everywhere reacts to one attribute
  useEffect(() => {
    if (focusMode) document.documentElement.dataset.focus = "true";
    else delete document.documentElement.dataset.focus;
  }, [focusMode]);

  // the capture card lives in another webview; this window owns the corpus —
  // it saves the capture into Inbox (a real .md on disk in fs mode), (on
  // save & open) makes it the active tab, and acks so the card may clear
  useEffect(
    () =>
      onCaptureSave(({ id, body, open }) => {
        void notesService.createNote(inboxFolderId, body).then(async (note) => {
          await invalidateNotes();
          if (open) usePanesStore.getState().openNote(note.id);
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

  return (
    <div className="app-window">
      <Titlebar />
      <main className="app-content">{settingsOpen ? <SettingsSurface /> : <NotesSurface />}</main>
      {paletteOpen && <Palette onClose={() => setPaletteOpen(false)} />}
    </div>
  );
}

export default function App() {
  const theme = useUiStore((s) => s.theme);
  const themeFamily = useUiStore((s) => s.themeFamily);
  const glassMode = useUiStore((s) => s.glassMode);
  const glassTint = useUiStore((s) => s.glassTint);
  const glassCanvas = useUiStore((s) => s.glassCanvas);
  const glassBackground = useUiStore((s) => s.glassBackground);
  const customBackground = useUiStore((s) => s.customBackground);
  const surface = surfaceFromUrl();

  useEffect(
    () => applyTheme(theme, themeFamily, glassMode, glassTint),
    [theme, themeFamily, glassMode, glassTint],
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

  return surface === "capture" ? <CaptureCard /> : <MainShell />;
}
