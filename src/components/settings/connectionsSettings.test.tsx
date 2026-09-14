import { expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import { COMING_SOON_CAPTION } from "../../lib/featurePolicy";
import { COMING_SOON_CONNECTIONS, ConnectionsSettings } from "./connectionsSettings";

test("a stable build lists Grokbot and MCP as inert coming-soon rows beside web research", () => {
  const markup = renderToStaticMarkup(<ConnectionsSettings agents={false} braveKeyRow={null} />);
  expect(COMING_SOON_CONNECTIONS.map((row) => [row.label, row.detail])).toEqual([
    ["Grokbot plug-in", "Connect Rotli to Grokbot"],
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
