// The "/" slash menu (the maintainer 2026-06-13): type "/" at the start of an empty
// active line in the editor to insert a block. A LOCAL editor affordance, not
// a global key surface — CmEditor owns the open/query/index state and drives
// this purely as a presentational popover anchored under the active row. Each
// item carries a STRUCTURED op (heading/block/code/picker); CmEditor clears
// the "/query" and applies it to the now-empty line via the canonical
// applyHeading/applyBlockToggle — never through the stale activeEditor() handle.
//
// We mirror the format bar's popover grammar (the .fbmenu/.fbrow voice) but in
// a dedicated .slashmenu block (positioned under, not above, the anchor) so the
// two surfaces can evolve independently. Glyphs are reused from FormatBar's
// vocabulary — same SVG voice, same 15px size.

import { useEffect, useLayoutEffect, useRef } from "react";

import { LAUNCH_FEATURES, PLATFORM } from "../lib/featurePolicy";
import { fitMenuToWindow, scrollRowIntoList } from "../lib/popover";
import { parseBlock } from "./render";
import { RESULT_REASON_SEPARATOR, resultTextParts } from "./resultState";
import { SLASH_ITEMS } from "./slashItems";
import type { SlashItem, SlashOp } from "./slashTypes";

export type { SlashItem, SlashOp, SlashPickerMode } from "./slashTypes";
export { SLASH_ITEMS } from "./slashItems";

/** How much room a slash popover wants below the caret row before it prefers
 * flipping upward — roughly the menu's comfortable height. */
export const SLASH_FLIP_THRESHOLD = 300;

/** Popover direction: downward by default; flip up only when the space below
 * can't fit the menu AND above has more room (a short Quick Note window used
 * to clip the menu at its bottom edge — reading as "slash doesn't work"). */
export function slashPlacement(
  spaceAbove: number,
  spaceBelow: number,
  needed = SLASH_FLIP_THRESHOLD,
): "up" | "down" {
  return spaceBelow < needed && spaceAbove > spaceBelow ? "up" : "down";
}

/** Filter by label or optional keywords (case-insensitive). The spreadsheet
 * embed is withheld from builds without the sheets capability, and /librarian
 * from Rotli Web (the Librarian runs in the Mac app). */
export function filterSlashItems(
  query: string,
  features: { sheets: boolean; librarian?: boolean } = { ...LAUNCH_FEATURES, librarian: PLATFORM !== "web" },
): SlashItem[] {
  const q = query.trim().toLowerCase();
  const items = SLASH_ITEMS.filter(
    (it) =>
      (features.sheets || !(it.op.kind === "picker" && it.op.mode === "embedSheet")) &&
      (features.librarian !== false || it.op.kind !== "librarian"),
  );
  if (q === "") return items;
  return items.filter((it) => it.label.toLowerCase().includes(q) || it.keywords?.some((k) => k.includes(q)));
}

export interface SlashLineTarget {
  /** Character offset where the slash query starts; list markers stay before it. */
  from: number;
  /** Indentation applied to subsequent scaffold lines so they remain in the item. */
  continuation: string;
}

/** The editable slash-command lane for a paragraph or Markdown list item. */
export function slashLineTarget(line: string): SlashLineTarget {
  const block = parseBlock(line);
  if (
    block.kind !== "bullet" &&
    block.kind !== "numbered" &&
    block.kind !== "task" &&
    block.kind !== "result" &&
    block.kind !== "choice"
  ) {
    return { from: 0, continuation: "" };
  }
  const prefix = line.slice(0, block.prefixLen).replace(/\t/g, "  ");
  return { from: block.prefixLen, continuation: " ".repeat(prefix.length) };
}

/** Keep every non-empty continuation line inside the current list item. */
export function adaptSlashInsertion(
  insert: string,
  caret: number,
  continuation: string,
): { insert: string; caret: number } {
  if (!continuation) return { insert, caret };
  const adapt = (text: string) => text.replace(/\n(?=.)/g, `\n${continuation}`);
  return {
    insert: adapt(insert),
    caret: adapt(insert.slice(0, caret)).length,
  };
}

/** What a picked slash command replaces and where its block lands.
 * `from..to` is the line span to delete; `lead` is prepended to the insertion
 * ("" = in place; "\n" + indent = on a fresh continuation line beneath). */
export interface SlashApplySpan {
  from: number;
  to: number;
  lead: string;
  continuation: string;
  query: string;
}

/** A command that belongs INSIDE a sentence: it inserts in place. Everything
 * else is a block, and a block picked after text lands on a continuation line
 * beneath, so the sentence (or the list item's text) stays whole. */
