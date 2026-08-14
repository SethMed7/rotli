import { beforeEach, describe, expect, test } from "bun:test";

import { chatDraftFor, useChatDrafts } from "./chatDrafts";

describe("chat drafts", () => {
  beforeEach(() => useChatDrafts.setState({ drafts: {} }));

  test("an unsent draft survives its chat surface unmounting and remounting", () => {
    const tabId = "chat-tab-a";
    const state = useChatDrafts.getState();
    state.setTitle(tabId, "A careful title");
    state.setMessage(tabId, "A long unsent message that must survive switching tabs.");
    state.setImages(tabId, [
      {
        id: "storage/images/diagram.png",
        name: "diagram.png",
        src: "data:image/png;base64,abc",
      },
    ]);

    // A remounted surface reads the session store by stable tab identity.
    expect(chatDraftFor(useChatDrafts.getState().drafts, tabId)).toEqual({
      title: "A careful title",
      message: "A long unsent message that must survive switching tabs.",
      images: [
        {
          id: "storage/images/diagram.png",
          name: "diagram.png",
          src: "data:image/png;base64,abc",
        },
      ],
      question: null,
      questionKey: null,
    });
  });

  test("a clarification choice survives switching tabs until it is answered", () => {
    useChatDrafts.getState().setQuestion(
      "chat-tab-a",
      {
        prompt: "Which audience?",
        options: ["Customers", "Team"],
      },
      "default:chat-a",
    );

    expect(chatDraftFor(useChatDrafts.getState().drafts, "chat-tab-a").question).toEqual({
      prompt: "Which audience?",
      options: ["Customers", "Team"],
    });
    expect(chatDraftFor(useChatDrafts.getState().drafts, "chat-tab-a").questionKey).toBe("default:chat-a");
    expect(chatDraftFor(useChatDrafts.getState().drafts, "chat-tab-b").question).toBeNull();
  });

  test("a clarification is scoped to the chat that asked it", () => {
    useChatDrafts
      .getState()
      .setQuestion(
        "chat-tab-a",
        { prompt: "Which audience?", options: ["Customers", "Team"] },
        "default:chat-a",
      );
    const draft = chatDraftFor(useChatDrafts.getState().drafts, "chat-tab-a");

    expect(draft.questionKey === "default:chat-a" ? draft.question : null).not.toBeNull();
    expect(draft.questionKey === "default:chat-b" ? draft.question : null).toBeNull();
  });

  test("two unsaved chats in one pane keep independent drafts", () => {
    useChatDrafts.getState().setMessage("chat-tab-a", "first draft");
    useChatDrafts.getState().setMessage("chat-tab-b", "second draft");

    expect(chatDraftFor(useChatDrafts.getState().drafts, "chat-tab-a").message).toBe("first draft");
    expect(chatDraftFor(useChatDrafts.getState().drafts, "chat-tab-b").message).toBe("second draft");
  });

  test("a sent draft can be cleared without disturbing another tab", () => {
    useChatDrafts.getState().setMessage("chat-tab-a", "sent");
    useChatDrafts.getState().setMessage("chat-tab-b", "still composing");
    useChatDrafts.getState().clear("chat-tab-a");

    expect(chatDraftFor(useChatDrafts.getState().drafts, "chat-tab-a").message).toBe("");
    expect(chatDraftFor(useChatDrafts.getState().drafts, "chat-tab-b").message).toBe("still composing");
  });
});
