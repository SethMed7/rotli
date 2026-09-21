// The Chat front's view row (the owner, 2026-09-21: "I need ability to toggle
// between views while in chat too"). The same named views Home switches between
// — Main is every chat, a view is the chats assigned to it — picked here without
// leaving Chat. Creating, renaming and deleting views stays in Home's picker.
// Split out of sidebarChat.tsx, which sits at its size budget.

import type { MouseEvent, ReactNode, RefObject } from "react";

import type { MenuSpec } from "../../state/contextMenu";
import { useUiStore } from "../../state/ui";
import { useViewsStore } from "../../state/views";
import { NewChatGlyph } from "../chatWindow/windowGlyphs";
import { ChevronRight, NewFolderGlyph } from "../glyphs";
import { useHomeLeader } from "./useHomeLeader";

interface HeaderAction {
  label: string;
  glyph: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  /** the guided tour's anchor, where it points at this control */
  tour?: string;
}

/** The section header both fronts wear (the owner, 2026-09-21: Chat "should
 * follow same style" as Home's MAIN): the view name as ONE switcher — name +
 * caret, uppercase — then quiet add buttons on the right. */
export function ViewSectionHeader({
  current,
  viewRef,
  onPickView,
  actions,
  groupLabel,
  tour = false,
}: {
  current: string;
  viewRef: RefObject<HTMLButtonElement | null>;
  onPickView: (event: MouseEvent<HTMLButtonElement>) => void;
  actions: HeaderAction[];
  groupLabel?: string;
  tour?: boolean;
}) {
  return (
    <div className="fsec fsec-hdr" {...(groupLabel ? { role: "group", "aria-label": groupLabel } : {})}>
      <button
        type="button"
        className="fsec-view"
        ref={viewRef}
        data-tour={tour ? "views" : undefined}
        title="Change view"
        aria-haspopup="menu"
        aria-label={`Current view: ${current}. Change view`}
        onClick={onPickView}
      >
        <span>{current}</span>
        <span className="caret-down" aria-hidden="true">
          <ChevronRight size={9} />
        </span>
      </button>
      {actions.map((action) => (
        <button
          key={action.label}
          type="button"
          className="fsec-add"
          data-tour={action.tour}
          aria-label={action.label}
          title={action.label}
          disabled={action.disabled}
          onClick={action.onClick}
        >
          {action.glyph}
        </button>
      ))}
    </div>
  );
}

/** Main plus every named view, the current one marked; `numbered` (⌘⇧W) puts
 * ⌘1–9 on the first nine, in the order the view store's slots count them. */
export function chatViewMenuItems(
  views: string[],
  activeView: string | null,
  show: (name: string | null) => void,
  numbered = false,
) {
  const slot = (index: number) => (numbered && index < 9 ? { hint: `⌘${index + 1}` } : {});
  const items: MenuSpec[] = [
    {
      kind: "action",
      label: "Main — all chats",
      checked: activeView === null,
      checkedMark: "highlight",
      onClick: () => show(null),
      ...slot(0),
    },
    ...views.map((name, index) => ({
      kind: "action" as const,
      label: name,
      checked: activeView === name,
      checkedMark: "highlight" as const,
      onClick: () => show(name),
      ...slot(index + 1),
    })),
  ];
  return items;
}

const CHAT_ANSWERS = ["views"] as const;

export function ChatViewPicker({ onNewChat }: { onNewChat: () => void }) {
  const activeView = useUiStore((s) => s.activeView);
  const setActiveView = useUiStore((s) => s.setActiveView);
  const requestSidebarFolder = useUiStore((s) => s.requestSidebarFolder);
  const views = useViewsStore((s) => s.manifest.views);
  const current = activeView ?? "Main";
  const items = (numbered: boolean) =>
    chatViewMenuItems(
      views.map((view) => view.name),
      activeView,
      setActiveView,
      numbered,
    );
  // ⌘⇧W from Chat opens this row's menu, numbered, without leaving Chat
  const { viewsButtonRef, openViewMenu } = useHomeLeader(items, setActiveView, CHAT_ANSWERS);
  return (
    <ViewSectionHeader
      current={current}
      viewRef={viewsButtonRef}
      onPickView={openViewMenu}
      groupLabel="Chat view context"
      actions={[
        { label: `New chat in ${current}`, glyph: <NewChatGlyph size={13} />, onClick: onNewChat },
        {
          label: `New chat folder in ${current}`,
          glyph: <NewFolderGlyph size={13} />,
          onClick: requestSidebarFolder,
        },
      ]}
    />
  );
}
