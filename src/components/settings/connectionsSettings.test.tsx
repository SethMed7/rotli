import { expect, test } from "bun:test";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";

import { COMING_SOON_CAPTION } from "../../lib/featurePolicy";
import { CLAUDE_DOCS_COMMAND, COMING_SOON_CONNECTIONS, ConnectionsSettings } from "./connectionsSettings";

test("a stable build lists Grok Bot and MCP as inert coming-soon rows beside web research", () => {
  const markup = renderToStaticMarkup(<ConnectionsSettings agents={false} braveKeyRow={null} />);
  expect(COMING_SOON_CONNECTIONS.map((row) => [row.label, row.detail])).toEqual([
    ["Grok Bot plug-in", "Connect Rotli to Grok Bot"],
    ["MCP", "Let outside agents read and write this vault over MCP"],
  ]);
  const rows = markup.match(/<li class="websearch-option is-soon"[^>]*>/g) ?? [];
  expect(rows.length).toBe(2);
  expect(rows.every((row) => row.includes('aria-disabled="true"'))).toBe(true);
  // the only radios are the two search providers
  expect((markup.match(/type="radio"/g) ?? []).length).toBe(2);
  expect(markup.includes(COMING_SOON_CAPTION)).toBe(true);
  expect(markup.includes("Remote agents") || markup.includes("Extensions")).toBe(false);
});

test("with no host, Rotli's lead and untagged section headings; agent sections only with agents", () => {
  const headings = (agents: boolean) => {
    const markup = renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>
        <ConnectionsSettings agents={agents} braveKeyRow={null} />
      </QueryClientProvider>,
    );
    expect(markup).toStartWith(
      '<p class="lead">Choose the outside services Rotli can contact. Each connection is explicit and never changes destination after a failure.</p>',
    );
    return [...markup.matchAll(/<h4 class="set-subhead"[^>]*>(.*?)<\/h4>/g)].map((match) => match[1]);
  };
  expect(headings(false)).toEqual(["Web research", "Coming soon"]);
  expect(headings(true)).toEqual(["Web research", "Remote agents", "Extensions"]);
});

test("web research copy keeps its privacy facts", () => {
  const markup = renderToStaticMarkup(<ConnectionsSettings agents={false} braveKeyRow={null} />);
  for (const fact of [
    "straight from this Mac to <b>",
    "Their privacy terms apply",
    "never ships a shared key",
    "never switches providers after a failure",
  ])
    expect(markup.includes(fact)).toBe(true);
});

test("the docs extension files notes through `rotli notes create`, never raw frontmatter", () => {
  expect(CLAUDE_DOCS_COMMAND).toContain("rotli notes create");
  expect(CLAUDE_DOCS_COMMAND).toContain("--body-file");
  // Rotli owns frontmatter: an agent never writes it, and the CLI refuses a body that holds it
  expect(CLAUDE_DOCS_COMMAND).not.toContain("owner: rotli");
  expect(CLAUDE_DOCS_COMMAND).not.toContain("shelf:");
  expect(CLAUDE_DOCS_COMMAND).not.toContain("wiki/_inbox");
  expect(CLAUDE_DOCS_COMMAND).not.toContain("---");
});
