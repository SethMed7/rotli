// The sidebar's FRONT switcher (the maintainer, 2026-08-01, from Claude Desktop's
// Home|Code pill): a segmented control directly under the vault header row.
// It REPLACES the stacked "Chat ›" / "Notes ›" accordions — each front now owns
// the whole sidebar body, so nothing has to be folded to make room for anything
// else. Design + rationale: docs/design/sidebar-home-chat.md.
//
// Deliberately a LIST of fronts, not a boolean: Home is "notes essentially and
// eventually a dashboard", and the parked email Inbox is a third front waiting
// in ROADMAP.md. Both arrive as one entry in SIDEBAR_FRONTS.
//
// Breve (2026-09-02) is the third, labelled segment. It is a sidebar MODE
// rather than a front — it swaps the whole sidebar body for its own rail —
// but it lives in the same control so it is findable, named, and one click
// away from Home and Chat in both directions (audit 2026-09-02 §1.3). Before
// this it was an unlabeled coffee icon in the header row with no shortcut.

import { LAUNCH_FEATURES } from "../../lib/featurePolicy";
import { useChatSetupGuide } from "../../state/chatSetupGuide";
import { useHelperLink } from "../../state/helperLink";
import type { ContentView, DashboardSection, SidebarView } from "../../state/ui";
import { ChatGlyph, CoffeeGlyph, HomeGlyph } from "../glyphs";

const SIDEBAR_FRONTS: {
  id: SidebarView;
  label: string;
  Glyph: typeof HomeGlyph;
  hint: string;
  /** The registry action this segment mirrors — hold ⌘ badges the chord onto
   * the segment itself (the maintainer, 2026-08-04). */
  action: string;
}[] = [
  {
    id: "home",
    label: "Home",
    Glyph: HomeGlyph,
    hint: "Your notes — All notes, Captures, Tasks and Main",
    action: "modules.notes",
  },
  {
    id: "chat",
    label: "Chat",
    Glyph: ChatGlyph,
    hint: "Your chats — folders and full history",
    action: "modules.chat",
  },
];

/** A full dashboard is its own selected destination. Keep rendering the last
 * sidebar front underneath it, but do not claim that Home or Chat is the
 * active surface while the overview card is selected. */
export function sidebarFrontSelection(value: SidebarView, contentView: ContentView): SidebarView | null {
  return contentView === "dashboard" ? null : value;
}

/** Each dashboard lens keeps its owning overview card in view. This does not
 * persist a front change until the user explicitly picks Home or Chat. */
export function sidebarFrontBody(
  value: SidebarView,
  contentView: ContentView,
  dashboardSection: DashboardSection,
): SidebarView {
  if (contentView !== "dashboard") return value;
  return dashboardSection === "models" ? "chat" : "home";
}

export function SidebarSwitcher({
  value,
  onPick,
  chatCount,
  breveActive = false,
  onBreve,
}: {
  value: SidebarView | null;
  onPick: (view: SidebarView) => void;
  /** Chats in this vault — a quiet count on the Chat segment, so switching
   * fronts is never a blind jump. Hidden at 0. */
  chatCount: number;
  /** Breve owns the sidebar body right now; Home and Chat read as unselected. */
  breveActive?: boolean;
  /** Present when the Breve segment is offered (the main window). */
  onBreve?: (() => void) | undefined;
}) {
  // Rotli Web: paired with Rotli Helper, chat is a real front
  const helperLinked = useHelperLink((s) => s.link !== null);
  return (
    // role="group" + aria-pressed, NOT a tablist: these segments switch the
    // sidebar's own content, not a tabpanel, and the pane tab strip already
    // owns the one tablist in the window (the app's segmented-control grammar)
    <div className="sb-switch" role="group" aria-label="Sidebar front">
      {SIDEBAR_FRONTS.map(({ id, label, Glyph, hint, action }) => {
        const active = !breveActive && value === id;
        if (id === "chat" && !LAUNCH_FEATURES.chat && !helperLinked) {
          // Rotli Web: chat needs the tools on the user's computer. The front
          // stays visible so the product reads whole, says so on hover, and
          // one click opens the walkthrough that gets it there.
          return (
            <button
              key={id}
              type="button"
              className="sb-switch-seg desktop-only"
              aria-pressed={false}
              title="Chat isn't set up on the web yet — click to see how"
              onClick={() => useChatSetupGuide.getState().show()}
            >
              <Glyph size={14} />
              <span className="sb-switch-label">{label}</span>
            </button>
          );
        }
        return (
          <button
            key={id}
            type="button"
            aria-pressed={active}
            data-tour={id === "chat" ? "chat" : undefined}
            title={hint}
            data-hotkey={action}
            className={active ? "sb-switch-seg sel" : "sb-switch-seg"}
            onClick={() => onPick(id)}
          >
            <Glyph size={14} />
            <span className="sb-switch-label">{label}</span>
            {id === "chat" && chatCount > 0 && <span className="sb-switch-n">{chatCount}</span>}
          </button>
        );
      })}
      {onBreve && (
        <button
          type="button"
          aria-pressed={breveActive}
          title="Breve — your briefs, watchlist, and routines"
          data-hotkey="view.breve"
          className={breveActive ? "sb-switch-seg sel" : "sb-switch-seg"}
          onClick={onBreve}
        >
          <CoffeeGlyph size={14} />
          <span className="sb-switch-label">Breve</span>
        </button>
      )}
    </div>
  );
}
