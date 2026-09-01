// The hold-⌘ badge placement rules (the maintainer, 2026-08-04). The overlay is a
// READ-ONLY view over the registry, so what's worth testing is the placement
// arithmetic: which tagged controls earn a badge, and where it lands.

import { describe, expect, test } from "bun:test";

import { collectSpots, rectIsBadgeable } from "./hotkeyBadges";

const VIEWPORT = { width: 1440, height: 900 };
const rect = (left: number, top: number, width = 80, height = 28) => ({ left, top, width, height });

describe("rectIsBadgeable", () => {
  test("an on-screen control of real size earns a badge", () => {
    expect(rectIsBadgeable(rect(20, 40), VIEWPORT)).toBe(true);
  });

  test("a hidden control (0×0) never does", () => {
    expect(rectIsBadgeable({ left: 0, top: 0, width: 0, height: 0 }, VIEWPORT)).toBe(false);
  });

  test("a control scrolled out of view — above, left, below, or right — never does", () => {
    expect(rectIsBadgeable(rect(20, -60), VIEWPORT)).toBe(false); // fully above
    expect(rectIsBadgeable(rect(-200, 40), VIEWPORT)).toBe(false); // fully left
    expect(rectIsBadgeable(rect(20, 1200), VIEWPORT)).toBe(false); // below the fold
    expect(rectIsBadgeable(rect(2000, 40), VIEWPORT)).toBe(false); // off the right
  });

  test("a control straddling the top edge still counts — part of it is visible", () => {
    expect(rectIsBadgeable(rect(20, -10), VIEWPORT)).toBe(true);
  });
});

describe("collectSpots", () => {
  const chords: Record<string, string> = { "modules.notes": "Ctrl+1", "modules.chat": "Ctrl+2" };
  const chordOf = (id: string) => chords[id] ?? null;

  test("badges land on their control, formatted in Mac symbols", () => {
    const spots = collectSpots([{ id: "modules.notes", rect: rect(100, 200) }], VIEWPORT, chordOf);
    expect(spots).toEqual([{ id: "modules.notes", chord: "⌃1", left: 102, top: 202, active: false }]);
  });

  test("an UNBOUND action is skipped — a badge must never teach a key that does nothing", () => {
    expect(collectSpots([{ id: "notes.archive", rect: rect(10, 10) }], VIEWPORT, chordOf)).toEqual([]);
  });

  test("one badge per action even when the control is rendered twice", () => {
    const spots = collectSpots(
      [
        { id: "modules.chat", rect: rect(10, 10) },
        { id: "modules.chat", rect: rect(400, 500) },
      ],
      VIEWPORT,
      chordOf,
    );
    expect(spots).toHaveLength(1);
    expect(spots[0]?.left).toBe(12); // the first (on-screen) one wins
  });

  test("a badge never lands at a negative coordinate (a control at the window edge)", () => {
    const spots = collectSpots([{ id: "modules.notes", rect: rect(-4, -4) }], VIEWPORT, chordOf);
    expect(spots[0]?.left).toBe(2);
    expect(spots[0]?.top).toBe(2);
  });

  test("off-screen controls drop out while their on-screen siblings stay", () => {
    const spots = collectSpots(
      [
        { id: "modules.notes", rect: rect(20, 40) },
        { id: "modules.chat", rect: rect(20, 1200) },
      ],
      VIEWPORT,
      chordOf,
    );
    expect(spots.map((s) => s.id)).toEqual(["modules.notes"]);
  });

  test("a tab hidden behind its horizontal scroller edge earns no global badge", () => {
    const spots = collectSpots(
      [
        {
          id: "modules.notes",
          rect: rect(100, 40, 96, 28),
          clips: [rect(240, 30, 600, 40)],
        },
      ],
      VIEWPORT,
      chordOf,
    );
    expect(spots).toEqual([]);
  });

  test("a partially visible tab anchors its badge inside the scroller", () => {
    const spots = collectSpots(
      [
        {
          id: "modules.notes",
          rect: rect(220, 40, 96, 28),
          clips: [rect(240, 30, 600, 60)],
        },
      ],
      VIEWPORT,
      chordOf,
    );
    expect(spots[0]).toMatchObject({ left: 242, top: 42 });
  });

  test("a selected control carries an active badge with the complete chord", () => {
    const spots = collectSpots(
      [{ id: "modules.notes", rect: rect(100, 200), active: true }],
      VIEWPORT,
      () => "Meta+Ctrl+1",
    );
    expect(spots[0]).toEqual({
      id: "modules.notes",
      chord: "⌃⌘1",
      left: 102,
      top: 202,
      active: true,
    });
  });
});
