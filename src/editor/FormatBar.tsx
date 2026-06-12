// The format bar (r5, approved): one persistent floating pill, bottom-center,
// 11 controls in four groups — H(level menu) | B I U S | code · link · quote |
// bullet · numbered · checklist. Always the same place, writes real markdown,
// active states on tint from the caret context. Narrow panes collapse the end
// groups into "⋯". Every control dispatches through the key registry.

import { type MouseEvent, type ReactNode, useRef, useState } from "react";
import { dispatch } from "../keys/registry";
import { useTransientPopover } from "../lib/popover";
import {
  type BlockToggle,
  type HeadingLevel,
  type InlineMark,
  blockToggleActive,
  headingLevelOf,
  isMarkActive,
} from "./commands";

export interface FormatContext {
  /** The active line's text, or null when no line holds the caret. */
  line: string | null;
  selStart: number;
}

// keep the textarea focused — formatting must never end the edit
function keepFocus(event: MouseEvent): void {
  event.preventDefault();
}

function Fb({
  label,
  on,
  onClick,
  children,
}: {
  label: string;
  on?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={on ? "fb on" : "fb"}
      aria-label={label}
      aria-pressed={on}
      onMouseDown={keepFocus}
      onClick={onClick}
    >
      {children}
      <span className="tip" aria-hidden="true">
        {label}
      </span>
    </button>
  );
}

function Gl({ children, strokeWidth }: { children: ReactNode; strokeWidth?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={15}
      height={15}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth ?? 1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

// — gate glyphs (r5 frame A) —
const codeGlyph = (
  <Gl>
    <path d="m16 18 6-6-6-6M8 6l-6 6 6 6" />
  </Gl>
);
const linkGlyph = (
  <Gl>
    <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
    <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
  </Gl>
);
const quoteGlyph = (
  <Gl>
    <path
      d="M3 21c3-1 4-3 4-6V9a3 3 0 0 1 3-3h0M14 21c3-1 4-3 4-6V9a3 3 0 0 1 3-3h0"
      transform="scale(0.9) translate(1,1)"
    />
  </Gl>
);
const bulletGlyph = (
  <Gl>
    <path d="M8 6h13M8 12h13M8 18h13" />
    <circle cx="3.5" cy="6" r="1" fill="currentColor" stroke="none" />
    <circle cx="3.5" cy="12" r="1" fill="currentColor" stroke="none" />
    <circle cx="3.5" cy="18" r="1" fill="currentColor" stroke="none" />
  </Gl>
);
const numberedGlyph = (
  <Gl strokeWidth={1.5}>
    <path d="M10 6h11M10 12h11M10 18h11M3 5.5 5 4v5M3.6 13.5a1.7 1.7 0 0 1 3 1c0 .8-.6 1.3-1.4 2L3.4 18H7" />
  </Gl>
);
const checklistGlyph = (
  <Gl>
    <path d="M10 6h11M10 12h11M10 18h11" />
    <path d="m2.5 6 1.2 1.2L6 4.9M2.5 12l1.2 1.2L6 10.9M2.5 18l1.2 1.2L6 16.9" strokeWidth={1.6} />
  </Gl>
);
const chevron = (
  <svg
    className="hchev"
    viewBox="0 0 24 24"
    width={8}
    height={8}
    fill="none"
    stroke="currentColor"
    strokeWidth={1.7}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="m6 9 6 6 6-6" />
  </svg>
);

const HEADING_LEVELS: HeadingLevel[] = [1, 2, 3];

export function FormatBar({ ctx, narrow }: { ctx: FormatContext; narrow: boolean }) {
  const [hOpen, setHOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const hBtnRef = useRef<HTMLDivElement>(null);
  const hMenuRef = useRef<HTMLDivElement>(null);
  const moreBtnRef = useRef<HTMLDivElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  useTransientPopover([hMenuRef, hBtnRef], hOpen, () => setHOpen(false));
  useTransientPopover([moreMenuRef, moreBtnRef], moreOpen, () => setMoreOpen(false));

  const level = ctx.line === null ? 0 : headingLevelOf(ctx.line);
  const markOn = (mark: InlineMark): boolean =>
    ctx.line !== null && isMarkActive(ctx.line, ctx.selStart, mark);
  const blockOn = (kind: BlockToggle): boolean =>
    ctx.line !== null && blockToggleActive(ctx.line, kind);

  const run = (actionId: string) => () => {
    dispatch(actionId);
    setHOpen(false);
    setMoreOpen(false);
  };

  const structureGroup = (
    <>
      <Fb label="Code" on={markOn("code")} onClick={run("editor.code")}>
        {codeGlyph}
      </Fb>
      <Fb label="Link" on={markOn("link")} onClick={run("editor.link")}>
        {linkGlyph}
      </Fb>
      <Fb label="Quote" on={blockOn("quote")} onClick={run("editor.quote")}>
        {quoteGlyph}
      </Fb>
    </>
  );
  const listGroup = (
    <>
      <Fb label="Bulleted list" on={blockOn("bullet")} onClick={run("editor.bulletList")}>
        {bulletGlyph}
      </Fb>
      <Fb label="Numbered list" on={blockOn("numbered")} onClick={run("editor.numberedList")}>
        {numberedGlyph}
      </Fb>
      <Fb label="Checklist" on={blockOn("checklist")} onClick={run("editor.checklist")}>
        {checklistGlyph}
      </Fb>
    </>
  );

  return (
    <div className="fmtbar" role="toolbar" aria-label="Formatting">
      <div className="fbwrap" ref={hBtnRef}>
        <Fb label="Heading level" on={level > 0 || hOpen} onClick={() => setHOpen(!hOpen)}>
          H{chevron}
        </Fb>
        {hOpen && (
          <div className="fbmenu" ref={hMenuRef} role="menu">
            {HEADING_LEVELS.map((l) => (
              <button
                type="button"
                key={l}
                className={level === l ? "fbrow sel" : "fbrow"}
                role="menuitem"
                onMouseDown={keepFocus}
                onClick={run(`editor.heading${l}`)}
              >
                <span className={`hsample h${l}`}>Heading {l}</span>
                <span className="hmark">{"#".repeat(l)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="fdiv" />
      <Fb label="Bold — ⌘B" on={markOn("bold")} onClick={run("editor.bold")}>
        <strong>B</strong>
      </Fb>
      <Fb label="Italic — ⌘I" on={markOn("italic")} onClick={run("editor.italic")}>
        <em>I</em>
      </Fb>
      <Fb label="Underline — ⌘U" on={markOn("underline")} onClick={run("editor.underline")}>
        <u>U</u>
      </Fb>
      <Fb label="Strikethrough" on={markOn("strike")} onClick={run("editor.strike")}>
        <s>S</s>
      </Fb>
      {narrow ? (
        <>
          <div className="fdiv" />
          <div className="fbwrap" ref={moreBtnRef}>
            <Fb label="More" on={moreOpen} onClick={() => setMoreOpen(!moreOpen)}>
              ⋯
            </Fb>
            {moreOpen && (
              <div className="fbmenu more" ref={moreMenuRef}>
                {structureGroup}
                <div className="fdiv" />
                {listGroup}
              </div>
            )}
          </div>
        </>
      ) : (
        <>
          <div className="fdiv" />
          {structureGroup}
          <div className="fdiv" />
          {listGroup}
        </>
      )}
    </div>
  );
}
