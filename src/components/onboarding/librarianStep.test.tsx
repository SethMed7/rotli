import { expect, test } from "bun:test";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";

import { LibrarianScreen, librarianCopyChoice } from "./librarianStep";

const render = () =>
  renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <LibrarianScreen />
    </QueryClientProvider>,
  );

test("every lane is offered, each saying what this Mac has for it", () => {
  const html = render();
  for (const lane of ["On this Mac", "Claude", "ChatGPT", "Gemini"]) {
    expect(html).toContain(`<span class="setup-lane-name">${lane}</span>`);
  }
  // before the probes answer, nothing is judged missing
  expect(html.match(/class="setup-lane-status">Checking…</g)?.length).toBe(4);
  expect(html).not.toContain("Nothing is set up on this Mac yet");
});

test("in a folder connected in place, setup offers the Librarian only on a copy", () => {
  const choice = librarianCopyChoice("Garden");
  expect(choice.value).toBe("on");
  expect(choice.title).toBe("Use the Librarian on a copy");
  expect(choice.description).toContain("Rotli copies “Garden” beside your vaults");
  expect(choice.description).toContain("Your original is never touched.");
});
