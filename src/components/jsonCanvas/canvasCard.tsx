// One card on the Canvas (split from canvasEditor.tsx, 2026-10-06): a text
// card, a note's card, a link, a group's frame, or a card from another app.
// Connect dots and the resize corner show only where attention already is.

import type { CSSProperties } from "react";

import { type CanvasNode, type CanvasSide, colorName, fileTitle } from "../../jsonCanvas/model";
import { MarkdownPeek } from "../markdownPeek";

export interface CanvasNoteView {
  title: string;
  /** null while the body loads. */
  body: string | null;
  /** Title shows, text never does — a screen may be shared. */
  secure: boolean;
}

/** What is being typed into: a text card's text, or a group's or line's name. */
export type CanvasEditing = { id: string; field: "text" | "label" } | null;

const SIDES: readonly CanvasSide[] = ["top", "right", "bottom", "left"];

export function cardLabel(node: CanvasNode, note: CanvasNoteView | null): string {
  const color = colorName(node.color);
  const tint = color ? `, ${color}` : "";
  switch (node.type) {
    case "text":
      return `Text card${tint}: ${node.text.split("\n")[0]?.replace(/^#+\s*/, "") || "empty"}`;
    case "file":
      return `Note card${tint}: ${note?.title ?? `${fileTitle(node.file)} (missing)`}`;
    case "link":
      return `Link card${tint}: ${node.url}`;
    case "group":
      return `Group${tint}: ${node.label ?? "untitled"}`;
    case "unknown":
      return `Card from another app (${node.rawType})`;
  }
}

/** The one-line field a group or a line is named in: Enter keeps, Esc drops. */
export function LabelField({
  value,
  onDraft,
  onCommit,
  onCancel,
  label,
  className,
}: {
  value: string;
  onDraft: (text: string) => void;
  onCommit: () => void;
  onCancel: () => void;
  label: string;
  className: string;
}) {
  return (
    <input
      className={className}
      value={value}
      placeholder="Name"
      autoFocus
      aria-label={label}
      onChange={(event) => onDraft(event.target.value)}
      onBlur={onCommit}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        if (event.key === "Enter") onCommit();
        else onCancel();
      }}
    />
  );
}

export function Card({
  node,
  note,
  selected,
  editing,
  draft,
  onDraft,
  onCommit,
  onCancel,
  onFocus,
}: {
  node: CanvasNode;
  note: CanvasNoteView | null;
  selected: boolean;
  /** Which of this card's fields is being typed into, if any. */
  editing: "text" | "label" | null;
  draft: string;
  onDraft: (text: string) => void;
  onCommit: () => void;
  onCancel: () => void;
  onFocus: () => void;
}) {
  const custom = node.color && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(node.color) ? node.color : null;
  const style = {
    left: node.x,
    top: node.y,
    width: node.width,
    height: node.height,
    ...(custom ? { "--card-colour": custom } : {}),
  } as CSSProperties;
  const className = `jc-card jc-${node.type}${selected ? " is-selected" : ""}${node.color ? " has-color" : ""}`;
  return (
    <div
      className={className}
      style={style}
      data-card-id={node.id}
      data-colour={node.color && /^[1-6]$/.test(node.color) ? node.color : undefined}
      tabIndex={0}
      role="group"
      aria-roledescription="card"
      aria-label={cardLabel(node, note)}
      onFocus={(event) => event.target === event.currentTarget && onFocus()}
    >
      {node.type === "group" &&
        (editing === "label" ? (
          <LabelField
            className="jc-group-label jc-label-edit"
            value={draft}
            onDraft={onDraft}
            onCommit={onCommit}
            onCancel={onCancel}
            label="Group name"
          />
        ) : (
          <span className="jc-group-label" data-group-label="true">
            {node.label ?? ""}
          </span>
        ))}
      {node.type === "text" &&
        (editing === "text" ? (
          <textarea
            className="jc-text-edit"
            value={draft}
            autoFocus
            aria-label="Card text"
            onChange={(event) => onDraft(event.target.value)}
            onBlur={onCommit}
          />
        ) : (
          <div className="jc-body">
            <MarkdownPeek body={node.text} className="pv-note jc-md" />
          </div>
        ))}
      {node.type === "file" && (
        <div className="jc-body">
          <p className="jc-note-title">{note?.title ?? fileTitle(node.file)}</p>
          {note === null ? (
            <p className="jc-quiet">This note isn’t in the vault anymore. The card keeps its place.</p>
          ) : note.secure ? (
            <p className="jc-quiet">Secure note. Open it to read.</p>
          ) : note.body === null ? (
            <p className="jc-quiet">Loading…</p>
          ) : (
            <MarkdownPeek body={note.body.replace(/^#\s.*\n+/, "")} className="pv-note jc-md" />
          )}
        </div>
      )}
      {node.type === "link" && (
        <div className="jc-body">
          <p className="jc-note-title">{node.url}</p>
        </div>
      )}
      {node.type === "unknown" && (
        <div className="jc-body">
          <p className="jc-quiet">Made in another app. Rotli keeps it as it is.</p>
        </div>
      )}
      {node.type !== "group" &&
        SIDES.map((side) => (
          <span key={side} className={`jc-dot jc-dot-${side}`} data-handle="connect" aria-hidden="true" />
        ))}
      <span className="jc-resize" data-handle="resize" aria-hidden="true" />
    </div>
  );
}
