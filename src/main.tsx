import { QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import ReactDOM from "react-dom/client";

import App from "./app";
import { queryClient } from "./services/query";
import { attachPersistence, hydratePersistedState } from "./state/persist";

// Excalidraw otherwise fetches its fonts from a CDN (unpkg). For an offline
// desktop app (Tauri, no network) point its asset path at the app origin so it
// resolves the fonts copied into public/fonts -> /fonts. Set before any
// <Excalidraw/> mounts. Works for both `vite dev` (served from /) and the Tauri
// build (tauri://localhost root).
(window as unknown as { EXCALIDRAW_ASSET_PATH?: string }).EXCALIDRAW_ASSET_PATH = "/";

// Theme is owned by the ui store (explicit light/dark/system, default "light");
// index.html pins data-theme="light" so first paint is deterministic. In the
// Tauri shell, .rotli/settings.json is hydrated BEFORE the first render — the
// restored theme paints first, never a light flash. The browser skips it all.

const root = document.getElementById("root");
if (!root) throw new Error("missing #root element");

async function bootstrap(rootEl: HTMLElement): Promise<void> {
  await hydratePersistedState(); // no-op in a plain browser; never throws
  ReactDOM.createRoot(rootEl).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </React.StrictMode>,
  );
  attachPersistence(); // the one debounced writer (main window + Tauri only)
}

void bootstrap(root);
