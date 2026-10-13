import { expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import { LINK_PASS, convertSummary } from "./linkFormatSettings";
import { VaultPassSettings } from "./vaultPass";

const report = (notes: number, links: number, embeds: number) => ({ notes, links, embeds, examples: [] });

test.each([
  [report(3, 5, 2), false, "5 image and file links and 2 embeds in 3 notes use Rotli’s own format."],
  [report(3, 5, 2), true, "Converted 5 image and file links and 2 embeds in 3 notes."],
  [report(1, 1, 0), false, "1 image or file link in 1 note uses Rotli’s own format."],
  [report(2, 0, 2), false, "2 embeds in 2 notes use Rotli’s own format."],
  [report(0, 0, 0), false, "Every link already reads in Obsidian."],
] as const)("the link-format line for %o (done: %p)", (found, done, line) => {
  expect(convertSummary(found, done)).toBe(line);
});

test("the link-format row works in the Mac app only", () => {
  const web = renderToStaticMarkup(<VaultPassSettings native={false} pass={LINK_PASS} />);
  expect(web).toContain("Link format");
  expect(web).toContain("In the Mac app.");
});
