// A card or list row shows words, not syntax: `[[target|alias]]` reads as its
// alias (or its target), and the rest of the inline Markdown is stripped.
import { stripMarkdown } from "../editor/stripMarkdown";

export function plainSnippet(snippet: string): string {
  const linked = snippet.replace(
    /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/gu,
    (_match, target: string, alias?: string) => alias ?? target,
  );
  return stripMarkdown(linked);
}