function isInlineOp(op: SlashOp | undefined): boolean {
  if (!op) return false;
  if (op.kind === "code" || op.kind === "date") return true;
  return (
    op.kind === "picker" && (op.mode === "linkNote" || op.mode === "linkChat" || op.mode === "continueList")
  );
}

/** A slash command owns paragraph or list-item content while the caret trails
 * it — the whole line (`/table`), or a trailing ` /query` after text, so a
 * command can be reached from inside a checklist item without leaving it.
 *
 * After text, prose keeps its slashes: the slash needs a space before it
 * (`and/or`, a URL), at least one letter after it (`yes / no`), and a command
 * that matches (`/usr`). `op` is the command being applied: it decides whether
 * the insertion stays in the sentence or goes beneath (isInlineOp).
 *
 * A result row is the one exception to "after text": its LABEL is an answer,
 * not prose, so only the trailing token of its ` — reason` is a command, and a
 * reason that was only the slash drops its dangling separator. */
export function slashSpanAtCaret(line: string, caret: number, op?: SlashOp): SlashApplySpan | null {
  if (caret !== line.length) return null;
  const target = slashLineTarget(line);
  const whole = /^\/([^/]*)$/.exec(line.slice(target.from));
  if (whole) {
    return {
      from: target.from,
      to: line.length,
      lead: "",
      continuation: target.continuation,
      query: whole[1] ?? "",
    };
  }
  const block = parseBlock(line);
  const beneath = isInlineOp(op) ? "" : `\n${target.continuation}`;
  if (block.kind !== "result") {
    if (block.kind === "choice") return null;
    const tail = /\s\/([^/\s]+)$/.exec(line.slice(target.from));
    if (!tail || filterSlashItems(tail[1] ?? "").length === 0) return null;
    return {
      from: target.from + tail.index + 1,
      to: line.length,
      lead: beneath,
      continuation: target.continuation,
      query: tail[1] ?? "",
    };
  }
  const parts = resultTextParts(block.text);
  if (parts.reason === null) return null;
  const labelEnd = block.prefixLen + parts.label.length;
  const reasonFrom = labelEnd + RESULT_REASON_SEPARATOR.length;
  const tail = /(^|\s)\/([^/\s]*)$/.exec(line.slice(reasonFrom));
  if (!tail) return null;
  const from = tail.index === 0 ? labelEnd : reasonFrom + tail.index;
  return {
    from,
    to: line.length,
    lead: `\n${target.continuation}`,
    continuation: target.continuation,
    query: tail[2] ?? "",
  };
}

export function slashQueryAtCaret(line: string, caret: number): string | null {
  return slashSpanAtCaret(line, caret)?.query ?? null;
}

export function SlashMenu({
  query,
  selectedIndex,
  onHover,
  onPick,
}: {
  query: string;
  selectedIndex: number;
  onHover: (index: number) => void;
  onPick: (item: SlashItem) => void;
}) {
  const items = filterSlashItems(query);
  // arrowing past the fold scrolls the menu with the highlight (and its group label)
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const root = rootRef.current;
    const sel = root?.querySelector(".slashrow.sel");
    if (root) scrollRowIntoList(root, sel?.closest(".slashgrouped") ?? sel);
  }, [selectedIndex, query]);
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (root) fitMenuToWindow(root, !!root.closest(".rotli-slash-anchor.up"));
  }, [query]);
  return (
    <div className="slashmenu" role="menu" aria-label="Insert block" ref={rootRef}>
      {items.length === 0 && (
        <div className="slashmenu-empty" role="status">
          No commands found <span>Esc to close</span>
        </div>
      )}
      {items.map((item, i) => (
        <div key={item.label} className="slashgrouped">
          {item.group !== items[i - 1]?.group && (
            <div className="slashgroup" aria-hidden="true">
              {item.group}
            </div>
          )}
          <button
            type="button"
            className={i === selectedIndex ? "slashrow sel" : "slashrow"}
            role="menuitem"
            // keep the editor focused — picking must never end the edit
            onMouseDown={(e) => e.preventDefault()}
            // a moving pointer picks the row; a resting one the menu opened
            // under does not, or it would steal the keyboard's first row
            onMouseMove={() => i !== selectedIndex && onHover(i)}
            onClick={() => onPick(item)}
          >
            <span className="slashglyph">{item.glyph}</span>
            <span className="slashlabel">{item.label}</span>
            <span className="slashhint">{item.hint}</span>
          </button>
        </div>
      ))}
    </div>
  );
}
