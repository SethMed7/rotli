// Sixth review of pull request 267 (F5): a protected chat file saved with
// Windows line endings (CRLF) by another editor lost its secure-context mark
// on reopen, so a remote model could continue it, and Rotli couldn't mark a
// CRLF chat at all. Every reader and writer now goes through one parser
// (lib/frontmatterBlock.ts), keeping the file's own line endings.
import { expect, test } from "bun:test";

import {
  addChatArtifact,
  hasSecureContext,
  parseChatArtifacts,
  setChatPinned,
  setChatSecureContext,
} from "./contract";

const crlf = (text: string) => text.replace(/\n/g, "\r\n");
const PROTECTED = crlf(
  "---\ntitle: Harbor\nsecureContext: true\n---\n\n**you** · 09:00\n\nwhat about the lease?\n",
);
const PLAIN = crlf("---\ntitle: Harbor\n---\n\n**you** · 09:00\n\nhello\n");

test("a CRLF chat keeps its secure-context mark on reopen", () => {
  expect(hasSecureContext(PROTECTED)).toBe(true);
  expect(hasSecureContext(PLAIN)).toBe(false);
});

test("a CRLF chat can be marked, and keeps its line endings and transcript", () => {
  const marked = setChatSecureContext(PLAIN);
  expect(hasSecureContext(marked)).toBe(true);
  expect(marked).toBe(crlf("---\ntitle: Harbor\nsecureContext: true\n---\n\n**you** · 09:00\n\nhello\n"));
});

test("an opening fence that never closes can't prove a chat unmarked", () => {
  expect(hasSecureContext("---\r\ntitle: Harbor\r\nsecureContext: true\r\n")).toBe(true);
  expect(hasSecureContext("no frontmatter at all\r\n")).toBe(false);
});

test("the other chat writers keep a CRLF file's endings too", () => {
  expect(setChatPinned(PLAIN, true)).toBe(
    crlf("---\ntitle: Harbor\npinned: true\n---\n\n**you** · 09:00\n\nhello\n"),
  );
  const withArtifact = addChatArtifact(PLAIN, { kind: "note", id: "n1" });
  expect(parseChatArtifacts(withArtifact)).toEqual([{ kind: "note", id: "n1" }]);
  expect(withArtifact.includes("\r\n---\r\n")).toBe(true);
});
