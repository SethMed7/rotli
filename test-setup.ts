// Test preload (configured in bunfig.toml). Frontend modules read browser
// globals at import time — notes.ts runs `isTauri()` (touches `window`), and
// editor/model.ts registers pagehide/blur/visibilitychange listeners. This
// installs the smallest possible stand-ins so those modules import under
// `bun test` and pick their non-Tauri (in-memory) branch. No real DOM, no jsdom.
//
// Lives at the repo root (outside `src/`) so it is never part of the app build
// or the app typecheck — it exists only for the test runner.

const g = globalThis as unknown as { window?: unknown; document?: unknown };

if (!g.window) {
  g.window = {
    // notes.ts: SEED_EMPTY reads window.location.search; "" → no ?empty
    location: { search: "" },
    // editor/model.ts: pagehide / blur listener registration
    addEventListener: () => {},
    removeEventListener: () => {},
    // isTauri() checks "__TAURI_INTERNALS__" in window → absent → in-memory mode
  };
}

if (!g.document) {
  g.document = {
    // editor/model.ts: visibilitychange listener + document.hidden read
    addEventListener: () => {},
    removeEventListener: () => {},
    hidden: false,
  };
}
