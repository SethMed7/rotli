// The sidebar's run signals (the maintainer, 2026-08-03): running while a turn is in
// flight, unread when the reply landed unwatched, gone once seen. Session
// state only — a relaunch starts quiet by design.

import { beforeEach, describe, expect, test } from "bun:test";

import { REPLY_HOLD_GRACE_MS, replyPending, useChatRuns } from "./chatRuns";

describe("chat run signals", () => {
  beforeEach(() => {
    useChatRuns.setState({ runs: {}, persisted: {}, settledAt: {}, persistedAt: {} });
  });

  test("a persisted reply bumps its key's count and the owner learns the count it caused", () => {
    const s = useChatRuns.getState();
    s.markRunning("corpus:a");
    expect(useChatRuns.getState().persisted["corpus:a"]).toBeUndefined();
    expect(s.markPersisted("corpus:a")).toBe(1);
    expect(s.markPersisted("corpus:a")).toBe(2);
    expect(useChatRuns.getState().persisted).toEqual({ "corpus:a": 2 });
    // unrelated chats never move
    expect(useChatRuns.getState().persisted["corpus:b"]).toBeUndefined();
  });

  test("retargeting an unsaved key carries its persisted count to the slug key", () => {
    const s = useChatRuns.getState();
    s.markRunning("unsaved:t1");
    s.markPersisted("unsaved:t1");
    s.retargetRun("unsaved:t1", "corpus:new");
    expect(useChatRuns.getState().runs).toEqual({ "corpus:new": "running" });
    expect(useChatRuns.getState().persisted).toEqual({ "corpus:new": 1 });
  });

  test("retargeting keeps the reply hold: a settled unsaved run still holds the composer under the slug key", () => {
    const s = useChatRuns.getState();
    s.markRunning("unsaved:t2");
    s.settleRun("unsaved:t2", true);
    s.retargetRun("unsaved:t2", "corpus:born");
    const now = Date.now();
    expect(replyPending(useChatRuns.getState(), "corpus:born", now)).toBe(true);
    expect(replyPending(useChatRuns.getState(), "unsaved:t2", now)).toBe(false);
    useChatRuns.getState().markPersisted("corpus:born");
    expect(replyPending(useChatRuns.getState(), "corpus:born", now)).toBe(false);
  });

  test("running → settled-watched stays done; settled-unwatched flips to unread", () => {
    const s = useChatRuns.getState();
    s.markRunning("corpus:a");
    s.markRunning("corpus:b");
    expect(useChatRuns.getState().runs).toEqual({
      "corpus:a": "running",
      "corpus:b": "running",
    });

    useChatRuns.getState().settleRun("corpus:a", true);
    useChatRuns.getState().settleRun("corpus:b", false);
    expect(useChatRuns.getState().runs).toEqual({
      "corpus:a": "done",
      "corpus:b": "unread",
    });
  });

  test("opening the chat acknowledges unread as done but never changes a live run", () => {
    useChatRuns.getState().markRunning("corpus:a");
    useChatRuns.getState().clearUnread("corpus:a");
    expect(useChatRuns.getState().runs["corpus:a"]).toBe("running"); // still answering

    useChatRuns.getState().settleRun("corpus:a", false);
    useChatRuns.getState().clearUnread("corpus:a");
    expect(useChatRuns.getState().runs["corpus:a"]).toBe("done");
  });

  test("the first save retargets the unsaved pane key onto the slug key", () => {
    useChatRuns.getState().markRunning("unsaved:pane-1");
    useChatRuns.getState().retargetRun("unsaved:pane-1", "corpus:new-chat");
    expect(useChatRuns.getState().runs).toEqual({
      "corpus:new-chat": "running",
    });
    // retargeting a key with no entry is inert
    const before = useChatRuns.getState().runs;
    useChatRuns.getState().retargetRun("unsaved:pane-9", "corpus:x");
    expect(useChatRuns.getState().runs).toBe(before);
  });

  test("settling a key that never ran (a watched no-op) leaves the map alone", () => {
    const before = useChatRuns.getState().runs;
    useChatRuns.getState().settleRun("corpus:ghost", true);
    expect(useChatRuns.getState().runs).toBe(before);
  });

  test("a settled run holds until its reply persists, and releases on its own after the grace", () => {
    const s = useChatRuns.getState();
    expect(replyPending(useChatRuns.getState(), "corpus:a", Date.now())).toBe(false);
    s.markRunning("corpus:a");
    expect(replyPending(useChatRuns.getState(), "corpus:a", Date.now())).toBe(false); // still running
    s.settleRun("corpus:a", false);
    const settled = useChatRuns.getState().settledAt["corpus:a"]!;
    expect(replyPending(useChatRuns.getState(), "corpus:a", settled + 10)).toBe(true);
    expect(replyPending(useChatRuns.getState(), "corpus:a", settled + REPLY_HOLD_GRACE_MS + 1)).toBe(false);
    s.markPersisted("corpus:a");
    expect(replyPending(useChatRuns.getState(), "corpus:a", settled + 10)).toBe(false);
  });
});
