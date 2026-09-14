// Pure markdown → rendered text for the clipboard (the "beautified" copy). No
// CodeMirror or React imports, so it unit-tests headless. Drops inline markers
// (**, *, ==, ~~, `, <u>, links→their text) and per-line block prefixes (#, -,
// 1., >, - [ ]) so a copy reads like what you SEE — no stray ** around a bold
// word. Raw mode copies the source verbatim instead.

import { CHOICE_MARK } from "./choiceState";
import { parseChoiceControlLine, parseChoicePromptLine, parseToggleLine } from "./controlState";
import { underscoreEm } from "./inlineEmphasis";
import { linkLabel, MD_LINK_SOURCE } from "./inlineLinks";
import { ORDERED_MARKER_SOURCE } from "./listMarkers";
import { parseResultLine, RESULT_MARK } from "./resultState";
import { MARK } from "./taskState";

const MD_LINK_G = new RegExp(MD_LINK_SOURCE, "g");
const UNDERSCORE_EM_G = underscoreEm("g");
const ORDERED_PREFIX = new RegExp(String.raw`^(\s*)${ORDERED_MARKER_SOURCE}\s+`);

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
        .replace(/<br\s*\/?>/gi, " ")
        .replace(MD_LINK_G, (_m, label: string, url: string) => linkLabel(label, url))
        .replace(/\*([^*\s](?:[^*]*[^*\s])?)\*/g, "$1")
        .replace(UNDERSCORE_EM_G, "$1");
    } while (s !== prev);
    return s;
  };
  return text
    .split("\n")
    .map((line) => {
      const prompt = parseChoicePromptLine(line);
      if (prompt) return inline(`${prompt.indentSource}${prompt.text}`);
      const toggle = parseToggleLine(line);
      if (toggle)
        return inline(
          `${toggle.indentSource}${toggle.on ? toggle.labels[0] : toggle.labels[1]} ${toggle.text}`,
        );
      const choiceControl = parseChoiceControlLine(line);
      if (choiceControl) return inline(`${choiceControl.indentSource}${choiceControl.text}`);
      const result = parseResultLine(line);
      if (result && !result.compact) {
        return inline(
          `${result.indent}${result.options.map((option) => option.label).join(" / ")} ${result.text}`,
        );
      }
      return inline(
        line
          .replace(/^(\s*)#{1,3}\s+/, "$1")
          .replace(new RegExp(`^(\\s*)(?:-|\\d+\\.) \\[${RESULT_MARK}\\]\\[${RESULT_MARK}\\]\\s+`), "$1")
          .replace(new RegExp(`^(\\s*)(?:-|\\d+\\.) \\(${CHOICE_MARK}\\)\\s+`), "$1")
          .replace(new RegExp(`^(\\s*)- \\[${MARK}\\]\\s+`), "$1")
          .replace(/^(\s*)[-*+]\s+/, "$1")
          .replace(ORDERED_PREFIX, "$1")
          .replace(/^(\s*)>\s+/, "$1"),
      );
    })
    .join("\n");
}
