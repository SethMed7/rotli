// The first-run empty state (r1 frame E, copy verbatim) — the ONE place the
// quokka world appears in the app (placement law: onboarding, empty states,
// about; never the editor, never notifications).

import quokka from "../assets/world/quokka-master.jpg";
import { dispatch } from "../keys/registry";
import { PlusGlyph } from "./glyphs";

export function EmptyState() {
  return (
    <div className="empty-stage">
      <img src={quokka} alt="the rotli quokka, relaxed on its island" />
      <div className="et">Your island is ready</div>
      <div className="es">
        Press <kbd>⌥</kbd>
        <kbd>Space</kbd> anywhere on your Mac and the first thought lands here — as a plain file,
        on this Mac, yours.
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
