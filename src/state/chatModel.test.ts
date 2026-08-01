// Per-chat model independence (Seth, 2026-08-01): the model picker used to
// write ONE global id, so choosing Claude in the left pane silently moved the
// right pane's chat onto Claude too. A chat now owns its model; `chatModelId`
// survives only as the SEED a brand-new chat starts from (the last model picked
// anywhere), which is exactly the pre-change expectation for a fresh chat.

import { beforeEach, describe, expect, test } from "bun:test";

import { parseSettings } from "./persist";
import { chatKey, chatModelFor, useUiStore } from "./ui";

describe("chatKey — the per-chat map key", () => {
  test("a saved chat keys by slug; an unsaved one rides its PANE", () => {
    expect(chatKey("morning-brief", "pane-1")).toBe("morning-brief");
    expect(chatKey(null, "pane-1")).toBe("unsaved:pane-1");
  });

  test("two unsaved chats in two panes never share a key", () => {
    expect(chatKey(null, "pane-1")).not.toBe(chatKey(null, "pane-2"));
  });
});

describe("chatModelFor — own pick, else the new-chat seed", () => {
  test("a chat with its own pick ignores the seed", () => {
    expect(chatModelFor({ a: "gpt-5.2" }, "a", "claude-sonnet-5")).toBe("gpt-5.2");
  });

  test("a chat with no pick inherits the seed (a brand-new chat's default)", () => {
    expect(chatModelFor({ a: "gpt-5.2" }, "b", "claude-sonnet-5")).toBe("claude-sonnet-5");
  });

  test("no pick and no seed = null (the model store's own default takes over)", () => {
    expect(chatModelFor({}, "b", null)).toBeNull();
  });
});

describe("the per-chat model map — isolation", () => {
  beforeEach(() => {
    useUiStore.setState({ chatModel: {}, chatModelId: null });
  });

  test("setting chat A's model leaves chat B alone", () => {
    const { setChatModel } = useUiStore.getState();
    setChatModel("chat-a", "gemma-3-12b");
    setChatModel("chat-b", "claude-sonnet-5");
    setChatModel("chat-a", "gpt-5.2"); // A changes its mind

    const map = useUiStore.getState().chatModel;
    expect(chatModelFor(map, "chat-a", null)).toBe("gpt-5.2");
    expect(chatModelFor(map, "chat-b", null)).toBe("claude-sonnet-5"); // untouched
  });

  test("moving the seed cannot move a chat that owns a pick", () => {
    useUiStore.getState().setChatModel("chat-b", "gemma-3-12b");
    useUiStore.getState().setChatModelId("gpt-5.2"); // a pick made in another pane

    const { chatModel, chatModelId } = useUiStore.getState();
    expect(chatModelFor(chatModel, "chat-b", chatModelId)).toBe("gemma-3-12b");
    // …while a chat that has never been pinned does follow the seed
    expect(chatModelFor(chatModel, "chat-new", chatModelId)).toBe("gpt-5.2");
  });

  test("re-setting the same id is a no-op reference-wise (no pointless save)", () => {
    useUiStore.getState().setChatModel("chat-a", "gemma-3-12b");
    const before = useUiStore.getState().chatModel;
    useUiStore.getState().setChatModel("chat-a", "gemma-3-12b");
    expect(useUiStore.getState().chatModel).toBe(before);
  });

  test("clearChatModel drops one key and leaves the rest; an unknown key is inert", () => {
    const { setChatModel, clearChatModel } = useUiStore.getState();
    setChatModel("chat-a", "gemma-3-12b");
    setChatModel("chat-b", "claude-sonnet-5");
    clearChatModel("chat-a");
    expect(useUiStore.getState().chatModel).toEqual({ "chat-b": "claude-sonnet-5" });

    const before = useUiStore.getState().chatModel;
    clearChatModel("nope");
    expect(useUiStore.getState().chatModel).toBe(before);
  });

  test("an unsaved chat's pick carries to its slug on the first save", () => {
    const { setChatModel, clearChatModel } = useUiStore.getState();
    const unsaved = chatKey(null, "pane-1");
    setChatModel(unsaved, "gpt-5.2");

    // the send binds the pane to a slug: carry, then spend the session key
    const carried = useUiStore.getState().chatModel[unsaved]!;
    setChatModel("first-real-chat", carried);
    clearChatModel(unsaved);

    const map = useUiStore.getState().chatModel;
    expect(map["first-real-chat"]).toBe("gpt-5.2");
    expect(unsaved in map).toBe(false); // never persisted, never leaked forward
  });
});

describe("parseSettings — chatModel (durable, additive, session-key free)", () => {
  test("missing key defaults to an empty map (every chat follows the seed)", () => {
    expect(parseSettings("{}").chatModel).toEqual({});
    expect(parseSettings('{"chatModel":"nope"}').chatModel).toEqual({});
  });

  test("round-trips per-slug picks", () => {
    const raw = '{"chatModel":{"chat-a":"gpt-5.2","chat-b":"gemma-3-12b"}}';
    expect(parseSettings(raw).chatModel).toEqual({ "chat-a": "gpt-5.2", "chat-b": "gemma-3-12b" });
  });

  test("drops the session keys and any non-string / empty id", () => {
    const raw = '{"chatModel":{"":"x","unsaved:pane-1":"gpt-5.2","chat-a":"gpt-5.2","chat-b":7,"chat-c":""}}';
    expect(parseSettings(raw).chatModel).toEqual({ "chat-a": "gpt-5.2" });
  });

  test("an old config with only chatModelId still opens — the seed feeds every chat", () => {
    const s = parseSettings('{"chatModelId":"claude-sonnet-5"}');
    expect(s.chatModel).toEqual({});
    expect(chatModelFor(s.chatModel, "any-chat", s.chatModelId)).toBe("claude-sonnet-5");
  });
});
