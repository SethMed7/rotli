import { expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import { besideSidebar, PersonSinksCard, POPOUT_MS } from "./personSinksPopout";

const viewport = { width: 1200, height: 800 };
const card = { width: 300, height: 160 };

test("the callout pops out of the sidebar, level with the row it points at", () => {
  const archiveRow = { left: 16, top: 600, width: 260, height: 32 };
  const placed = besideSidebar(archiveRow, 300, viewport, card);
  expect(placed.left).toBe(312); // just past the sidebar's edge
  expect(placed.top).toBe(536); // centered on the row
  expect(placed.arrowTop).toBe(80); // the pointer aims at the row's middle
});

test("near the bottom it stays inside the window, still pointing at the row", () => {
  const trashRow = { left: 16, top: 770, width: 260, height: 24 };
  const placed = besideSidebar(trashRow, 300, viewport, card);
  expect(placed.top).toBe(viewport.height - card.height - 12);
  expect(placed.arrowTop).toBeGreaterThan(card.height / 2);
  expect(placed.arrowTop).toBeLessThanOrEqual(card.height - 16);
});

test("the card asks, can be closed, and says the original is safe", () => {
  const html = renderToStaticMarkup(
    <PersonSinksCard
      title="Move your Archive and Trash?"
      line="Your vault has its own Archive and Trash folders."
      onAnswer={async () => undefined}
      onDismiss={() => undefined}
    />,
  );
  expect(html).toContain('aria-label="Not now"');
  expect(html).toContain(">Yes, move them<");
  expect(html).toContain(">No, leave them<");
  expect(html).toContain("never touched");
  expect(POPOUT_MS).toBe(10_000);
});
