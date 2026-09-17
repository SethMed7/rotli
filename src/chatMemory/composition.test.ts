// resolveChatNoteId: one match is the note; several are told apart by the
// back-link to the chat, reading only the ambiguous bodies (2026-09-17).
import { describe, expect, test } from "bun:test";

import { resolveChatNoteId } from "./composition";

describe("resolveChatNoteId", () => {
  const notes = [
    { id: "projects", aliases: ["omachary-research"], updatedAt: 2 },
    { id: "research", aliases: ["omachary-research"], updatedAt: 5 },
    { id: "seths-own", aliases: ["omachary-research"], updatedAt: 9 },
  ];
  const bodies: Record<string, string> = {
    projects: "# Omachary Research\n\nNotes from [[omachary-research]].",
    research: "# Omachary Research\n\n> chat: [[omachary-research]]",
    "seths-own": "# Omachary Research\n\nmy own note with the same title",
  };

  test("a single match never reads a body", async () => {
    let reads = 0;
    const id = await resolveChatNoteId("omachary-research", "omachary-research", [notes[0]!], async () => {
      reads += 1;
      return null;
    });
    expect(id).toBe("projects");
    expect(reads).toBe(0);
  });

  test("several matches resolve to the newest note that links back to the chat", async () => {
    const read: string[] = [];
    const id = await resolveChatNoteId("omachary-research", "omachary-research", notes, async (noteId) => {
      read.push(noteId);
      return bodies[noteId] ?? null;
    });
    expect(id).toBe("research");
    expect(read.sort()).toEqual(["projects", "research", "seths-own"]);
  });

  test("no match is null", async () => {
    expect(await resolveChatNoteId("nope", "chat", notes, async () => null)).toBeNull();
  });
});
