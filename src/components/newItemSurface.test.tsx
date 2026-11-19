import { expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import { NewItemSurface, newItemCards } from "./newItemSurface";

test("withheld kinds keep their slot but lose their digit, in both channels", () => {
  const stable = newItemCards({ documents: true, sheets: false, mermaidDiagrams: false, jsonCanvas: false });
  expect(stable.map((card) => [card.digit, card.kind, card.comingSoon])).toEqual([
    ["3", "markdown", false],
    ["4", "document", false],
    ["5", "sheet", true],
    ["6", "board", false],
    ["7", "mermaid", true],
    ["8", "canvas", true],
  ]);
  expect(
    newItemCards({ documents: true, sheets: true, mermaidDiagrams: true, jsonCanvas: true }).some(
      (card) => card.comingSoon,
    ),
  ).toBe(false);
  const web = newItemCards({ documents: false, sheets: false, mermaidDiagrams: false, jsonCanvas: false });
  expect(web.find((card) => card.kind === "document")).toMatchObject({ digit: "4", comingSoon: true });
  expect(web.find((card) => card.kind === "board")).toMatchObject({ digit: "6", comingSoon: false });
});

test("the stable chooser offers Sheet and Document as Beta, and Mermaid diagram and Canvas as coming soon", () => {
  // bun test compiles as the stable channel
  const markup = renderToStaticMarkup(<NewItemSurface paneId="p" tabId="t" />);
  const soon = markup.match(/<button[^>]*ni-card-soon[^>]*>/g) ?? [];
  expect(soon.length).toBe(2);
  expect(soon.every((button) => button.includes('aria-disabled="true"'))).toBe(true);
  expect(markup).toMatch(/aria-label="New Mermaid diagram [^"]+ Coming soon[^"]*"/);
  expect(markup).toMatch(/aria-label="New Canvas [^"]+ Coming soon[^"]*"/);
  expect(markup).toMatch(/aria-label="New Sheet Beta [^"]+ 5"/);
  expect(markup).toMatch(/aria-label="New Document Beta [^"]+ 4"/);
  expect(markup).toMatch(/aria-label="New Board [^"]+ 6"/);
  // one Beta mark per Beta card, none on Markdown, Board, or a coming-soon card
  expect(markup.match(/class="beta-badge"/g)?.length).toBe(2);
});
