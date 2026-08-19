// The first-run empty state (r1 frame E) — one of the quokka-world placements
// (placement law: onboarding, empty states, about; never the editor, never
// notifications). The line-art character tints with the theme. The chord shown
// is quick capture's LIVE
// binding (⌥C by default — the 2026-06-12 summon law: ⌥Space opens the app,
// capture has its own chord), so a rebind never makes the copy lie.

import { resolveChord, useBindingsStore } from "../keys/bindings";
import { formatChord } from "../keys/chords";
import { dispatch, getAction } from "../keys/registry";
import { Character } from "./character";
import { PlusGlyph } from "./glyphs";

export function EmptyState() {
  const overrides = useBindingsStore((s) => s.overrides);
  const captureChord = resolveChord(
    overrides,
    "capture.summon",
    getAction("capture.summon")?.defaultChord ?? null,
  );
  return (
    <div className="list-empty empty-stage">
      <Character name="base" size={150} accessorized />
      <div className="et">Your island is ready</div>
      <div className="es">
        Press <kbd>{formatChord(captureChord ?? "Alt+C")}</kbd> anywhere on your Mac and the first thought
        lands here — as a plain file, on this Mac, yours.
      </div>
      <button type="button" className="btn" onClick={() => dispatch("notes.new")}>
        <PlusGlyph size={14} />
        Write the first note
      </button>
      <div className="ghost">
        or just press <kbd>⌘</kbd>
        <kbd>N</kbd>
      </div>
    </div>
  );
}
