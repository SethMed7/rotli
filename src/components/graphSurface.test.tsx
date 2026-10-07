import { expect, test } from "bun:test";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";

import { GraphCanvas } from "./graph/graphCanvas";
import { GraphSurface } from "./graphSurface";

test("the Graph view opens with a way back, a note search, and a loading state — no extra chrome", () => {
  const markup = renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <GraphSurface />
    </QueryClientProvider>,
  );
  expect(markup).toContain("Back to notes");
  expect(markup).toContain(">Graph</h2>");
  expect(markup).toContain('aria-label="Find a note"');
  expect(markup).toContain("Loading…");
  // the whole-vault scope shows no scope controls
  expect(markup).not.toContain("graph-scope");
});

test("the canvas is one keyboard stop that says how to move through it", () => {
  const markup = renderToStaticMarkup(
    <GraphCanvas
      graph={{ nodes: [{ id: "a", title: "A", secure: false, degree: 0 }], edges: [] }}
      center={null}
      matched={new Set()}
      onOpen={() => {}}
      onCenter={() => {}}
    />,
  );
  expect(markup).toContain('tabindex="0"');
  expect(markup).toContain("Graph of 1 notes and 0 links. Arrow keys move between notes");
  expect(markup).toContain('aria-live="polite"');
});
