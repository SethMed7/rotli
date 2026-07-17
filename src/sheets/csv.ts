// Engine-agnostic CSV parse + serialize. The EDIT path must round-trip exactly —
// no type coercion ("007" stays "007"), blank rows kept, nothing sliced.

/** Quote one RFC-4180 cell. */
export function csvCell(s: string): string {
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Parse CSV text EXACTLY — the sheet editor's load path. `delimiter` lets the
 * read-only viewer reuse the same exact parser for TSV. */
export function parseCsvExact(csv: string, delimiter = ","): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };
  let i = 0;
  while (i < csv.length) {
    const ch = csv.charAt(i);
    if (quoted) {
      if (ch === '"') {
        if (csv.charAt(i + 1) === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"' && field === "") {
      quoted = true;
    } else if (ch === delimiter) {
      endField();
    } else if (ch === "\n") {
      endRow();
    } else if (ch === "\r") {
      endRow();
      if (csv.charAt(i + 1) === "\n") i += 1;
    } else {
      field += ch;
    }
    i += 1;
  }
  if (field !== "" || row.length > 0 || quoted) endRow();
  return rows;
}

/** Serialize rows to CSV text — values only. Trailing newline, POSIX-friendly. */
export function csvTextFromRows(rows: string[][]): string {
  if (rows.length === 0) return "";
  return `${rows.map((r) => r.map(csvCell).join(",")).join("\n")}\n`;
}
