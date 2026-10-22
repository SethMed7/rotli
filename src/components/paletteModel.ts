export function paletteMatchScore(query: string, title: string, body: string): number {
  const q = query.trim().toLocaleLowerCase();
  const name = title.toLocaleLowerCase();
  if (!q) return 100;
  if (name === q) return 0;
  if (name.startsWith(q)) return 10;
  if (name.includes(q)) return 20;
  if (body.toLocaleLowerCase().includes(q)) return 40;
  return 80;
}

export function rankSearchGroups<T extends { score: number }>(groups: readonly T[]): T[] {
  return [...groups].sort((a, b) => a.score - b.score);
}

/** The launcher and open search field describe the same action. */
export function searchActionLabel(breve: boolean): string {
  return breve ? "Search Rotli and actions" : "Search notes and actions";
}
