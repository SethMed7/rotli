import { expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import { FileNotice, FileNoticeLine } from "./fileNotice";

test("the file notice is an announced status line with a labelled dismiss, and absent when idle", () => {
  expect(renderToStaticMarkup(<FileNotice />)).toBe("");
  const markup = renderToStaticMarkup(
    <FileNoticeLine message="Saved to Assets — drop onto a note or chat to insert" onDismiss={() => {}} />,
  );
  expect(markup).toContain('role="status"');
  expect(markup).toContain("Saved to Assets — drop onto a note or chat to insert");
  expect(markup).toContain('aria-label="Dismiss"');
});
