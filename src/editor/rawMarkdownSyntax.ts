// Pure raw-Markdown syntax classification. Kept DOM- and CodeMirror-view-free
// so source highlighting stays deterministic in offline unit tests.

import type { Text } from "@codemirror/state";

import { MD_LINK_SOURCE } from "./inlineLinks";

export interface RawMarkdownToken {
  from: number;
  to: number;
  className: string;
}

export interface RawMarkdownLineStyle {
  from: number;
  className: string;
}

export interface RawMarkdownClassification {
  tokens: RawMarkdownToken[];
  lines: RawMarkdownLineStyle[];
}

function matches(text: string, re: RegExp, visit: (match: RegExpExecArray) => void): void {
  re.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) != null) {
    visit(match);
    if (match[0].length === 0) re.lastIndex++;
  }
}

export function classifyRawMarkdown(doc: Text): RawMarkdownClassification {
  const tokens: RawMarkdownToken[] = [];
  const lines: RawMarkdownLineStyle[] = [];
  let inFence = false;

  const token = (lineFrom: number, from: number, to: number, className: string) => {
    if (to > from) tokens.push({ from: lineFrom + from, to: lineFrom + to, className });
  };

  for (let number = 1; number <= doc.lines; number++) {
    const line = doc.line(number);
    const text = line.text;
    const fence = /^(\s*)(```)(.*)$/.exec(text);
    if (fence) {
      lines.push({ from: line.from, className: "rotli-raw-code-line" });
      const markerFrom = (fence[1] ?? "").length;
      token(line.from, markerFrom, markerFrom + 3, "rotli-raw-accent");
      const infoFrom = markerFrom + 3;
      token(line.from, infoFrom, text.length, "rotli-raw-blue");
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      lines.push({ from: line.from, className: "rotli-raw-code-line" });
      token(line.from, 0, text.length, "rotli-raw-code-text");
      continue;
    }

    const heading = /^(\s{0,3})(#{1,6})(\s+)(.*)$/.exec(text);
    if (heading) {
      const markerFrom = (heading[1] ?? "").length;
      const markerTo = markerFrom + (heading[2] ?? "").length;
      token(line.from, markerFrom, markerTo, "rotli-raw-accent");
      token(line.from, markerTo, text.length, "rotli-raw-heading");
    }

    const quote = /^(\s*)(>+)(\s?)/.exec(text);
    if (quote) {
      lines.push({ from: line.from, className: "rotli-raw-quote-line" });
      const from = (quote[1] ?? "").length;
      token(line.from, from, from + (quote[2] ?? "").length, "rotli-raw-accent");
    }

    const list = /^(\s*)([-+*]|\d+[.)])(\s+)/.exec(text);
    if (list) {
      const from = (list[1] ?? "").length;
      token(line.from, from, from + (list[2] ?? "").length, "rotli-raw-accent");
    }
    matches(text, /\[[ xX]\]/g, (match) =>
      token(line.from, match.index, match.index + match[0].length, "rotli-raw-accent"),
    );

    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(text)) {
      token(line.from, 0, text.length, "rotli-raw-accent");
    }
    if (/^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(text)) {
      token(line.from, 0, text.length, "rotli-raw-muted");
    } else {
      matches(text, /\|/g, (match) => token(line.from, match.index, match.index + 1, "rotli-raw-accent"));
    }

    matches(text, /\[\[[^\]]+\]\]/g, (match) =>
      token(line.from, match.index, match.index + match[0].length, "rotli-raw-accent"),
    );
    matches(text, /\*\*(?:[^*]|\*(?!\*))+?\*\*/g, (match) =>
      token(line.from, match.index, match.index + match[0].length, "rotli-raw-strong"),
    );
    matches(text, /`[^`]+`/g, (match) =>
      token(line.from, match.index, match.index + match[0].length, "rotli-raw-code-token"),
    );
    matches(text, /==[^=]+==/g, (match) =>
      token(line.from, match.index, match.index + match[0].length, "rotli-raw-accent"),
    );
    matches(text, /~~[^~]+~~/g, (match) =>
      token(line.from, match.index, match.index + match[0].length, "rotli-raw-muted"),
    );
    matches(text, /(^|[^*])\*([^*\n]+)\*/g, (match) => {
      const from = match.index + (match[1] ?? "").length;
      token(line.from, from, match.index + match[0].length, "rotli-raw-blue");
    });
    matches(text, new RegExp(MD_LINK_SOURCE, "g"), (match) => {
      const labelFrom = match.index + 1;
      const labelTo = labelFrom + (match[1] ?? "").length;
      token(line.from, match.index, labelFrom, "rotli-raw-accent");
      token(line.from, labelFrom, labelTo, "rotli-raw-blue");
      token(line.from, labelTo, match.index + match[0].length, "rotli-raw-muted");
    });
    matches(text, /<\/?[A-Za-z][^>]*>/g, (match) =>
      token(line.from, match.index, match.index + match[0].length, "rotli-raw-muted"),
    );
  }

  return { tokens, lines };
}
