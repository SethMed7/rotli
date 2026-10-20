// ChatKey is the only way into a per-chat map: "" is refused outright, and an
// unsaved tab's key is its own isolated entry that never reaches disk (#7).

import { beforeEach, describe, expect, test } from "bun:test";

import { chatKey, chatModelsBySlug, isUnsavedChatKey, persistableChatMap, toChatKey } from "./chatMapKeys";
import { parseSettings } from "./persist";
import { useUiStore } from "./ui";

describe("toChatKey — the one constructor", () => {
  test("refuses the empty id", () => {
    expect(toChatKey("")).toBeNull();
  });

  test("passes saved, legacy, and unsaved keys through unchanged (the brand is compile-time only)", () => {
    expect<string | null>(toChatKey("corpus:daily")).toBe("corpus:daily");
    expect<string | null>(toChatKey("daily")).toBe("daily");
    expect<string | null>(toChatKey("unsaved:tab-1")).toBe("unsaved:tab-1");
  });

  test("chatKey never yields the empty key, even with an empty slug and tab", () => {
    expect<string>(chatKey(null, "", "")).not.toBe("");
    expect<string>(chatKey("corpus", null, "")).not.toBe("");
    expect(isUnsavedChatKey(chatKey("corpus", "", "tab-1"))).toBe(true);
  });
});

describe("chatModelsBySlug — the dashboard's model mix", () => {
  test("reads the vault-scoped key, falls back to a legacy bare slug, skips unpinned chats", () => {
    const models = { "corpus:a": "gpt-5.2", b: "gemma-3-12b", "unsaved:tab-1": "x" };
    expect(chatModelsBySlug([{ slug: "a" }, { slug: "b" }, { slug: "c" }], "corpus", models)).toEqual({
      a: "gpt-5.2",
      b: "gemma-3-12b",
    });
  });
});

describe("empty and unsaved ids never touch another chat's settings", () => {
  beforeEach(() => {
    useUiStore.setState({
      chatModel: {},
      chatWeb: {},
      chatMeasure: {},
      chatReasoning: {},
      chatServiceTier: {},
    });
  });

  test("an unsaved chat's settings are its own; a saved chat's are invisible to it", () => {
    const saved = chatKey("corpus", "daily", "tab-1");
    const unsavedA = chatKey("corpus", null, "tab-1");
    const unsavedB = chatKey("corpus", null, "tab-2");
    const ui = useUiStore.getState();
    ui.setChatWeb(saved, true);
    ui.setChatModel(saved, "gpt-5.2");
    ui.setChatMeasure(unsavedA, "wide");
    ui.setChatReasoning(unsavedA, "high");

    const s = useUiStore.getState();
    expect(s.chatWeb[unsavedA]).toBeUndefined();
    expect(s.chatModel[unsavedA]).toBeUndefined();
    expect(s.chatMeasure[unsavedB]).toBeUndefined();
    expect(s.chatReasoning[unsavedB]).toBeUndefined();
    expect(s.chatMeasure[saved]).toBeUndefined();
    expect(s.chatReasoning[saved]).toBeUndefined();
  });

  test("a stored '' or unsaved key never loads into a fresh chat", () => {
    const parsed = parseSettings(
      '{"chatWeb":{"":true,"unsaved:tab-1":true},"chatModel":{"":"x","unsaved:tab-1":"y"},"chatMeasure":{"":"wide"}}',
    );
    const fresh = chatKey("corpus", null, "tab-1");
    expect(parsed.chatWeb[fresh]).toBeUndefined();
    expect(parsed.chatModel[fresh]).toBeUndefined();
    expect(Object.keys(parsed.chatWeb)).toEqual([]);
    expect(Object.keys(parsed.chatModel)).toEqual([]);
    expect(Object.keys(parsed.chatMeasure)).toEqual([]);
  });

  test("an unsaved key is never written; the on-disk shape stays a plain string map", () => {
    const ui = useUiStore.getState();
    ui.setChatWeb(chatKey("corpus", null, "tab-1"), true);
    ui.setChatWeb(chatKey("corpus", "daily", "tab-1"), false);
    const written: unknown = JSON.parse(JSON.stringify(persistableChatMap(useUiStore.getState().chatWeb)));
    expect(written).toEqual({ "corpus:daily": false });
  });
});
