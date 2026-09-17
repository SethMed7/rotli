import { expect, test } from "bun:test";

import type { MemexChatSummary } from "../lib/tauri";
import { chatsToStamp, providerOf } from "./chatModelMeta";

const chat = (slug: string, model = "", provider = ""): MemexChatSummary => ({
  slug,
  title: slug,
  source: "rotli",
  attachedTo: "",
  path: `chats/${slug}.md`,
  modifiedMs: 0,
  pinned: false,
  model,
  provider,
});

test("a chat missing a model takes this device's map, else the vault's default", () => {
  const map = { "corpus:a": "gemma-3-12b-it-qat-4bit", "other:c": "gpt-5.6-terra" };
  expect(chatsToStamp("corpus", [chat("a"), chat("c"), chat("d")], map, "sonnet")).toEqual([
    { slug: "a", modelId: "gemma-3-12b-it-qat-4bit" },
    { slug: "c", modelId: "sonnet" },
    { slug: "d", modelId: "sonnet" },
  ]);
  // no default either: nothing to write
  expect(chatsToStamp("corpus", [chat("d")], {}, "")).toEqual([]);
});

test("a chat with a model but no provider is completed with its own model; a complete one is left alone", () => {
  const chats = [chat("label", "Gemini 3.5 Flash (Medium)"), chat("done", "sonnet", "claude")];
  expect(chatsToStamp("corpus", chats, { "corpus:label": "ignored" }, "sonnet")).toEqual([
    { slug: "label", modelId: "Gemini 3.5 Flash (Medium)" },
  ]);
});

test("the provider of a legacy Gemini label or retired Gemini id is Antigravity; unknown stays null", () => {
  expect(providerOf("Gemini 3.5 Flash (Medium)", [], [])).toBe("antigravity");
  expect(providerOf("gemini-3.5-flash-medium", [], [])).toBe("antigravity");
  expect(providerOf("sonnet", [], [])).toBe("claude");
  expect(providerOf("some-local-thing", [], [])).toBeNull();
});
