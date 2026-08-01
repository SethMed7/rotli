// The sidebar's FRONT switcher (Seth, 2026-08-01, from Claude Desktop's
// Home|Code pill): a two-segment control directly under the vault header row.
// It REPLACES the stacked "Chat ›" / "Notes ›" accordions — each front now owns
// the whole sidebar body, so nothing has to be folded to make room for anything
// else. Design + rationale: docs/design/sidebar-home-chat.md.
//
// Deliberately a LIST of fronts, not a boolean: Home is "notes essentially and
// eventually a dashboard", and the parked email Inbox is a third front waiting
// in ROADMAP.md. Both arrive as one entry in SIDEBAR_FRONTS.

import type { SidebarView } from "../../state/ui";
import { ChatGlyph, HomeGlyph } from "../glyphs";

const SIDEBAR_FRONTS: {
  id: SidebarView;
  label: string;
  Glyph: typeof HomeGlyph;
  hint: string;
}[] = [
  { id: "home", label: "Home", Glyph: HomeGlyph, hint: "Your notes — All notes, Captures, Tasks and Main" },
  { id: "chat", label: "Chat", Glyph: ChatGlyph, hint: "Your chats — folders and full history" },
];

export function SidebarSwitcher({
  value,
  onPick,
  chatCount,
}: {
  value: SidebarView;
  onPick: (view: SidebarView) => void;
  /** Chats in this vault — a quiet count on the Chat segment, so switching
   * fronts is never a blind jump. Hidden at 0. */
  chatCount: number;
}) {
  return (
    // role="group" + aria-pressed, NOT a tablist: these segments switch the
    // sidebar's own content, not a tabpanel, and the pane tab strip already
    // owns the one tablist in the window (the app's segmented-control grammar)
    <div className="sb-switch" role="group" aria-label="Sidebar front">
      {SIDEBAR_FRONTS.map(({ id, label, Glyph, hint }) => {
        const active = value === id;
        return (
          <button
            key={id}
            type="button"
            aria-pressed={active}
            title={hint}
            className={active ? "sb-switch-seg sel" : "sb-switch-seg"}
            onClick={() => onPick(id)}
          >
            <Glyph size={14} />
            <span className="sb-switch-label">{label}</span>
            {id === "chat" && chatCount > 0 && <span className="sb-switch-n">{chatCount}</span>}
          </button>
        );
      })}
    </div>
  );
}
