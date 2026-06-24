// Pure markdown → rendered text for the clipboard (the "beautified" copy). No
// CodeMirror or React imports, so it unit-tests headless. Drops inline markers
// (**, *, ==, ~~, `, <u>, links→their text) and per-line block prefixes (#, -,
// 1., >, - [ ]) so a copy reads like what you SEE — no stray ** around a bold
// word. Raw mode copies the source verbatim instead.
export function stripMarkdown(text: string): string {
  const inline = (s: string): string => {
    let prev: string;
    do {
      prev = s;
      s = s
        .replace(/`([^`]+)`/g, "$1")
        .replace(/\*\*((?:[^*]|\*(?!\*))+)\*\*/g, "$1")
        .replace(/==([^=]+)==/g, "$1")
        .replace(/~~([^~]+)~~/g, "$1")
        .replace(/<\/?u>/g, "")
        .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
        .replace(/\*([^*\s](?:[^*]*[^*\s])?)\*/g, "$1");
    } while (s !== prev);
    return s;
  };
  return text
    .split("\n")
    .map((line) =>
      inline(
        line
          .replace(/^(\s*)#{1,3}\s+/, "$1")
          .replace(/^(\s*)- \[[ xX]\]\s+/, "$1")
          .replace(/^(\s*)[-*+]\s+/, "$1")
          .replace(/^(\s*)\d+\.\s+/, "$1")
          .replace(/^(\s*)>\s+/, "$1"),
      ),
    )
    .join("\n");
}
