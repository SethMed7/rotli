import { expect, test } from "bun:test";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";

import { CanvasFileEditor } from "./canvasFileEditor";

test("a canvas file opens with a loading state before its JSON is read", () => {
  const markup = renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <CanvasFileEditor fileId="wiki/Plans.canvas" />
    </QueryClientProvider>,
  );
  expect(markup).toContain("Opening canvas…");
});
