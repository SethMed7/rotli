// The chat composer's "/" command menu and "@" note picker. Focus never leaves
// the textarea: the list is a listbox the textarea points into with
// aria-activedescendant, and a polite live region says how many rows match.

import { type KeyboardEvent, useId, useState } from "react";

import type { NoteSummary } from "../../types";
import { LockGlyph } from "../glyphs";
import {
  type ChatCommand,
  type ChatCommandId,
  type ComposerTrigger,
  composerTrigger,
  filterChatCommands,
  filterMentionNotes,
  removeTrigger,
  replaceTrigger,
} from "./chatComposerMenuModel";

export type ComposerPick = { kind: "command"; id: ChatCommandId } | { kind: "mention"; note: NoteSummary };

type MenuRows = { kind: "command"; rows: ChatCommand[] } | { kind: "mention"; rows: NoteSummary[] };

export interface ComposerMenu {
  trigger: ComposerTrigger;
  menu: MenuRows;
  active: number;
  listId: string;
  optionId: (index: number) => string;
  pick: (index: number) => void;
}

export function useComposerMenu(opts: {
  text: string;
  available: ReadonlySet<ChatCommandId>;
  /** Notes the @ picker offers; null turns @ off (the chat already has a note). */
  notes: readonly NoteSummary[] | null;
  setText: (text: string) => void;
  onPick: (pick: ComposerPick) => void;
}) {
  const { text, available, notes, setText, onPick } = opts;
  const listId = useId();
  const inputId = useId();
  const [caret, setCaret] = useState(0);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const [cursor, setCursor] = useState({ key: "", index: 0 });

  const found = composerTrigger(text, Math.min(caret, text.length));
  const trigger =
    found && found.from !== dismissedAt && (found.kind === "command" || notes !== null) ? found : null;
  const menu: MenuRows | null = !trigger
    ? null
    : trigger.kind === "command"
      ? { kind: "command", rows: filterChatCommands(trigger.query, available) }
      : { kind: "mention", rows: filterMentionNotes(trigger.query, notes ?? []) };
  const key = trigger ? `${trigger.kind}:${trigger.from}:${trigger.query}` : "";
  const count = menu?.rows.length ?? 0;
  const active = cursor.key === key ? Math.min(cursor.index, Math.max(count - 1, 0)) : 0;
  const optionId = (index: number) => `${listId}-${index}`;

  /** Read the caret after every edit, click or arrow inside the textarea. */
  const sync = (el: HTMLTextAreaElement) => {
    setCaret(el.selectionStart);
    const next = composerTrigger(el.value, el.selectionStart);
    if (!next || next.from !== dismissedAt) setDismissedAt(null);
  };

  const placeCaret = (next: { text: string; caret: number }) => {
    setText(next.text);
    setCaret(next.caret);
    requestAnimationFrame(() => {
      const el = document.getElementById(inputId);
      if (!(el instanceof HTMLTextAreaElement)) return;
      el.focus();
      el.setSelectionRange(next.caret, next.caret);
    });
  };

  const pick = (index: number) => {
    if (!trigger || !menu) return;
    if (menu.kind === "command") {
      const command = menu.rows[index];
      if (!command) return;
      // /attach hands over to the @ picker in place
      if (command.id === "attach") return placeCaret(replaceTrigger(text, trigger, "@"));
      placeCaret(removeTrigger(text, trigger));
      onPick({ kind: "command", id: command.id });
      return;
    }
    const note = menu.rows[index];
    if (!note) return;
    placeCaret(removeTrigger(text, trigger));
    onPick({ kind: "mention", note });
  };

  /** True when the menu took the key; the composer's own Enter-sends must not run. */
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!trigger || !menu || event.nativeEvent.isComposing) return false;
    const move = (step: number) => {
      event.preventDefault();
      if (count > 0) setCursor({ key, index: (active + step + count) % count });
      return true;
    };
    switch (event.key) {
      case "ArrowDown":
        return move(1);
      case "ArrowUp":
        return move(-1);
      case "Escape":
        event.preventDefault();
        setDismissedAt(trigger.from);
        return true;
      case "Tab":
        if (event.shiftKey || count === 0) return false;
        event.preventDefault();
        if (menu.kind === "command") {
          const name = `/${menu.rows[active]!.label}`;
          placeCaret(replaceTrigger(text, trigger, name));
        } else pick(active);
        return true;
      case "Enter":
        // nothing matches: Enter sends the text as typed
        if (event.shiftKey || count === 0) return false;
        event.preventDefault();
        pick(active);
        return true;
      default:
        return false;
    }
  };

  const open: ComposerMenu | null =
    trigger && menu ? { trigger, menu, active, listId, optionId, pick } : null;
  return {
    open,
    sync,
    onKeyDown,
    /** Spread on the textarea: it points into the list while the list is up. */
    inputProps: {
      id: inputId,
      "aria-controls": open ? listId : undefined,
      "aria-activedescendant": open && count > 0 ? optionId(active) : undefined,
    },
  };
}

