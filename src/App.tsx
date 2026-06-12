import { useEffect } from "react";
import "./styles/base.css";
import "./styles/app.css";
import "./styles/notes.css";
import "./styles/editor.css";
import { NotesSurface } from "./components/NotesSurface";
import { Titlebar } from "./components/Titlebar";
import { registerDefaultActions } from "./keys/actions";
import { attachDispatcher, dispatch } from "./keys/registry";
import { applyTheme } from "./state/theme";
import { useUiStore } from "./state/ui";

registerDefaultActions();

if (import.meta.env.DEV) {
  // Review automation can drive any registry action: __rotli.dispatch("app.hide")
  (window as Window & { __rotli?: { dispatch: (actionId: string) => void } }).__rotli = {
    dispatch,
  };
}

/** Which surface this webview shows. Default = the main window;
 *  `?window=capture` = the quick-capture card (built in 1c). */
type Surface = "main" | "capture";

function surfaceFromUrl(): Surface {
  const param = new URLSearchParams(window.location.search).get("window");
  return param === "capture" ? "capture" : "main";
}

function MainShell() {
  return (
    <div className="app-window">
      <Titlebar />
      <main className="app-content">
        <NotesSurface />
      </main>
    </div>
  );
}

function CaptureShell() {
  return (
    <main className="shell shell-capture">
      <p className="shell-title">rotli</p>
      <p className="shell-hint">quick capture — arrives in 1c</p>
    </main>
  );
}

export default function App() {
  const theme = useUiStore((s) => s.theme);
  const surface = surfaceFromUrl();

  useEffect(() => applyTheme(theme), [theme]);

  useEffect(() => {
    document.body.dataset.surface = surface;
  }, [surface]);

  useEffect(() => {
    if (surface !== "main") return;
    return attachDispatcher();
  }, [surface]);

  return surface === "capture" ? <CaptureShell /> : <MainShell />;
}
