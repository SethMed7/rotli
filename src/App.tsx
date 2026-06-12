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
import { onCaptureSave, onRebind } from "./lib/tauri";
import { invalidateNotes } from "./services/hooks";
import { inboxFolder, notesService } from "./services/notes";
import { usePanesStore } from "./state/panes";
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
  // it saves the capture into Inbox and (on save & open) makes it the active tab
  useEffect(
    () =>
      onCaptureSave(({ body, open }) => {
        void notesService.createNote(inboxFolder.id, body).then(async (note) => {
          await invalidateNotes();
          if (open) usePanesStore.getState().openNote(note.id);
        });
      }),
    [],
  );

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
  const glassTint = useUiStore((s) => s.glassTint);
  const surface = surfaceFromUrl();

  useEffect(() => applyTheme(theme, themeFamily, glassTint), [theme, themeFamily, glassTint]);

  useEffect(() => {
    document.body.dataset.surface = surface;
  }, [surface]);

  // one dispatcher per webview, scoped to its surface
  useEffect(() => attachDispatcher(surface), [surface]);

  // rebinds made in the other webview land here too (one keymap, two webviews)
  useEffect(() => onRebind(({ actionId, chord }) => applyRebind(actionId, chord)), []);

  return surface === "capture" ? <CaptureCard /> : <MainShell />;
}
