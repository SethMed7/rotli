// exceljs ARGB ↔ #rrggbb — shared by the bridge; no Univer imports.

/** exceljs ARGB "FFRRGGBB" → "#rrggbb". */
export function hexFromArgb(argb: string | undefined | null): string | null {
  if (!argb || argb.length < 6) return null;
  const rgb = argb.length === 8 ? argb.slice(2) : argb;
  if (!/^[0-9a-fA-F]{6}$/.test(rgb)) return null;
  return `#${rgb.toLowerCase()}`;
}
