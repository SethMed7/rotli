// Which line a jump should land on. Pure, and apart from lineJump.ts because
// @codemirror/view needs a DOM to load and this is the part worth unit-testing.

/** The 0-based body line that holds `words`, preferring `line` itself and
 * falling back to the nearest line containing them. -1 when none does. */
export function resolveLine(lines: readonly string[], line: number, words: string): number {
  const probe = words.trim().slice(0, 24);
  if (probe === "") return -1;
  if (lines[line]?.includes(probe)) return line;
  let best = -1;
  lines.forEach((text, index) => {
    if (!text.includes(probe)) return;
    if (best === -1 || Math.abs(index - line) < Math.abs(best - line)) best = index;
  });
  return best;
}
