import { describe, expect, test } from "bun:test";

import { QUOKKA_POSES } from "../../brand/quokka";
import { type ChatBuddyMoment, chatBuddyMoment, chatBuddyPose, justFinishedAfter } from "./chatBuddyModel";

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
  });

  test("the welcome greets by day and winds down in the evening", () => {
    expect(chatBuddyPose("welcome", 8)).toBe("waving");
    expect(chatBuddyPose("welcome", 13)).toBe("waving");
    expect(chatBuddyPose("welcome", 20)).toBe("rest");
  });
});

describe("a reply that just landed", () => {
  const seen = { working: false, chatSlug: "a", justFinished: false };

  test("counts when a run ends, even one that named the chat", () => {
    expect(justFinishedAfter({ ...seen, working: true }, false, "a")).toBe(true);
    expect(justFinishedAfter({ ...seen, working: true, chatSlug: null }, false, "new-chat")).toBe(true);
  });

  test("clears on a new run, or on another chat opened while idle", () => {
    expect(justFinishedAfter({ ...seen, justFinished: true }, true, "a")).toBe(false);
    expect(justFinishedAfter({ ...seen, justFinished: true }, false, "b")).toBe(false);
    expect(justFinishedAfter({ ...seen, justFinished: true }, false, "a")).toBe(true);
  });
});
