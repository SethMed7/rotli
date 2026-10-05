/** Human byte size — exact bytes below 1 KB, one decimal above. */
export function formatBytes(len: number): string {
  if (!Number.isFinite(len) || len < 0) return "—";
  if (len < 1024) return `${len} B`;
  const kb = len / 1024;
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
}
