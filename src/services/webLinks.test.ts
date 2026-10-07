import { expect, test } from "bun:test";

import { webLinkSecure } from "./webLinks";

const plain = { folderId: "Plans", body: "# Plans\n\nThe week." };

test("the web marks a note secure by flag, secure folder, or a secret in its body — as the Mac does", () => {
  expect(webLinkSecure({}, plain)).toBe(false);
  expect(webLinkSecure({ secure: true }, plain)).toBe(true);
  expect(webLinkSecure({}, { ...plain, folderId: "Secure notes" })).toBe(true);
  expect(webLinkSecure({}, { ...plain, folderId: "Inbox", diskFolderId: "wiki/_secure/keys" })).toBe(true);
  expect(webLinkSecure({}, { ...plain, body: "# Keys\n\n-----BEGIN PRIVATE KEY-----\nabc\n" })).toBe(true);
});
