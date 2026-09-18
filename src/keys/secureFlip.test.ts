import { expect, test } from "bun:test";

import { flipSecure, type SecureIo } from "./secureFlip";

function memory(start: { secure: boolean } | null) {
  let stored = start;
  const writes: [string, boolean][] = [];
  const io: SecureIo = {
    read: async () => stored,
    write: async (id, secure) => {
      writes.push([id, secure]);
      stored = { secure };
    },
  };
  return { io, writes };
}

test("it reads the note's own flag and writes the opposite, both ways", async () => {
  const { io, writes } = memory({ secure: false });
  expect(await flipSecure("n1", io)).toBe(true);
  expect(await flipSecure("n1", io)).toBe(false);
  expect(writes).toEqual([
    ["n1", true],
    ["n1", false],
  ]);
});

test("unreadable frontmatter counts as not secure: the first press protects", async () => {
  const { io, writes } = memory(null);
  expect(await flipSecure("n2", io)).toBe(true);
  expect(writes).toEqual([["n2", true]]);
});

test("a failed write surfaces and claims no new state", async () => {
  const io: SecureIo = {
    read: async () => ({ secure: true }),
    write: async () => Promise.reject(new Error("locked")),
  };
  await expect(flipSecure("n3", io)).rejects.toThrow("locked");
});
