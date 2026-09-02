// The static read-only markdown peek — the SAME line grammar the editor uses
// (parseBlock + renderInline), no editing, no widgets. Quick Look's note peek
// and Breve's brief reader both render through it (they used to carry two
// verbatim copies of this loop, 2026-09-01).

import type { ReactNode } from "react";

import { choiceGlyph } from "../editor/choiceState";
import {
  type Block,
  parseBlock,
  renderChoiceContent,
  renderInline,
  renderResultContent,
} from "../editor/render";
import { resultGlyph } from "../editor/resultState";

export function MarkdownPeek({ body, className = "pv-note" }: { body: string; className?: string }) {
  const blocks: ReactNode[] = [];
  let key = 0;
  for (const line of body.split("\n")) {
    const b: Block = parseBlock(line);
    key += 1;
    if (b.kind === "blank") blocks.push(<div key={key} className="pv-blank" />);
    else if (b.kind === "h1") blocks.push(<h1 key={key}>{renderInline(b.text)}</h1>);
    else if (b.kind === "h2") blocks.push(<h2 key={key}>{renderInline(b.text)}</h2>);
    else if (b.kind === "h3") blocks.push(<h3 key={key}>{renderInline(b.text)}</h3>);
    else if (b.kind === "quote") blocks.push(<blockquote key={key}>{renderInline(b.text)}</blockquote>);
    else if (
      b.kind === "bullet" ||
      b.kind === "task" ||
      b.kind === "numbered" ||
      b.kind === "result" ||
      b.kind === "choice"
    )
      blocks.push(
        <div key={key} className="pv-li" style={{ paddingLeft: `${(b.indent ?? 0) + 1.2}em` }}>
          <span className="pv-marker">
            {b.kind === "result"
              ? resultGlyph(b.resultState ?? "unanswered")
              : b.kind === "choice"
                ? choiceGlyph(b.choiceSelected ?? false)
                : (b.marker ?? "•")}
          </span>
          {b.kind === "result"
            ? renderResultContent(b)
            : b.kind === "choice"
              ? renderChoiceContent(b)
              : renderInline(b.text)}
        </div>,
      );
    else blocks.push(<p key={key}>{renderInline(b.text)}</p>);
  }
  return <div className={className}>{blocks}</div>;
}
