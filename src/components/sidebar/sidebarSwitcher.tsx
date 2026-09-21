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
import { chatWindowSupported, focusChatWindow } from "../../services/chatWindowShell";
import { useChatSetupGuide } from "../../state/chatSetupGuide";
import { popOutChat, regroupChat } from "../../state/chatWindow";
import { useChatWindowStore } from "../../state/chatWindowStore";
import { useContextMenu } from "../../state/contextMenu";
import { helperReadyFrom, useHelperLink } from "../../state/helperLink";
import { type ContentView, type DashboardSection, type SidebarView, useUiStore } from "../../state/ui";
import { PopOutGlyph, RegroupGlyph } from "../chatWindow/windowGlyphs";
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
  breveActive = false,
  onBreve,
}: {
  value: SidebarView | null;
  onPick: (view: SidebarView) => void;
  /** Breve owns the sidebar body right now; Home and Chat read as unselected. */
  breveActive?: boolean;
  /** Present when the Breve segment is offered (the main window). */
  onBreve?: (() => void) | undefined;
}) {
  // Rotli Web: paired with Rotli Helper, chat is a real front
  const helperOk = useHelperLink((s) => helperReadyFrom(s));
  const helperProblem = useHelperLink((s) => s.problem);
  const helperVerifying = useHelperLink((s) => s.verifying);
  // Pull Chat out into its own window: the Mac app only, and in the work
  const chatWindow = chatWindowSupported();
  const chatDetached = useChatWindowStore((s) => s.detached);
  const openContextMenu = useContextMenu((s) => s.open);
  const pullChatOut = () => {
    const blocked = popOutChat();
    if (blocked) useUiStore.getState().setRowActionError(blocked);
    // Chat left this window: its front has nothing to show here
    else if (value === "chat") onPick("home");
  };
  return (
    // role="group" + aria-pressed, NOT a tablist: these segments switch the
    // sidebar's own content, not a tabpanel, and the pane tab strip already
    // owns the one tablist in the window (the app's segmented-control grammar)
    <div className="sb-switch" role="group" aria-label="Sidebar front">
      {SIDEBAR_FRONTS.map(({ id, label, Glyph, hint, action }) => {
        const active = !breveActive && value === id;
        if (id === "chat" && !LAUNCH_FEATURES.chat && !helperOk) {
          // Rotli Web: chat needs the tools on the user's computer. The front
          // stays visible so the product reads whole, says so on hover, and
          // one click opens the walkthrough that gets it there — also when a
          // pairing exists but the helper is silent or refuses the token.
          return (
            <button
              key={id}
              type="button"
              className="sb-switch-seg desktop-only"
              aria-pressed={false}
              title={
                helperProblem === "refused"
                  ? "Rotli Helper refused the pairing — click to pair again"
                  : helperProblem === "unreachable"
                    ? "Rotli Helper isn't answering — click to reconnect"
                    : helperVerifying
                      ? "Checking Rotli Helper…"
                      : "Chat isn't set up on the web yet — click to see how"
              }
              onClick={() => useChatSetupGuide.getState().show()}
            >
              <Glyph size={14} />
              <span className="sb-switch-label">{label}</span>
            </button>
          );
        }
        if (id === "chat" && chatWindow) {
          // Chat can live in its own window (1.3.0). The segment and its small
          // companion button are SIBLINGS — a button cannot hold a button. Out:
          // the segment brings that window forward and the companion puts Chat
          // back. In: the companion (on hover/focus) or the context menu pulls
          // it out. Home has no such control: main is where Home lives.
          return (
            <span key={id} className={chatDetached ? "sb-switch-chat out" : "sb-switch-chat"}>
              <button
                type="button"
                aria-pressed={!chatDetached && active}
                data-tour="chat"
                title={chatDetached ? "Chat is in its own window — click to bring it forward" : hint}
                data-hotkey={action}
                className={!chatDetached && active ? "sb-switch-seg sel" : "sb-switch-seg"}
                onClick={() => (chatDetached ? focusChatWindow() : onPick(id))}
                onContextMenu={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  openContextMenu(event.clientX, event.clientY, [
                    chatDetached
                      ? { kind: "action", label: "Put Chat back in this window", onClick: regroupChat }
                      : { kind: "action", label: "Pull Chat out into its own window", onClick: pullChatOut },
                  ]);
                }}
              >
                <Glyph size={14} />
                <span className="sb-switch-label">{label}</span>
              </button>
              <button
                type="button"
                className="sb-switch-window"
                aria-label={
                  chatDetached ? "Put Chat back in this window" : "Pull Chat out into its own window"
                }
                title={chatDetached ? "Put Chat back in this window" : "Pull Chat out into its own window"}
                onClick={chatDetached ? regroupChat : pullChatOut}
              >
                {chatDetached ? <RegroupGlyph size={12} /> : <PopOutGlyph size={12} />}
              </button>
            </span>
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
