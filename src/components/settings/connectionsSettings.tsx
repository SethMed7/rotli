// Settings → Connections: web research (explicit provider choice) plus the
// agent integrations. Those integrations ship in development builds only
// (feature policy `agents`); stable builds list them as coming soon. The
// Keychain-bound Brave key row is supplied by settingsSurface, which owns the
// native adapter imports.
import type { ReactNode } from "react";

import { WEB_SEARCH_PROVIDERS, webSearchProviderInfo } from "../../ai/searchProvider";
import { connectionsLead, productName } from "../../host/registry";
import { COMING_SOON_CAPTION } from "../../lib/featurePolicy";
import { useUiStore } from "../../state/ui";
import { CheckGlyph, CopyGlyph } from "../glyphs";
import { RemoteAgentsSection } from "../remoteAgentsSection";
import { NotesSectionTag } from "./hostBlocks";
import { useCopyState } from "./useCopyState";

/** The prompt you paste into Claude Code so a project's docs live in your Rotli
 * vault instead of the repo — planning + documentation you organize in rotli,
 * the README the only thing that stays in the repo. Copy-first; you refine the
 * wording to taste (the maintainer, 2026-07-07). */
export const CLAUDE_DOCS_COMMAND = `When you create or update documentation for this project, keep it in my Rotli
vault — NOT this repo. The README is the ONLY doc that stays in the repo.

• Before writing a new doc, ask me: "rotli or repo?" (the README always → repo).
• When a doc goes to rotli, never write a file into the vault yourself and never
  write frontmatter (rotli owns it). Write the Markdown body to a temp file, then run:
      /Applications/Rotli.app/Contents/MacOS/rotli notes create --title "<title>" \\
        --body-file <temp file> --main main:<Project>
  <Project> is this project's name, e.g. Rotli. If that Main folder doesn't exist
  yet, make it first with the same binary: folders create --name <Project>. rotli files the note
  and I keep it under my <Project> folder in Main.
• Do not create or leave project docs in this repo's docs/ folder.`;

/** Named connections a stable build withholds, in the provider list grammar. */
export const comingSoonConnections = (name = productName()) => [
  { id: "grokbot", label: "Grok Bot plug-in", detail: `Connect ${name} to Grok Bot` },
  { id: "mcp", label: "MCP", detail: "Let outside agents read and write this vault over MCP" },
];

function WebResearchSection({ braveKeyRow }: { braveKeyRow: ReactNode }) {
  const provider = useUiStore((state) => state.webSearchProvider);
  const setProvider = useUiStore((state) => state.setWebSearchProvider);
  const selected = webSearchProviderInfo(provider);

  return (
    <section className="aisection">
      <h4 className="set-subhead">
        Web research
        <NotesSectionTag />
      </h4>
      <p className="setnote">
        Connected models always have web access; for the on-device model, the globe turns it on for a chat.
        This setting picks where searches go.
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
        Searches go straight from this Mac to <b>{selected.label}</b>
        {`, and ${productName()} reads the result pages it cites. Their privacy terms apply. ${productName()} never ships a shared key and never switches providers after a failure.`}
      </p>
      {!selected.needsKey && (
        <p className="setnote websearch-availability">
          {`No account needed. DuckDuckGo’s result pages can change or go down; ${productName()} tells you when that happens.`}
        </p>
      )}
    </section>
  );
}

function ComingSoonConnections() {
  return (
    <section className="aisection">
      <h4 className="set-subhead">
        Coming soon
        <NotesSectionTag />
      </h4>
      <p className="set-soon">{COMING_SOON_CAPTION}</p>
      <ul className="websearch-options connections-soon">
        {comingSoonConnections().map((row) => (
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
  const { copyState, copy } = useCopyState();
  return (
    <section className="aisection">
      <h4 className="set-subhead">
        Extensions
        <NotesSectionTag />
      </h4>
      <p className="setnote">
        {`Extend ${productName()}’s corpus workflows without giving another service ownership of your notes.`}
      </p>
      <div className="claudecmd">
        <div className="claudecmd-intro">
          <h4>Use Rotli for your docs</h4>
          <p className="plugdesc">
            Paste this into Claude Code in any project and your planning + docs land in Rotli instead of the
            repo — everything but the README.
          </p>
        </div>
        <div className="claudecmd-shell">
          <div className="claudecmd-toolbar">
            <span>Claude Code instruction</span>
            <button
              type="button"
              className={`claudecmd-copy ${copyState}`}
              onClick={() => void copy(CLAUDE_DOCS_COMMAND)}
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
          {copyState === "failed" ? `${productName()} couldn’t access the clipboard. Try copying again.` : ""}
        </span>
      </div>
    </section>
  );
}

export function ConnectionsSettings({ agents, braveKeyRow }: { agents: boolean; braveKeyRow: ReactNode }) {
  const lead = connectionsLead();
  return (
    <>
      {lead && <p className="lead">{lead}</p>}
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