const KIND_LABEL = { command: "Chat commands", mention: "Notes to talk about" } as const;

export function ComposerMenuList({ menu }: { menu: ComposerMenu }) {
  const { trigger, menu: rows, active, listId, optionId, pick } = menu;
  const count = rows.rows.length;
  const sigil = trigger.kind === "command" ? "/" : "@";
  const noun = trigger.kind === "command" ? "command" : "note";
  const announce =
    count === 0 ? `No ${noun} matches ${sigil}${trigger.query}` : `${count} ${noun}${count === 1 ? "" : "s"}`;
  return (
    <div className="slashmenu chat-cmdmenu">
      <span className="sr-only" role="status" aria-live="polite">
        {announce}
      </span>
      <div id={listId} role="listbox" aria-label={KIND_LABEL[trigger.kind]}>
        {rows.kind === "command"
          ? rows.rows.map((command, index) => (
              <div
                key={command.id}
                id={optionId(index)}
                role="option"
                aria-selected={index === active}
                className={index === active ? "slashrow sel" : "slashrow"}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => pick(index)}
              >
                <span className="slashglyph" aria-hidden="true">
                  /
                </span>
                <span className="slashlabel">{command.label}</span>
                <span className="slashhint">{command.hint}</span>
              </div>
            ))
          : rows.rows.map((note, index) => (
              <div
                key={note.id}
                id={optionId(index)}
                role="option"
                aria-selected={index === active}
                className={index === active ? "slashrow sel" : "slashrow"}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => pick(index)}
              >
                <span className="slashglyph" aria-hidden="true">
                  {note.secure ? <LockGlyph size={14} /> : "@"}
                </span>
                <span className="slashlabel">{note.title || "Untitled"}</span>
                {note.secure && <span className="slashhint">Secure · on-device models only</span>}
              </div>
            ))}
      </div>
      {count === 0 && (
        <div className="slashmenu-empty" aria-hidden="true">
          <div>
            No {noun} matches “{sigil}
            {trigger.query}”
          </div>
          {trigger.kind === "command" && <span>⏎ sends it as text</span>}
        </div>
      )}
    </div>
  );
}

/** The note an @ pick will attach, removable until the message is sent. */
export function PendingNoteChip({
  title,
  secure,
  onRemove,
}: {
  title: string;
  secure: boolean;
  onRemove: () => void;
}) {
  const name = title || "Untitled";
  return (
    <div className="chat-attach-chip">
      {secure && <LockGlyph size={12} />}
      <span className="chat-attach-chip-name" title={name}>
        {name}
      </span>
      {secure && <span className="chat-attach-chip-note">on-device only</span>}
      <button type="button" className="chat-attach-chip-x" aria-label={`Remove ${name}`} onClick={onRemove}>
        ×
      </button>
    </div>
  );
}
