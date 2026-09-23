import { expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import { NewItemSurface, newItemCards } from "./newItemSurface";

test("withheld kinds keep their slot but lose their digit, in both channels", () => {
  const stable = newItemCards({ documents: true, sheets: false, mermaidDiagrams: false });
  expect(stable.map((card) => [card.digit, card.kind, card.comingSoon])).toEqual([
    ["3", "markdown", false],
    ["4", "document", false],
    ["5", "sheet", true],
    ["6", "board", false],
    ["7", "mermaid", true],
  ]);
  expect(
    newItemCards({ documents: true, sheets: true, mermaidDiagrams: true }).some((card) => card.comingSoon),
  ).toBe(false);
  const web = newItemCards({ documents: false, sheets: false, mermaidDiagrams: false });
  expect(web.find((card) => card.kind === "document")).toMatchObject({ digit: "4", comingSoon: true });
  expect(web.find((card) => card.kind === "board")).toMatchObject({ digit: "6", comingSoon: false });
});

test("the stable chooser renders Sheet and Mermaid diagram as disabled coming-soon cards", () => {
  // bun test compiles as the stable channel
  const markup = renderToStaticMarkup(<NewItemSurface paneId="p" tabId="t" />);
  const soon = markup.match(/<button[^>]*ni-card-soon[^>]*>/g) ?? [];
  expect(soon.length).toBe(2);
  expect(soon.every((button) => button.includes('aria-disabled="true"'))).toBe(true);
  expect(markup.includes("New Sheet — Coming soon — not in this release yet")).toBe(true);
  expect(markup.includes("New Mermaid diagram — Coming soon")).toBe(true);
  expect(markup.includes("New Board (press 6)")).toBe(true);
  expect(markup.includes("press 5")).toBe(false);
});
