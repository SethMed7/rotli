import { expect, test } from "bun:test";

import {
  BLOCK_NOTICES,
  blockedNoticeKind,
  remoteBlockOf,
  remoteBlockText,
  retryWhileWarming,
} from "./remoteBlock";

test("a tagged refusal from Rust becomes plain words, and is recognised again from a saved chat", () => {
  const raw = "rotli-blocked:pattern This message holds text shaped like a key, password, or card number.";
  expect(remoteBlockOf(raw)).toBe("pattern");
  expect(remoteBlockText(raw)).toBe(BLOCK_NOTICES.pattern);
  expect(blockedNoticeKind(`⚠ ${BLOCK_NOTICES.pattern}`)).toBe("pattern");
  expect(blockedNoticeKind(`⚠ ${BLOCK_NOTICES.secure}`)).toBe("secure");
  // anything else stays as it was
  expect(remoteBlockOf("couldn't reach the model")).toBeNull();
  expect(remoteBlockText("couldn't reach the model")).toBe("couldn't reach the model");
  expect(blockedNoticeKind("⚠ Claude's safety filter blocked this reply")).toBeNull();
});

test("startup waits instead of refusing, and only startup is retried", async () => {
  let calls = 0;
  let waits = 0;
  const sleep = () => Promise.resolve();
  const answer = await retryWhileWarming(
    async () => {
      calls += 1;
      if (calls < 3) throw new Error("rotli-blocked:warming still checking");
      return "hello";
    },
    () => (waits += 1),
    { sleep },
  );
  expect([answer, calls, waits]).toEqual(["hello", 3, 2]);

  let tries = 0;
  const pattern = retryWhileWarming(
    async () => {
      tries += 1;
      throw new Error("rotli-blocked:pattern held back");
    },
    undefined,
    { sleep },
  );
  await expect(pattern).rejects.toThrow("rotli-blocked:pattern");
  expect(tries).toBe(1);

  const gaveUp = retryWhileWarming(
    async () => Promise.reject(new Error("rotli-blocked:warming")),
    undefined,
    {
      tries: 2,
      sleep,
    },
  );
  await expect(gaveUp).rejects.toThrow("warming");
});
