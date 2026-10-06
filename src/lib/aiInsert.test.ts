import { expect, test } from "bun:test";

import { corpusInsertAi } from "./aiInsert";

test("off the Mac app there is no insert lane: Ask AI says where it runs", async () => {
  const model = { id: "gemma-local", endpoint: "http://127.0.0.1:11435" };
  await expect(corpusInsertAi("n", "body", "text", model, "r1")).rejects.toThrow(
    "Ask AI runs in the Mac app.",
  );
});
