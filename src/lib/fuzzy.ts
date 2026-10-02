/** Lowercase with diacritics stripped, so "cafe" finds "Café" and "resume"
 * finds "Résumé". For matching only — never for display or offsets (NFD
 * changes the length). */
export function foldText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase();
}

/** Forgiving subsequence match — instant, no scoring: every character of the
 * query appears in the text, in order. Shared by ⌘K, Quick Note, and the
 * slash pickers. */
export function subsequenceMatch(query: string, text: string): boolean {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  let i = 0;
  for (const ch of t) {
    if (ch === q[i]) i++;
    if (i >= q.length) return true;
  }
  return q.length === 0;
}
