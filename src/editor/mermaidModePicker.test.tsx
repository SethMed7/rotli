import { expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import { MermaidModePicker } from "./mermaidModePicker";

test("production diagram controls expose View and Code while experimental Visual stays absent", () => {
  const markup = renderToStaticMarkup(
    <MermaidModePicker mode="view" onChange={() => {}} visualEditingEnabled={false} />,
  );
  expect(markup).toContain(">View</button>");
  expect(markup).toContain(">Code</button>");
  expect(markup).not.toContain(">Visual</button>");
  expect(
    renderToStaticMarkup(<MermaidModePicker mode="visual" onChange={() => {}} visualEditingEnabled />),
  ).toContain(">Visual</button>");
});
