import { QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import ReactDOM from "react-dom/client";

import App from "./app";
import { PLATFORM } from "./lib/featurePolicy";
import { attachIdleMotion } from "./lib/idleMotion";
import { hydrateWebVault } from "./services/notes";
import { queryClient } from "./services/query";
import { attachPersistence, hydratePersistedState, runDeferredMaintenance } from "./state/persist";

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
  // Rotli Web lays its chrome out for a browser tab (no traffic lights, no
  // window drag); the stylesheet keys off this before the first paint.
  document.documentElement.dataset.platform = PLATFORM;
  await hydrateWebVault(); // Rotli Web: connect the bound vault, or leave setup to show; a no-op elsewhere
  await hydratePersistedState(); // no-op in a plain browser; never throws
  ReactDOM.createRoot(rootEl).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </React.StrictMode>,
  );
  attachPersistence(); // the one debounced writer (main window + Tauri only)
  attachIdleMotion(); // a tucked-away window stops animating (every window has one)
  // Orphan-map GC runs every launch but NOT before paint — kick it once the
  // browser is idle after the first render (perf audit 2026-08). It self-guards
  // to the main surface + hydrated Main, so a stray early call is a safe no-op.
  const kickMaintenance = () => void runDeferredMaintenance();
  if (typeof requestIdleCallback === "function") requestIdleCallback(kickMaintenance);
  else setTimeout(kickMaintenance, 0);
}

void bootstrap(root);
