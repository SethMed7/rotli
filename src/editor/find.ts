export interface TextMatch {
  from: number;
  to: number;
}

export function findTextMatches(text: string, query: string): TextMatch[] {
  const needle = query.toLocaleLowerCase();
  if (!needle) return [];
  const haystack = text.toLocaleLowerCase();
  const matches: TextMatch[] = [];
  for (
    let from = haystack.indexOf(needle);
    from >= 0;
    from = haystack.indexOf(needle, from + Math.max(1, needle.length))
  ) {
    matches.push({ from, to: from + needle.length });
  }
  return matches;
}

export function nextFindMatch(matches: readonly TextMatch[], current: number, delta: 1 | -1): number {
  if (matches.length === 0) return -1;
  return (current + delta + matches.length) % matches.length;
}
