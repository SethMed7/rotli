import { describe, expect, test } from "bun:test";

import type { NoteSummary } from "../types";
import { brainLocationLabel, noteDiskFolder, noteLocationLabel, projectNoteToBrain } from "./noteLocation";

const NOTE: NoteSummary = {
  id: "note-1",
  title: "Cross-project tasks",
  snippet: "",
  folderId: "Board",
  diskFolderId: "wiki/projects",
  createdAt: 1,
  updatedAt: 1,
  pinned: false,
};

describe("brainLocationLabel", () => {
  test("wiki area → title-cased area", () => {
    expect(brainLocationLabel("wiki/projects")).toBe("Projects");
    expect(brainLocationLabel("wiki/projects/rotli")).toBe("Projects › Rotli");
    expect(brainLocationLabel("wiki")).toBe("Library");
  });
  test("staging + board → Captures", () => {
    expect(brainLocationLabel("wiki/_inbox")).toBe("Captures");
    expect(brainLocationLabel("Board")).toBe("Captures");
  });
  test("the protected lane is a real home inside the Brain", () => {
    expect(brainLocationLabel("wiki/_secure")).toBe("Library › Secure notes");
    expect(brainLocationLabel("wiki/_secure/calls")).toBe("Library › Secure notes");
  });
  test("the storage lane displays as Assets (2026-07-25) — the id keeps the old word", () => {
    expect(brainLocationLabel("Storage/Images")).toBe("Assets › Images");
    expect(brainLocationLabel("Storage")).toBe("Assets");
  });
  test("sinks + inbox + fallback", () => {
    expect(brainLocationLabel("Archive")).toBe("Archive");
    expect(brainLocationLabel("Trash")).toBe("Trash");
    expect(brainLocationLabel("")).toBe("Inbox");
    expect(brainLocationLabel("Inbox")).toBe("Inbox");
    expect(brainLocationLabel("Custom Folder")).toBe("Custom Folder");
  });
  test("linked library (vault) path", () => {
    expect(brainLocationLabel("vault:")).toBe("Linked library");
    expect(brainLocationLabel("vault:wiki/people")).toBe("Linked library › People");
  });
});

describe("noteLocationLabel", () => {
  test("prefixes ★ Main when in Main", () => {
    expect(noteLocationLabel("wiki/projects", true)).toBe("★ Main · Projects");
    expect(noteLocationLabel("wiki/projects", false)).toBe("Projects");
  });
});

describe("dual shelf + disk locations", () => {
  test("physical Brain folder survives an Inbox/Captures shelf projection", () => {
    expect(noteDiskFolder(NOTE)).toBe("wiki/projects");
    expect(projectNoteToBrain(NOTE)).toEqual({ ...NOTE, folderId: "wiki/projects" });
  });

  test("staged notes stay in Captures and do not gain a Brain row", () => {
    const staged = { ...NOTE, diskFolderId: "wiki/_inbox" };
    expect(projectNoteToBrain(staged)).toBeNull();
  });

  test("older notes without diskFolderId keep their existing location", () => {
    const { diskFolderId: _diskFolderId, ...legacy } = NOTE;
    expect(noteDiskFolder(legacy)).toBe("Board");
  });
});
