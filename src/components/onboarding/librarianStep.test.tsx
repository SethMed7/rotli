import { expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import { LibrarianScreen } from "./librarianStep";

test("every lane is offered, each saying what this Mac has for it", () => {
  const html = renderToStaticMarkup(<LibrarianScreen />);
  for (const lane of ["On this Mac", "Claude", "ChatGPT", "Gemini"]) {
    expect(html).toContain(`<span class="setup-lane-name">${lane}</span>`);
  }
  // before the probes answer, nothing is judged missing
  expect(html.match(/class="setup-lane-status">Checking…</g)?.length).toBe(4);
  expect(html).not.toContain("Nothing is set up on this Mac yet");
});
