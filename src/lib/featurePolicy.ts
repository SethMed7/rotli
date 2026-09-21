/** Build-time launch policy. Experimental editing stays in development builds;
 * neither a URL parameter nor persisted preferences can enable it in production.
 * `agents` covers the MCP server, the agent-integration commands, the remote
 * relay, and their Settings surface: out of production until refined. The
 * plain JSON CLI is not gated. `sheets` covers XLSX workbooks (CSV editing stays
 * public), `mermaidDiagrams` the Mermaid-diagram item kind (a ```mermaid fence
 * in a note always renders), and `voice` read-aloud. */
export type Platform = "desktop" | "web";

/** Two build-time axes. `development` is the release channel. `platform` is
 * the shell: the Tauri desktop app owns a Rust corpus, model lanes, the
 * Librarian, Breve, agents, native windows, and disk browsers; Rotli Web
 * (served from the site, vault in the browser, `connect-src 'none'`) has
 * none of those and withholds every capability that needs them, whatever
 * the channel says. Neither a URL parameter nor a setting can widen either. */
export function launchFeatures(development: boolean, platform: Platform = "desktop") {
  const desktop = platform === "desktop";
  return {
    notes: true,
    chat: desktop,
    breve: desktop && development,
    mermaidVisualEditing: development,
    agents: desktop && development,
    sheets: desktop && development,
    mermaidDiagrams: development,
    voice: desktop && development,
    // Pull Chat out into its own window: on in every desktop build (the owner,
    // 2026-09-21: "should not be behind a feature flag — I need to test in UAT
    // before live"). The native half (a second shell webview, the quit
    // handshake) is proven in the Mac app, not CI; Rotli Web never gets it — a
    // second browser tab would be a second, uncoordinated writer.
    chatWindow: desktop,
  } as const;
}

/** The one caption for a capability a surface names but this build withholds. */
export const COMING_SOON_CAPTION = "Coming soon — not in this release yet";
/** Only the build chooses the shell; settings and URLs cannot override it. */
export const PLATFORM: Platform =
  typeof __ROTLI_PLATFORM__ !== "undefined" && __ROTLI_PLATFORM__ === "web" ? "web" : "desktop";

// Vite replaces this identifier at build time (vite.config.ts `define`). The
// module-local declaration keeps non-Vite typecheck lanes (scripts that import
// the AI loop) compiling without src/vite-env.d.ts.
declare const __ROTLI_BUILD_CHANNEL__: "stable" | "dev" | undefined;
declare const __ROTLI_PLATFORM__: "desktop" | "web" | undefined;

/** Only the build chooses the channel; settings and URLs cannot override it. */
export const LAUNCH_FEATURES = launchFeatures(
  typeof __ROTLI_BUILD_CHANNEL__ !== "undefined" && __ROTLI_BUILD_CHANNEL__ === "dev",
  PLATFORM,
);
