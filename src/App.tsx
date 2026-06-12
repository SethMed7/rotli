import "./styles/base.css";

/** Which surface this webview shows. Default = the main window;
 *  `?window=capture` = the quick-capture card. Later phases replace both shells. */
type Surface = "main" | "capture";

function surfaceFromUrl(): Surface {
  const param = new URLSearchParams(window.location.search).get("window");
  return param === "capture" ? "capture" : "main";
}

function MainShell() {
  return (
    <main className="shell shell-main">
      <p className="shell-title">rotli</p>
      <p className="shell-hint">main window — placeholder shell (scaffold)</p>
    </main>
  );
}

function CaptureShell() {
  return (
    <main className="shell shell-capture">
      <p className="shell-title">rotli</p>
      <p className="shell-hint">quick capture — placeholder shell (scaffold)</p>
    </main>
  );
}

export default function App() {
  return surfaceFromUrl() === "capture" ? <CaptureShell /> : <MainShell />;
}
