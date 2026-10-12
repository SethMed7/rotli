import { expect, test } from "bun:test";

import { allowedTools } from "./loop";
import type { RunInput } from "./types";

test("web build never offers file-reading or document-editing AI tools", () => {
  const input = { documentTool: true } as RunInput;
  expect(allowedTools(input, "research", "web").has("read_file")).toBe(false);
  expect(allowedTools(input, "research", "web").has("edit_document")).toBe(false);
  expect(allowedTools(input, "research", "desktop").has("read_file")).toBe(true);
  expect(allowedTools(input, "research", "desktop").has("edit_document")).toBe(true);
});
