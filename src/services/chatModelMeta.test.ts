import { expect, test } from "bun:test";

import type { MemexChatSummary } from "../lib/tauri";
import { chatsNeedingModel } from "./chatModelMeta";

const chat = (slug: string, model = ""): MemexChatSummary => ({
  slug,
  title: slug,
  source: "rotli",
  attachedTo: "",
  path: `chats/${slug}.md`,
  modifiedMs: 0,
  pinned: false,
  model,
  provider: "",
});

test("only chats whose file lacks a model, and whose model this device knows, are backfilled", () => {
  const map = { "corpus:a": "gemma-3-12b-it-qat-4bit", "corpus:b": "sonnet", "other:c": "gpt-5.6-terra" };
  expect(chatsNeedingModel("corpus", [chat("a"), chat("b", "sonnet"), chat("c"), chat("d")], map)).toEqual([
    { slug: "a", modelId: "gemma-3-12b-it-qat-4bit" },
  ]);
});
