// Editor area placeholder — the 1b agent replaces the internals; the seam is
// this one component taking a noteId. Gate editor padding/measure (r2 frame A),
// floating status pill instead of an attached footer (r4, approved). Body
// renders as plain pre-wrap text until the hand-rolled markdown editor lands.

import { useNote } from "../services/hooks";

function createdLabel(ts: number): string {
  const d = new Date(ts);
  return `${d.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })} · ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
}

function updatedLabel(ts: number): string {
  const mins = Math.round((Date.now() - ts) / 60_000);
  if (mins < 1) return "updated just now";
  if (mins < 60) return `updated ${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `updated ${hrs} hr ago`;
  return `updated ${Math.round(hrs / 24)}d ago`;
}

/** Body without the leading title heading (the title renders separately). */
function bodyWithoutTitle(body: string): string {
  const lines = body.split("\n");
  if (lines[0]?.startsWith("#")) return lines.slice(1).join("\n").replace(/^\n+/, "");
  return body;
}

export function EditorSurface({ noteId }: { noteId: string }) {
  const note = useNote(noteId).data;
  if (!note) return <div className="editor" />;

  return (
    <div className="editor">
      <div className="ed-head">{createdLabel(note.createdAt)}</div>
      <h1 className="ed-title">{note.title}</h1>
      <div className="ed-scroll">
        <pre className="ed-body ed-plain">{bodyWithoutTitle(note.body)}</pre>
      </div>
      <div className="statpill">
        <span className="dot-ok" />
        On this Mac
        <span className="sep" />
        {note.body.length.toLocaleString()} characters
        <span className="sep" />
        {updatedLabel(note.updatedAt)}
      </div>
    </div>
  );
}
