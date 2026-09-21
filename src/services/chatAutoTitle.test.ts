// nameNewChat's guards: which chats are never renamed, and that a name given
// while the model was thinking wins. `mock.module` is process-wide and outlives
// this file, so every mock spreads the REAL module and afterAll restores it.

import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";

import * as liveHost from "../ai/host";
import type { ChatModelInfo } from "../lib/tauri";
import type { MemexInstance } from "../memex/config";
import * as liveService from "../memex/service";
import * as liveMemex from "../memex/useMemex";
import { useUiStore } from "../state/ui";

// SNAPSHOTS of the real exports: a namespace import is live, so after
// mock.module it points at the mocks and "restoring" it would re-install them
const realHost = { ...liveHost };
const realService = { ...liveService };
const realMemex = { ...liveMemex };

let reply: () => Promise<string> = async () => "Partner portal launch plan";
let requests: Array<{ model: string; secure: boolean }> = [];
let stored = "help me plan the Q3";
let written: string[] = [];

void mock.module("../ai/host", () => ({
  ...realHost,
  makeTauriHost: (model: ChatModelInfo, opts?: { isSecureContext?: () => boolean }) => ({
    complete: () => {
      requests.push({ model: model.id, secure: opts?.isSecureContext?.() === true });
      return reply();
    },
  }),
}));
void mock.module("../memex/service", () => ({
  ...realService,
  listChats: async () => [{ slug: "help-me-plan-the-q3", title: stored }],
  updateChatTitle: async (_instance: MemexInstance, _slug: string, title: string) => {
    written.push(title);
  },
}));
void mock.module("../memex/useMemex", () => ({ ...realMemex, invalidateMemex: async () => {} }));

afterAll(() => {
  void mock.module("../ai/host", () => realHost);
  void mock.module("../memex/service", () => realService);
  void mock.module("../memex/useMemex", () => realMemex);
});

const { nameNewChat } = await import("./chatAutoTitle");

const instance = { id: "vault" } as MemexInstance;
const model = { id: "picked-model" } as ChatModelInfo;
const settle = () => new Promise((resolve) => setTimeout(resolve, 5));
const run = (over: { existing?: string; typed?: string; secure?: boolean } = {}) =>
  nameNewChat(
    instance,
    over.existing,
    "help-me-plan-the-q3",
    model,
    "help me plan the Q3 launch for the partner portal",
    "help me plan the Q3",
    over.typed ?? "",
    over.secure ?? false,
  );

beforeEach(() => {
  reply = async () => "Partner portal launch plan";
  requests = [];
  stored = "help me plan the Q3";
  written = [];
  useUiStore.setState({ chatTitleByMeaning: true });
});

describe("naming a new chat by meaning", () => {
  test("asks the chat's own model once and improves the title", async () => {
    run();
    await settle();
    expect(requests).toEqual([{ model: "picked-model", secure: false }]);
    expect(written).toEqual(["Partner portal launch plan"]);
  });

  test("an existing chat, a typed name, or the switch off: no request at all", async () => {
    run({ existing: "older-chat" });
    run({ typed: "My own name" });
    useUiStore.setState({ chatTitleByMeaning: false });
    run();
    await settle();
    expect(requests).toEqual([]);
    expect(written).toEqual([]);
  });

  test("the secure flag reaches the host, whose gate decides", async () => {
    run({ secure: true });
    await settle();
    expect(requests).toEqual([{ model: "picked-model", secure: true }]);
  });

  test("a name given while the model was thinking wins", async () => {
    reply = async () => {
      stored = "Renamed by hand";
      return "Partner portal launch plan";
    };
    run();
    await settle();
    expect(written).toEqual([]);
  });

  test("an unusable reply or a failure leaves the name alone", async () => {
    reply = async () => "Sure! Here is a title that captures what you asked for in this chat";
    run();
    reply = async () => {
      throw new Error("offline");
    };
    run();
    await settle();
    expect(written).toEqual([]);
  });
});
