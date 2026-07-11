/** Decide which dated brief companions are safe to prune. */
export function shouldPruneBriefFile(file: string, keepDates: Set<string>, managed: boolean): boolean {
  const date = file.match(/^(\d{4}-\d{2}-\d{2})/)?.[1];
  if (!date || keepDates.has(date)) return false;
  // In Rotli, Markdown is the canonical searchable library, not an ephemeral
  // cache. HTML, audio scripts, suggestions, and other companions remain safe
  // to prune because their durable renders live in storage.
  return !(managed && file.endsWith(".md"));
}
