import { describe, expect, test } from "bun:test";

import { QUOKKA_POSES } from "../../brand/quokka";
import {
  type ChatBuddyMoment,
  type ChatBuddyRun,
  chatBuddyMoment,
  chatBuddyPlacement,
  chatBuddyPose,
  chatBuddyWorking,
  justFinishedAfter,
  lastReplyPosition,
  nextBuddyRun,
} from "./chatBuddyModel";

const idle = { working: false, queued: false, lastSpeaker: "ai" as const, justFinished: false };

describe("the chat buddy's moment", () => {
  test("follows a reply from thinking to done", () => {
    expect(chatBuddyMoment({ ...idle, working: true, lastSpeaker: "you" })).toBe("thinking");
    expect(chatBuddyMoment({ ...idle, working: true, queued: true, lastSpeaker: "you" })).toBe("queued");
    expect(chatBuddyMoment({ ...idle, justFinished: true })).toBe("done");
    expect(chatBuddyMoment(idle)).toBe("settled");
  });

  test("listens when the person spoke last and nothing runs (stopped or failed)", () => {
    expect(chatBuddyMoment({ ...idle, lastSpeaker: "you" })).toBe("waiting");
    expect(chatBuddyMoment({ ...idle, lastSpeaker: "you", justFinished: true })).toBe("waiting");
  });
});

describe("the chat buddy's pose", () => {
  test("is a drawn pose for every moment, and only a missing vault looks worried", () => {
    const moments: ChatBuddyMoment[] = [
      "welcome",
      "empty",
      "unavailable",
      "no-vault",
      "queued",
      "thinking",
      "done",
      "waiting",
      "settled",
    ];
    for (const moment of moments) {
      const pose = chatBuddyPose(moment, 9);
      expect(QUOKKA_POSES).toContain(pose);
      if (moment !== "no-vault") expect(pose).not.toBe("attention");
    }
    expect(chatBuddyPose("thinking", 9)).toBe("thoughtful");
    expect(chatBuddyPose("done", 9)).toBe("celebrating");
    // DESIGN: thoughtful while a reply is queued or running
    expect(chatBuddyPose("queued", 9)).toBe("thoughtful");
    expect(chatBuddyPose("waiting", 9)).toBe("listening");
    expect(chatBuddyPose("settled", 9)).toBe("rest");
  });

  test("the welcome greets by day and winds down in the evening", () => {
    expect(chatBuddyPose("welcome", 8)).toBe("waving");
    expect(chatBuddyPose("welcome", 13)).toBe("waving");
    expect(chatBuddyPose("welcome", 20)).toBe("rest");
  });
});

describe("a reply that just landed", () => {
  const idleIn = (chatSlug: string | null, replyMark: number | null = null): ChatBuddyRun => ({
    working: false,
    chatSlug,
    replyMark,
  });

  test("counts when a run ends with a newer reply, even one that named the chat", () => {
    const running = nextBuddyRun(idleIn("a"), true, "a", 3);
    expect(running.replyMark).toBe(3);
    expect(justFinishedAfter(running, 3)).toBe(false);
    const ended = nextBuddyRun(running, false, "a", 5);
    expect(justFinishedAfter(ended, 5)).toBe(true);
    // a first send: the run starts unsaved and ends named
    const first = nextBuddyRun(nextBuddyRun(idleIn(null), true, null, -1), false, "new-chat", 1);
    expect(justFinishedAfter(first, 1)).toBe(true);
  });

  // owner review of PR 165: a Stop with nothing back left the old reply last
  // and still read as an answer landing
  test("a Stop that produced nothing is no celebration", () => {
    const running = nextBuddyRun(idleIn("a"), true, "a", 3);
    const stopped = nextBuddyRun(running, false, "a", 3);
    expect(justFinishedAfter(stopped, 3)).toBe(false);
    expect(chatBuddyMoment({ ...idle, justFinished: justFinishedAfter(stopped, 3) })).toBe("settled");
  });

  test("clears on a new run, or on another chat opened while idle", () => {
    const landed = nextBuddyRun(nextBuddyRun(idleIn("a"), true, "a", 3), false, "a", 5);
    expect(justFinishedAfter(nextBuddyRun(landed, true, "a", 5), 5)).toBe(false);
    expect(justFinishedAfter(nextBuddyRun(landed, false, "b", 9), 9)).toBe(false);
    expect(justFinishedAfter(landed, 5)).toBe(true);
  });

  test("a reply's position counts the messages the window hides", () => {
    const thread = [{ speaker: "you" }, { speaker: "rotli" }, { speaker: "you" }];
    expect(lastReplyPosition(thread, 0)).toBe(1);
    expect(lastReplyPosition(thread, 500)).toBe(501);
    expect(lastReplyPosition([{ speaker: "you" }], 0)).toBe(-1);
  });
});

// owner review of PR 165: the buddy kept thinking while the composer's
// post-run hold outlived the answer on screen
describe("the buddy's working state", () => {
  const quiet = { busy: false, foreignRun: false, foreignPending: false, lastSpeaker: "ai" as const };

  test("follows the run, not the composer hold, once the answer is on screen", () => {
    expect(chatBuddyWorking({ ...quiet, busy: true, lastSpeaker: "you" })).toBe(true);
    expect(chatBuddyWorking({ ...quiet, foreignRun: true, lastSpeaker: "you" })).toBe(true);
    // the run settled, the reply is not reread yet: still a reply in the works
    expect(chatBuddyWorking({ ...quiet, foreignPending: true, lastSpeaker: "you" })).toBe(true);
    // the reply is on screen (or a Stop took the message back): done thinking
    expect(chatBuddyWorking({ ...quiet, foreignPending: true })).toBe(false);
    expect(chatBuddyWorking({ ...quiet, foreignPending: true, lastSpeaker: null })).toBe(false);
    expect(chatBuddyWorking(quiet)).toBe(false);
  });
});

// owner review of PR 165: an empty thread with a run under way showed the
// welcome buddy and the live-edge buddy together
describe("one buddy per view", () => {
  const moments: ChatBuddyMoment[] = ["thinking", "queued", "done", "waiting", "settled"];

  test("never places a buddy in both the welcome and the live edge", () => {
    for (const hasMessages of [false, true])
      for (const working of [false, true])
        for (const pristine of [false, true])
          for (const live of moments) {
            const placed = chatBuddyPlacement({ hasMessages, working, pristine, live });
            expect([placed.welcome, placed.edge].filter((m) => m !== null)).toHaveLength(1);
          }
  });

  test("an empty thread keeps it in the welcome, showing a run under way", () => {
    expect(
      chatBuddyPlacement({ hasMessages: false, working: true, pristine: false, live: "thinking" }),
    ).toEqual({
      welcome: "thinking",
      edge: null,
    });
    expect(
      chatBuddyPlacement({ hasMessages: false, working: false, pristine: true, live: "settled" }),
    ).toEqual({
      welcome: "welcome",
      edge: null,
    });
    expect(
      chatBuddyPlacement({ hasMessages: false, working: false, pristine: false, live: "settled" }),
    ).toEqual({
      welcome: "empty",
      edge: null,
    });
    expect(chatBuddyPlacement({ hasMessages: true, working: false, pristine: false, live: "done" })).toEqual({
      welcome: null,
      edge: "done",
    });
  });
});
