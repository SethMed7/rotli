/** Build-time launch policy. Experimental editing stays in development builds;
 * neither a URL parameter nor persisted preferences can enable it in production.
 * `agents` covers the MCP server, the agent-integration commands, the remote
 * relay, and their Settings surface: out of production until refined. The
 * plain JSON CLI is not gated. */
export function launchFeatures(development: boolean) {
  return {
    notes: true,
    chat: true,
    breve: development,
    mermaidVisualEditing: development,
    agents: development,
  } as const;
}

/** Only the build chooses the channel; settings and URLs cannot override it. */
export const LAUNCH_FEATURES = launchFeatures(
  typeof __ROTLI_BUILD_CHANNEL__ !== "undefined" && __ROTLI_BUILD_CHANNEL__ === "dev",
);
