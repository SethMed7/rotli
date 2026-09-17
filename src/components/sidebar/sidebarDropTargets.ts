// An image dragged onto the SIDEBAR (the owner, 2026-09-17: "drag image into
// left menu for the chat area or even a note — in note it will open note I am
// hovering over; in chat it will drop image in the one I am hovering over
// then open it"). Two pure pieces the drop listener composes:
//
//   • which row is under the pointer — a chat row (`data-chat-slug`) or a
//     Main note row (`data-note-id`) — so the drop can open it;
//   • the spring-open: a note row held under a hovering image opens after a
//     short dwell (Finder's spring-loaded folders), so the drop can land in
//     the note itself. A chat row never springs; it takes the drop directly.

/** The row shape the listener needs: a DOM Element in the app, a stub in
 * tests. The attribute setters are for the hover cue (DropCueMarker). */
interface RowLike {
  closest(selector: string): RowLike | null;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
}

export type SidebarDropTarget =
  | { kind: "chat"; slug: string; row: RowLike }
  | { kind: "note"; id: string; row: RowLike };

export const CHAT_ROW_ATTR = "data-chat-slug";
export const NOTE_ROW_ATTR = "data-note-id";

// SIDEBAR rows only: data-note-id also marks All-notes rows and the Library
// browser's tiles, which must not spring open under a passing drag
const CHAT_ROW = `.sb-chatrow[${CHAT_ROW_ATTR}]`;
const NOTE_ROW = `.main-row[${NOTE_ROW_ATTR}]`;

/** The sidebar row under this element, if it is one that takes a drop. */
export function sidebarDropTargetAt(element: RowLike | null): SidebarDropTarget | null {
  if (!element) return null;
  const chat = element.closest(CHAT_ROW);
  const slug = chat?.getAttribute(CHAT_ROW_ATTR);
  if (chat && slug) return { kind: "chat", slug, row: chat };
  const note = element.closest(NOTE_ROW);
  const id = note?.getAttribute(NOTE_ROW_ATTR);
  if (note && id) return { kind: "note", id, row: note };
  return null;
}

/** A stable identity for a target, for the spring-open's "same row?" check. */
export function dropTargetKey(target: SidebarDropTarget): string {
  return target.kind === "chat" ? `chat:${target.slug}` : `note:${target.id}`;
}

/** How long an image must hover a note row before it opens. */
export const SPRING_OPEN_MS = 550;

type Schedule = (run: () => void, ms: number) => () => void;

const timerSchedule: Schedule = (run, ms) => {
  const id = setTimeout(run, ms);
  return () => clearTimeout(id);
};

/** Spring-loaded open: `hover(key, open)` on every hover tick; the same key
 * keeps one timer running, a new key restarts it, `leave()` cancels. `open`
 * fires once per dwell. */
export class SpringOpen {
  private key: string | null = null;
  private cancel: (() => void) | null = null;

  constructor(
    private readonly dwellMs: number = SPRING_OPEN_MS,
    private readonly schedule: Schedule = timerSchedule,
  ) {}

  hover(key: string, open: () => void): void {
    if (this.key === key) return;
    this.leave();
    this.key = key;
    this.cancel = this.schedule(() => {
      this.cancel = null;
      open();
    }, this.dwellMs);
  }

  leave(): void {
    this.cancel?.();
    this.cancel = null;
    this.key = null;
  }
}
