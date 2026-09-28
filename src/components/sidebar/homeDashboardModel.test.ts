import { describe, expect, test } from "bun:test";

import type { NoteSummary } from "../../types";
import { homeDashboardSnapshot } from "./homeDashboardModel";

const note = (id: string, createdAt: number, updatedAt: number): NoteSummary => ({
  id,
  title: id,
  snippet: "",
  folderId: "wiki",
  createdAt,
  updatedAt,
  pinned: false,
});

describe("Home dashboard projection", () => {
  test("projects separate note and chat summaries with a deterministic favorite model", () => {
    const now = Date.UTC(2026, 7, 12);
    const day = 86_400_000;
    expect(
      homeDashboardSnapshot(
        [note("new", now - day, now - day), note("old-edited", now - 30 * day, now - 2 * day)],
        { a: "claude-sonnet", b: "claude-sonnet", c: "gpt-5.6-sol" },
        [
          { slug: "a", modifiedMs: now - day },
          { slug: "b", modifiedMs: now - 2 * day },
          { slug: "c", modifiedMs: now - 20 * day },
        ],
        now,
      ),
    ).toEqual({
      notes: { newInRange: 1, updatedInRange: 2, total: 2 },
      chat: {
        activeInRange: 2,
        total: 3,
        modelsUsed: 2,
        favoriteModelId: "claude-sonnet",
      },
    });
  });

  test("clock-skewed future notes do not inflate the week", () => {
    const now = 10_000_000;
    const hourAhead = now + 3_600_000;
    expect(homeDashboardSnapshot([note("future", hourAhead, hourAhead)], {}, [], now)).toEqual({
      notes: { newInRange: 0, updatedInRange: 0, total: 1 },
      chat: { activeInRange: 0, total: 0, modelsUsed: 0, favoriteModelId: null },
    });
  });

  test("uses the requested dashboard window without changing vault totals", () => {
    const now = Date.UTC(2026, 7, 12);
    const day = 86_400_000;
    expect(
      homeDashboardSnapshot(
        [
          note("today", now - 12 * 60 * 60_000, now - 12 * 60 * 60_000),
          note("week", now - 3 * day, now - 3 * day),
        ],
        {},
        [
          { slug: "today", modifiedMs: now - 12 * 60 * 60_000 },
          { slug: "week", modifiedMs: now - 3 * day },
        ],
        now,
        day,
      ),
    ).toMatchObject({
      notes: { newInRange: 1, updatedInRange: 1, total: 2 },
      chat: { activeInRange: 1, total: 2 },
    });
  });

  // 2026-09-27: `now` is a clock that ticks, so a note created a moment after
  // its last tick (a new vault's Welcome lessons) read as "0 new" until the next
  // tick. Anything since the window opened counts, however recent.
  test("a note or chat from after the clock's last tick still counts", () => {
    const now = Date.UTC(2026, 8, 27);
    const snap = homeDashboardSnapshot(
      [note("just-made", now + 1_500, now + 1_500)],
      {},
      [{ slug: "just-chatted", modifiedMs: now + 900 }],
      now,
    );
    expect(snap.notes.newInRange).toBe(1);
    expect(snap.notes.updatedInRange).toBe(1);
    expect(snap.chat.activeInRange).toBe(1);
  });
});
