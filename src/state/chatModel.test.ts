// Per-chat model independence (Seth, 2026-08-01): the model picker used to
// write ONE global id, so choosing Claude in the left pane silently moved the
// right pane's chat onto Claude too. A chat now owns its model; `chatModelId`
// survives only as the SEED a brand-new chat starts from (the last model picked
// anywhere), which is exactly the pre-change expectation for a fresh chat.

import { beforeEach, describe, expect, test } from "bun:test";

import { parseSettings, rescopeChatMapKeys } from "./persist";
import { chatKey, chatModelFor, retargetChatMapKeys, useUiStore } from "./ui";

describe("chatKey — the per-chat map key", () => {
  test("a saved chat keys by VAULT + slug; an unsaved one rides its PANE", () => {
    expect(chatKey("corpus", "morning-brief", "pane-1")).toBe("corpus:morning-brief");
    expect(chatKey("corpus", null, "pane-1")).toBe("unsaved:pane-1");
  });

  test("the same slug in two vaults never shares a key (isolation, 2026-08-03)", () => {
    expect(chatKey("corpus", "notes", "p")).not.toBe(chatKey("brain-2", "notes", "p"));
  });

  test("two unsaved chats in two panes never share a key", () => {
    expect(chatKey("corpus", null, "pane-1")).not.toBe(chatKey("corpus", null, "pane-2"));
  });

  test("no resolvable instance degrades to the bare slug (never crashes a chat)", () => {
    expect(chatKey(null, "morning-brief", "pane-1")).toBe("morning-brief");
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
    const unsaved = chatKey("corpus", null, "pane-1");
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

// Vault isolation (Seth, 2026-08-03: "each vault holds their own notes and
// chats — nothing travels between vaults"). The chat FILES were always scoped
// per instance root; these lock the per-chat preference maps to the same rule.
describe("rescopeChatMapKeys — legacy keys re-home to their one owning vault", () => {
  test("a bare slug owned by exactly one instance gains its prefix", () => {
    const owners = new Map([["daily", ["corpus"]]]);
    expect(rescopeChatMapKeys({ daily: "gpt-5.2" }, owners)).toEqual({ "corpus:daily": "gpt-5.2" });
  });

  test("an AMBIGUOUS slug (two vaults, same chat name) is dropped, never guessed", () => {
    const owners = new Map([["daily", ["corpus", "brain-2"]]]);
    expect(rescopeChatMapKeys({ daily: "gpt-5.2" }, owners)).toEqual({});
  });

  test("already-scoped and session keys pass through; a claimed target is never overwritten", () => {
    const owners = new Map([["daily", ["corpus"]]]);
    const m = { "corpus:daily": "claude-sonnet-5", daily: "gpt-5.2", "unsaved:p1": "x" };
    expect(rescopeChatMapKeys(m, owners)).toEqual({
      "corpus:daily": "claude-sonnet-5",
      "unsaved:p1": "x",
    });
  });

  test("a fully scoped map returns the SAME reference (no pointless save)", () => {
    const m = { "corpus:daily": "gpt-5.2" };
    expect(rescopeChatMapKeys(m, new Map())).toBe(m);
  });
});

describe("retargetChatMapKeys — a rename keeps the model/globe/measure", () => {
  beforeEach(() => {
    useUiStore.setState({ chatModel: {}, chatWeb: {}, chatMeasure: {} });
  });

  test("all three maps follow the new key; other chats untouched", () => {
    useUiStore.setState({
      chatModel: { "corpus:old": "gpt-5.2", "corpus:other": "gemma-3-12b" },
      chatWeb: { "corpus:old": true },
      chatMeasure: { "corpus:old": "wide" },
    });
    retargetChatMapKeys("corpus:old", "corpus:new");
    const s = useUiStore.getState();
    expect(s.chatModel).toEqual({ "corpus:new": "gpt-5.2", "corpus:other": "gemma-3-12b" });
    expect(s.chatWeb).toEqual({ "corpus:new": true });
    expect(s.chatMeasure).toEqual({ "corpus:new": "wide" });
  });

  test("a key absent from a map leaves that map's reference alone", () => {
    useUiStore.setState({ chatModel: { "corpus:old": "gpt-5.2" } });
    const webBefore = useUiStore.getState().chatWeb;
    retargetChatMapKeys("corpus:old", "corpus:new");
    expect(useUiStore.getState().chatWeb).toBe(webBefore);
  });
});
