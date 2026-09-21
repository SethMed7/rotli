// Hover a `[[link]]` and read the top of that note without opening it (1.3.0).
// A local read of a note the person could open anyway — no model, no network.
// A SECURE note never shows its text in a card: a hover is easy to do by
// accident and a screen may be shared, so the card only names it.
//
// The card is static (no animation — a hidden window must not composite) and
// never takes the pointer's click: the link still opens on click.

import { type Extension } from "@codemirror/state";
import { hoverTooltip, type Tooltip } from "@codemirror/view";

import { notesService } from "../services/notes";
import type { NoteSummary } from "../types";
import { wikilinkNotes, resolveWikilinkTarget } from "./wikilinkIndex";
import { previewText, wikilinkAt } from "./wikilinkPreview";

const HOVER_MS = 350;
const CACHE_MAX = 40;

// keyed by id, valid for one `updatedAt` — an edit to the target re-reads it
const cache = new Map<string, { updatedAt: number; text: string }>();

async function readPreview(note: NoteSummary): Promise<string> {
  const hit = cache.get(note.id);
  if (hit && hit.updatedAt === note.updatedAt) return hit.text;
  const doc = await notesService.getNote(note.id);
  const text = doc ? previewText(doc.body, note.title) : "";
  cache.delete(note.id);
  cache.set(note.id, { updatedAt: note.updatedAt, text });
  const oldest = cache.keys().next().value;
  if (cache.size > CACHE_MAX && oldest !== undefined) cache.delete(oldest);
  return text;
}

function card(note: NoteSummary): HTMLElement {
  const dom = document.createElement("div");
  dom.className = "rotli-linkcard";
  const title = document.createElement("div");
  title.className = "rotli-linkcard-title";
  title.textContent = note.title || "Untitled";
  const body = document.createElement("div");
  body.className = "rotli-linkcard-body";
  dom.append(title, body);

  const say = (text: string, quiet = false) => {
    body.textContent = text;
    body.classList.toggle("is-quiet", quiet);
  };
  const kind = note.kind ?? "note";
  if (note.secure) say("Secure note — open it to read.", true);
  else if (kind !== "note") say(kind === "board" ? "Board" : "File", true);
  else {
    say("…", true);
    void readPreview(note).then(
      (text) => (text ? say(text) : say("Nothing under the title yet.", true)),
      () => say("Couldn’t read this note.", true),
    );
  }
  return dom;
}

export const wikilinkHover: Extension = hoverTooltip(
  (view, pos): Tooltip | null => {
    const line = view.state.doc.lineAt(pos);
    const span = wikilinkAt(line.text, pos - line.from);
    if (!span) return null;
    const id = resolveWikilinkTarget(span.target);
    const note = id ? wikilinkNotes().find((candidate) => candidate.id === id) : undefined;
    if (!note) return null; // an unresolved link keeps its plain "nowhere to go" title
    return {
      pos: line.from + span.from,
      end: line.from + span.to,
      above: true,
      create: () => ({ dom: card(note) }),
    };
  },
  { hoverTime: HOVER_MS },
);
