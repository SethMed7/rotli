// Anchored-popover placement law. The regression this pins: the chat model
// picker opened upward with a viewport-relative height cap (62vh) while its
// anchor sat inside a PANE — in a split the composer is mid-window, so the list
// ran past the top edge of the window and came back clipped ("starts mid-air").
// The height budget must come from the anchor's real space, never the window's.

import { describe, expect, test } from "bun:test";
import { anchoredPopover } from "./popover";

const VIEW = { width: 1200, height: 900 };
const SIZE = { width: 280, height: 520 };

describe("anchoredPopover — placement", () => {
  test("plenty of room above → stays up (the composer's preferred side)", () => {
    const p = anchoredPopover({ top: 820, bottom: 844, left: 100 }, SIZE, VIEW);
    expect(p.placement).toBe("up");
    expect(p.top).toBe(820 - 6 - 520);
    expect(p.maxHeight).toBe(820 - 6 - 8);
  });

  test("cramped above with more room below → flips down", () => {
    // a chat pane in the TOP half of a vertical split: its composer sits at
    // y≈430, so only ~416px is above but ~446px is below
    const p = anchoredPopover({ top: 430, bottom: 454, left: 100 }, { ...SIZE, height: 520 }, VIEW);
    expect(p.placement).toBe("down");
    expect(p.top).toBe(454 + 6);
    expect(p.maxHeight).toBe(900 - 454 - 6 - 8);
  });

  test("cramped on BOTH sides keeps the preferred side (no threshold jitter)", () => {
    const p = anchoredPopover({ top: 500, bottom: 524, left: 100 }, { width: 280, height: 5000 }, VIEW);
    expect(p.placement).toBe("up"); // above (486) > below (362): preference holds
    expect(p.maxHeight).toBe(486);
  });

  test("prefer:down flips up only when below is short and above is roomier", () => {
    const opts = { prefer: "down" as const };
    expect(anchoredPopover({ top: 40, bottom: 64, left: 100 }, SIZE, VIEW, opts).placement).toBe("down");
    expect(anchoredPopover({ top: 800, bottom: 824, left: 100 }, SIZE, VIEW, opts).placement).toBe("up");
  });
});

describe("anchoredPopover — the popover never leaves the viewport", () => {
  test("an upward popover taller than its room is capped, not clipped", () => {
    // a full-height pane with a long model list: the composer sits at the
    // window's bottom, so up stays up — but the list is capped at the room it
    // actually has and scrolls inside, instead of running off the top edge
    const p = anchoredPopover({ top: 860, bottom: 884, left: 40 }, { width: 280, height: 2000 }, VIEW);
    expect(p.placement).toBe("up");
    expect(p.maxHeight).toBe(846); // 860 − 6 gap − 8 pad
    expect(p.top).toBe(8); // flush against the pad, never negative
  });

  test("a downward popover taller than its room is capped too", () => {
    const p = anchoredPopover({ top: 60, bottom: 84, left: 40 }, { width: 280, height: 2000 }, VIEW, {
      prefer: "down",
    });
    expect(p.maxHeight).toBe(900 - 84 - 6 - 8);
    expect(p.top + p.maxHeight).toBeLessThanOrEqual(VIEW.height - 8);
  });

  test("an anchor near the right edge slides the popover back inside", () => {
    const p = anchoredPopover({ top: 800, bottom: 824, left: 1150 }, SIZE, VIEW);
    expect(p.left).toBe(1200 - 280 - 8);
  });

  test("a popover wider than the viewport pins to the left pad, never negative", () => {
    const p = anchoredPopover({ top: 800, bottom: 824, left: 10 }, { width: 2000, height: 200 }, VIEW);
    expect(p.left).toBe(8);
  });

  test("an anchor already off the top gets zero room, not a negative height", () => {
    const p = anchoredPopover({ top: -50, bottom: -26, left: 100 }, SIZE, VIEW);
    expect(p.maxHeight).toBeGreaterThanOrEqual(0);
    expect(p.placement).toBe("down"); // nothing above → the only usable side
  });

  test("gap and pad are tunable", () => {
    const p = anchoredPopover({ top: 800, bottom: 824, left: 100 }, SIZE, VIEW, { gap: 0, pad: 20 });
    expect(p.top).toBe(800 - 520);
    expect(p.maxHeight).toBe(780);
  });
});
