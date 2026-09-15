// Settings → Connections: web research (explicit provider choice) plus the
// agent integrations. Those integrations ship in development builds only
// (feature policy `agents`); stable builds list them as coming soon. The
// Keychain-bound Brave key row is supplied by settingsSurface, which owns the
// native adapter imports.
import { type ReactNode, useEffect, useRef, useState } from "react";

import { WEB_SEARCH_PROVIDERS, webSearchProviderInfo } from "../../ai/searchProvider";
import { COMING_SOON_CAPTION } from "../../lib/featurePolicy";
import { useUiStore } from "../../state/ui";
import { CheckGlyph, CopyGlyph } from "../glyphs";
import { RemoteAgentsSection } from "../remoteAgentsSection";

/** The prompt you paste into Claude Code so a project's docs live in your Rotli
 * vault instead of the repo — planning + documentation you organize in rotli,
 * the README the only thing that stays in the repo. Copy-first; you refine the
 * wording to taste (the maintainer, 2026-07-07). */
const CLAUDE_DOCS_COMMAND = `When you create or update documentation for this project, keep it in my Rotli
vault — NOT this repo. The README is the ONLY doc that stays in the repo.

• Before writing a new doc, ask me: "rotli or repo?" (the README always → repo).
• When a doc goes to rotli, write the Markdown file into my rotli notes folder
  under wiki/_inbox/<slug>.md with frontmatter:
      ---
      owner: rotli
      shelf: [<Project>]     # this project's name, e.g. Rotli
      ---
  rotli files it, and I keep it under my <Project> folder in Main.
• Do not create or leave project docs in this repo's docs/ folder.`;

/** Named connections a stable build withholds, in the provider list grammar. */
export const COMING_SOON_CONNECTIONS = [
  { id: "grokbot", label: "Grok Bot plug-in", detail: "Connect Rotli to Grok Bot" },
  { id: "mcp", label: "MCP", detail: "Let outside agents read and write this vault over MCP" },
] as const;

function WebResearchSection({ braveKeyRow }: { braveKeyRow: ReactNode }) {
  const provider = useUiStore((state) => state.webSearchProvider);
  const setProvider = useUiStore((state) => state.setWebSearchProvider);
  const selected = webSearchProviderInfo(provider);

  return (
    <section className="aisection">
      <h4 className="set-subhead">Web research</h4>
      <p className="setnote">
        The globe turns web access on for a chat. This setting picks where its searches go.
      </p>
      <fieldset className="websearch-options">
        <legend className="websearch-legend">Search provider</legend>
        {WEB_SEARCH_PROVIDERS.map((option) => (
          <label
            className={option.id === provider ? "websearch-option selected" : "websearch-option"}
            key={option.id}
          >
            <input
              type="radio"
              name="web-search-provider"
              value={option.id}
              checked={option.id === provider}
              onChange={() => setProvider(option.id)}
            />
            <span className="websearch-optioncopy">
              <span className="websearch-optionname">{option.label}</span>
              <span className="websearch-optiondetail">{option.detail}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {selected.needsKey && braveKeyRow}
      <p className="setnote websearch-privacy">
        Searches go straight from this Mac to <b>{selected.label}</b>, and Rotli reads the result pages it
        cites. Their privacy terms apply. Rotli never ships a shared key and never switches providers after a
        failure.
      </p>
      {!selected.needsKey && (
        <p className="setnote websearch-availability">
          No account needed. DuckDuckGo&rsquo;s result pages can change or go down; Rotli tells you when that
          happens.
        </p>
      )}
    </section>
  );
}

function ComingSoonConnections() {
  return (
    <section className="aisection">
      <h4 className="set-subhead">Coming soon</h4>
      <p className="set-soon">{COMING_SOON_CAPTION}</p>
      <ul className="websearch-options connections-soon">
        {COMING_SOON_CONNECTIONS.map((row) => (
          <li className="websearch-option is-soon" aria-disabled="true" key={row.id}>
            <span className="websearch-optioncopy">
              <span className="websearch-optionname">{row.label}</span>
              <span className="websearch-optiondetail">{row.detail}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The prompt that keeps a project's docs in Rotli — an agent extension. */
function ClaudeDocsExtension() {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const copyReset = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (copyReset.current !== null) window.clearTimeout(copyReset.current);
    },
    [],
  );

  const copy = async () => {
    if (copyReset.current !== null) window.clearTimeout(copyReset.current);
    try {
      if (!navigator.clipboard) throw new Error("Clipboard access is unavailable");
      await navigator.clipboard.writeText(CLAUDE_DOCS_COMMAND);
      setCopyState("copied");
      copyReset.current = window.setTimeout(() => setCopyState("idle"), 1800);
    } catch {
      setCopyState("failed");
    }
  };
  return (
    <section className="aisection">
      <h4 className="set-subhead">Extensions</h4>
      <p className="setnote">
        Extend rotli&rsquo;s corpus workflows without giving another service ownership of your notes.
      </p>
      <div className="claudecmd">
        <div className="claudecmd-intro">
          <h4>Use rotli for your docs</h4>
          <p className="plugdesc">
            Paste this into Claude Code in any project and your planning + docs land in rotli instead of the
            repo — everything but the README.
          </p>
        </div>
        <div className="claudecmd-shell">
          <div className="claudecmd-toolbar">
            <span>Claude Code instruction</span>
            <button
              type="button"
              className={`claudecmd-copy ${copyState}`}
              onClick={() => void copy()}
              aria-label={
                copyState === "copied" ? "Copied Claude Code instruction" : "Copy Claude Code instruction"
              }
            >
              {copyState === "copied" ? <CheckGlyph size={13} /> : <CopyGlyph size={13} />}
              <span>{copyState === "copied" ? "Copied" : copyState === "failed" ? "Try again" : "Copy"}</span>
            </button>
          </div>
          <pre className="claudecmd-block">{CLAUDE_DOCS_COMMAND}</pre>
        </div>
        <span className={`claudecmd-status ${copyState === "failed" ? "failed" : ""}`} aria-live="polite">
          {copyState === "failed" ? "Rotli couldn’t access the clipboard. Try copying again." : ""}
        </span>
      </div>
    </section>
  );
}

export function ConnectionsSettings({ agents, braveKeyRow }: { agents: boolean; braveKeyRow: ReactNode }) {
  return (
    <>
      <p className="lead">
        Choose the outside services Rotli can contact. Each connection is explicit and never changes
        destination after a failure.
      </p>
      <WebResearchSection braveKeyRow={braveKeyRow} />
      {agents ? (
        <>
          <RemoteAgentsSection />
          <ClaudeDocsExtension />
        </>
      ) : (
        <ComingSoonConnections />
      )}
    </>
  );
}
