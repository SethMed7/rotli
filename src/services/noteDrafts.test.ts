import { describe, expect, test } from "bun:test";

import { claimClosedNoteDrafts, markNoteDraftSaved, trackNewNoteDraft } from "./noteDrafts";

describe("new-note Main promotion", () => {
  test("waits for the first successful non-empty save", () => {
    const noteId = "session-note-promotes-after-save";
    let promotions = 0;
    trackNewNoteDraft(noteId, () => {
      promotions += 1;
    });

    markNoteDraftSaved(noteId, "   \n");
    expect(promotions).toBe(0);

    markNoteDraftSaved(noteId, "# Authored note\n");
    markNoteDraftSaved(noteId, "# Authored note\n\nMore");
    expect(promotions).toBe(1);
  });

  test("closing an untouched draft cancels its pending Main promotion", () => {
    const noteId = "session-note-closed-before-save";
    let promotions = 0;
    trackNewNoteDraft(noteId, () => {
      promotions += 1;
    });

    expect(claimClosedNoteDrafts([noteId], [])).toEqual([noteId]);
    markNoteDraftSaved(noteId, "# Too late");
    expect(promotions).toBe(0);
  });
});
