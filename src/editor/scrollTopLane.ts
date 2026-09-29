// Where the scroll-to-top arrow sits beside the centered format bar. Pure so
// the rule is testable without layout.

/** The arrow's corner lane: its 16px inset, 42px width, and an 8px gap. */
const SCROLL_TOP_LANE_PX = 66;
/** With the Librarian pill beside the arrow (2026-09-28): the pill's ~112px
 * and another 8px gap join the lane. */
const WITH_LIBRARIAN_LANE_PX = SCROLL_TOP_LANE_PX + 120;
/** The Quick Note's compact arrow (2026-09-29, the owner: "I don't like it
 * over all that area; probably needs to be smaller"): a 10px inset, 28px
 * wide, and a 6px gap, so it sits in the corner beside the bar instead of
 * rising over the text. */
const QUICK_LANE_PX = 44;

/** True when the centered format bar would reach into the arrow's corner lane
 * (2026-09-23: in a narrow window they overlapped); the arrow then rises
 * above the bar instead. */
export function scrollTopClashes(
  containerWidth: number,
  barWidth: number,
  withLibrarian = false,
  editor?: Pick<Element, "closest"> | null,
): boolean {
  const quick = !!editor?.closest(".quick-window");
  const lane = quick ? QUICK_LANE_PX : withLibrarian ? WITH_LIBRARIAN_LANE_PX : SCROLL_TOP_LANE_PX;
  return barWidth > 0 && (containerWidth - barWidth) / 2 < lane;
}
