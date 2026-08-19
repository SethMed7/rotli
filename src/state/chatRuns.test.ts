// The sidebar's run signals (the maintainer, 2026-08-03): running while a turn is in
// flight, unread when the reply landed unwatched, gone once seen. Session
// state only — a relaunch starts quiet by design.

import { beforeEach, describe, expect, test } from "bun:test";

import { useChatRuns } from "./chatRuns";

describe("chat run signals", () => {
  beforeEach(() => {
    useChatRuns.setState({ runs: {} });
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
});
