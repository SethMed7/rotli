// Line-level three-way merge for an open note whose file changed on disk.
//
// `base` is the body the editor's buffer started from (the last persisted
// body), `mine` is the live buffer, `theirs` is what is on disk now. When the
// two sides touched different lines the result is both edits applied; when
// they touched the same lines there is no honest automatic answer and the
// caller keeps both versions (a conflict copy) instead of guessing.
//
// This is what makes "everything saves instantly" survive the writers that
// are not the editor: a task box ticked from the Tasks view, a chat's
// update_note, the Librarian's metadata pass, another app. Before it, any
// such write under a dirty buffer became a durable revision conflict that
// blocked quitting (Seth, 2026-09-03).

export type MergeResult = { ok: true; merged: string } | { ok: false; reason: string };

type Op = { kind: "same" | "add" | "del"; line: string };

/** Longest-common-subsequence diff of two line arrays → edit script. */
function diffLines(a: readonly string[], b: readonly string[]): Op[] {
  const n = a.length;
  const m = b.length;
  // dp[i][j] = LCS length of a[i..] and b[j..]
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ kind: "same", line: a[i]! });
      i += 1;
      j += 1;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      ops.push({ kind: "del", line: a[i]! });
      i += 1;
    } else {
      ops.push({ kind: "add", line: b[j]! });
      j += 1;
    }
  }
  while (i < n) ops.push({ kind: "del", line: a[i++]! });
  while (j < m) ops.push({ kind: "add", line: b[j++]! });
  return ops;
}

/** A change to one side, anchored to the base line index it starts at:
 * `removed` base lines starting at `at` are replaced by `added`. */
type Hunk = { at: number; removed: number; added: string[] };

function hunks(base: readonly string[], side: readonly string[]): Hunk[] {
  const out: Hunk[] = [];
  let at = 0;
  let current: Hunk | null = null;
  for (const op of diffLines(base, side)) {
    if (op.kind === "same") {
      current = null;
      at += 1;
      continue;
    }
    if (!current) {
      current = { at, removed: 0, added: [] };
      out.push(current);
    }
    if (op.kind === "del") {
      current.removed += 1;
      at += 1;
    } else {
      current.added.push(op.line);
    }
  }
  return out;
}

function overlaps(a: Hunk, b: Hunk): boolean {
  // Two hunks conflict when their base ranges touch. A pure insertion at the
  // same anchor as another change is also ambiguous (which goes first?).
  const aEnd = a.at + Math.max(a.removed, 0);
  const bEnd = b.at + Math.max(b.removed, 0);
  if (a.removed === 0 && b.removed === 0) return a.at === b.at;
  return a.at < bEnd && b.at < aEnd;
}

/** Merge `mine` and `theirs` against `base`. Identical edits on both sides are
 * accepted once; disjoint edits are combined in base order; overlapping edits
 * refuse. Line endings are normalized to `\n` (the editor's own form). */
export function threeWayMerge(base: string, mine: string, theirs: string): MergeResult {
  const norm = (s: string) => s.replace(/\r\n?/g, "\n");
  const b = norm(base);
  const m = norm(mine);
  const t = norm(theirs);
  if (m === t) return { ok: true, merged: m };
  if (b === m) return { ok: true, merged: t };
  if (b === t) return { ok: true, merged: m };
  const baseLines = b.split("\n");
  const mineHunks = hunks(baseLines, m.split("\n"));
  const theirHunks = hunks(baseLines, t.split("\n"));
  const all: Array<Hunk & { side: "mine" | "theirs" }> = [
    ...mineHunks.map((h) => ({ ...h, side: "mine" as const })),
    ...theirHunks.map((h) => ({ ...h, side: "theirs" as const })),
  ].sort((x, y) => x.at - y.at || (x.side === "theirs" ? -1 : 1));
  for (let k = 0; k + 1 < all.length; k += 1) {
    const a = all[k]!;
    const c = all[k + 1]!;
    if (a.side !== c.side && overlaps(a, c)) {
      const same = a.at === c.at && a.removed === c.removed && a.added.join("\n") === c.added.join("\n");
      if (same) {
        all.splice(k + 1, 1); // both sides made the identical edit
        k -= 1;
        continue;
      }
      return { ok: false, reason: `both versions changed line ${a.at + 1}` };
    }
  }
  const out: string[] = [];
  let cursor = 0;
  for (const h of all) {
    while (cursor < h.at) out.push(baseLines[cursor++]!);
    out.push(...h.added);
    cursor += h.removed;
  }
  while (cursor < baseLines.length) out.push(baseLines[cursor++]!);
  return { ok: true, merged: out.join("\n") };
}
