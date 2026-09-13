import { expect, test } from "bun:test";

import {
  isLibrarianLane,
  LIBRARIAN_LANES,
  describeFiledBy,
  librarianCaption,
  librarianModelFor,
  librarianModelId,
  librarianOptions,
  suggestedLibrarian,
} from "./librarianLane";

const signedIn = { installed: true, authenticated: true, version: "1" };
const installedOnly = { installed: true, authenticated: false, version: "1" };

test("Cursor is never a Librarian lane", () => {
  expect([...LIBRARIAN_LANES]).toEqual(["claude", "codex", "antigravity"]);
  expect(isLibrarianLane("cursor")).toBe(false);
  expect(isLibrarianLane("antigravity")).toBe(true);
});

test("options are local plus signed-in clients, and never drop the current choice", () => {
  expect(librarianOptions({}, "local")).toEqual(["local"]);
  expect(
    librarianOptions({ claude: signedIn, codex: installedOnly, antigravity: signedIn }, "local"),
  ).toEqual(["local", "claude", "antigravity"]);
  expect(librarianOptions({}, "codex")).toEqual(["local", "codex"]);
});

test("Gemini is suggested only when signed in and nothing else was chosen", () => {
  expect(suggestedLibrarian({}, "local")).toBe("local");
  expect(suggestedLibrarian({ antigravity: installedOnly }, "local")).toBe("local");
  expect(suggestedLibrarian({ antigravity: signedIn }, "local")).toBe("antigravity");
  expect(suggestedLibrarian({ antigravity: signedIn }, "claude")).toBe("claude");
});

test("the caption says whether notes leave the Mac", () => {
  expect(librarianCaption("local", false)).toMatch(/never enters/);
  expect(librarianCaption("antigravity", true)).toMatch(/^Gemini files your notes/);
  expect(librarianCaption("antigravity", false)).toMatch(/turned off in Connections/);
});

test("a Librarian model id sticks only inside its lane's catalog, else the chat default answers", () => {
  expect(librarianModelId("local", "opus")).toBeNull();
  expect(librarianModelId("claude", "opus")).toBe("opus");
  expect(librarianModelId("claude", "gemini-3.8-flash-high")).toBeNull();
  expect(librarianModelId("claude", 7)).toBeNull();
  expect(librarianModelFor("claude", "opus", { claude: "sonnet" })).toBe("opus");
  expect(librarianModelFor("claude", "nope", { claude: "sonnet" })).toBe("sonnet");
  expect(librarianModelFor("antigravity", null, {})).toBe("gemini-3.8-flash-high");
});

test("a filed_by value names the lane and model for people", () => {
  expect(describeFiledBy("claude:opus")).toBe("Claude · Claude Opus");
  expect(describeFiledBy("antigravity:gemini-3.8-flash-high")).toBe("Gemini · Gemini 3.8 Flash (High)");
  expect(describeFiledBy("claude:unknown-id")).toBe("Claude · unknown-id");
  expect(describeFiledBy("gemma-3-12b-it-qat-4bit")).toBe("gemma-3-12b-it-qat-4bit");
});
