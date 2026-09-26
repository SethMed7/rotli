import { describe, expect, test } from "bun:test";

import { DEST } from "./destinations";
import { handToAiFor } from "./handToAi";
import { notesService } from "./notes";

describe("Hand to AI — which notes may leave Rotli", () => {
  test("an ordinary note becomes a prompt", async () => {
    const note = await notesService.createNote(
      DEST.inbox,
      "# Plan the launch\n\nPick a date.\n\n- [ ] Book the room",
    );
    const result = await handToAiFor(note.id);
    expect(result.kind).toBe("ready");
    if (result.kind === "ready") expect(result.prompt).toContain("- [ ] Book the room");
  });

  test("a secure note is refused and no prompt is built", async () => {
    const note = await notesService.createNote(DEST.inbox, "# Bank\n\nAccount notes.", { secure: true });
    expect(await handToAiFor(note.id)).toEqual({ kind: "secure", title: "Bank" });
  });

  test("a note whose text looks like a secret is refused", async () => {
    // a test card number (Luhn-valid, never a real account)
    const note = await notesService.createNote(DEST.inbox, "# Checkout\n\ncard 4242 4242 4242 4242");
    expect((await handToAiFor(note.id)).kind).toBe("secret");
  });

  test("an empty note has nothing to hand off", async () => {
    const note = await notesService.createNote(DEST.inbox, "   ");
    expect((await handToAiFor(note.id)).kind).toBe("empty");
  });
});
