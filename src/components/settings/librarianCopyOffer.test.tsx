import { expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import { IN_PLACE_LIBRARIAN_LINE, LibrarianCopyOffer } from "./librarianCopyOffer";

test("a folder connected in place offers a copy with the Librarian, never the Librarian itself", () => {
  const markup = renderToStaticMarkup(<LibrarianCopyOffer root="/Users/sam/Garden" label="Garden" />);
  expect(markup).toContain(IN_PLACE_LIBRARIAN_LINE);
  expect(markup).toContain("Rotli copies “Garden” beside your vaults");
  expect(markup).toContain("Your original stays exactly as it is.");
  expect(markup).toContain(">Connect a copy with the Librarian…<");
  expect(markup).not.toContain("How much it may do");
});
