// The first-run empty state (r1 frame E) — the ONE place the quokka world
// appears in the app (placement law: onboarding, empty states, about; never
// the editor, never notifications). The chord shown is quick capture's LIVE
// binding (⌥C by default — the 2026-06-12 summon law: ⌥Space opens the app,
// capture has its own chord), so a rebind never makes the copy lie.

import quokka from "../assets/world/quokka-master.jpg";
import { resolveChord, useBindingsStore } from "../keys/bindings";
import { formatChord } from "../keys/chords";
import { dispatch, getAction } from "../keys/registry";
import { PlusGlyph } from "./glyphs";

export function EmptyState() {
  const overrides = useBindingsStore((s) => s.overrides);
  const captureChord = resolveChord(
    overrides,
    "capture.summon",
    getAction("capture.summon")?.defaultChord ?? null,
  );
  return (
    <div className="empty-stage">
      <img src={quokka} alt="the rotli quokka, relaxed on its island" />
      <div className="et">Your island is ready</div>
      <div className="es">
        Press <kbd>{formatChord(captureChord ?? "Alt+C")}</kbd> anywhere on your Mac and the first
        thought lands here — as a plain file, on this Mac, yours.
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
