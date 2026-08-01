import { describe, expect, test } from "bun:test";

import { creationIsSecure, SECURE_NOTES_FOLDER } from "./secureNotes";

describe("secure-note creation policy", () => {
  test("the Secure notes destination and explicit quick-surface policy default secure", () => {
    expect(creationIsSecure(SECURE_NOTES_FOLDER)).toBe(true);
    expect(creationIsSecure(`${SECURE_NOTES_FOLDER}/Passwords`)).toBe(true);
    expect(creationIsSecure("Board", { secure: true })).toBe(true);
    expect(creationIsSecure("Inbox", { secure: true })).toBe(true);
  });

  test("ordinary note creation stays ordinary", () => {
    expect(creationIsSecure("Inbox")).toBe(false);
    expect(creationIsSecure("Projects")).toBe(false);
  });
});
