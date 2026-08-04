// Block structure for a chat message (generative UI, Seth 2026-08-03: replies
// and the notes a chat builds may use tables and diagrams — and the chat must
// SHOW them). Pure text → blocks; the surface renders each kind. Source of
// truth stays the transcript markdown — this is display only, so anything the
// splitter doesn't recognize falls through as plain lines.

export type MessageBlock =
  | { kind: "lines"; lines: string[] }
  | { kind: "code"; lang: string; code: string }
  | { kind: "mermaid"; code: string }
  | { kind: "table"; header: string[]; rows: string[][] };

/** A `| a | b |` row into trimmed cells (outer pipes shed, inner kept). */
function tableCells(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((cell) => cell.trim());
}

/** GFM's delimiter row: `| --- | :---: |` (at least one dash per cell). */
function isTableDelimiter(line: string): boolean {
  const t = line.trim();
  if (!t.startsWith("|") && !t.includes("|")) return false;
  const cells = tableCells(t);
  return cells.length > 0 && cells.every((cell) => /^:?-{1,}:?$/.test(cell));
}

const isTableRow = (line: string): boolean => line.trim().startsWith("|");

/** Split a message into renderable blocks. Fences close on the next ``` line
 * (an unclosed fence runs to the end — the streaming case); a table needs the
 * GFM header + delimiter pair, then eats every following `|` row. */
export function splitMessageBlocks(text: string): MessageBlock[] {
  const out: MessageBlock[] = [];
  const lines = text.split("\n");
  let plain: string[] = [];
  const flushPlain = () => {
    if (plain.length > 0) {
      out.push({ kind: "lines", lines: plain });
      plain = [];
    }
  };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    const fence = /^```(\S*)\s*$/.exec(line.trimStart());
    if (fence) {
      flushPlain();
      const lang = (fence[1] ?? "").toLowerCase();
      const code: string[] = [];
      i++;
      while (i < lines.length && !(lines[i] ?? "").trimStart().startsWith("```")) {
        code.push(lines[i] ?? "");
        i++;
      }
      i++; // past the closing fence (or the end)
      const body = code.join("\n");
      out.push(lang === "mermaid" ? { kind: "mermaid", code: body } : { kind: "code", lang, code: body });
      continue;
    }
    if (isTableRow(line) && isTableDelimiter(lines[i + 1] ?? "")) {
      flushPlain();
      const header = tableCells(line);
      const rows: string[][] = [];
      i += 2; // past header + delimiter
      while (i < lines.length && isTableRow(lines[i] ?? "")) {
        // ragged rows normalize to the header's width — never a jagged render
        const cells = tableCells(lines[i] ?? "");
        rows.push(header.map((_, col) => cells[col] ?? ""));
        i++;
      }
      out.push({ kind: "table", header, rows });
      continue;
    }
    plain.push(line);
    i++;
  }
  flushPlain();
  return out;
}
