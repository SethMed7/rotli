// `/chart` (the owner, 2026-10-05: "just /chart and then … choose the type of
// chart"): one slash command opens this list of the ten kinds, in the slash
// menu's own look (SlashRows). Arrows and Enter, a click, or the digit beside a
// kind pick it; its starter fence lands where /chart was typed and opens its
// Edit form.

import { useEffect, useRef, useState } from "react";

import { useTransientPopover } from "../lib/popover";
import { chartGlyph } from "./chartGlyphs";
import { requestChartEdit } from "./chartPending";
import { CHART_KINDS, type ChartType, chartStarter } from "./chartSpec";
import { SlashRows } from "./slashMenu";

/** The Markdown a chosen kind inserts: its starter as a chart fence. */
export function chartFenceFor(type: ChartType): string {
  return `\`\`\`chart\n${chartStarter(type)}\n\`\`\`\n`;
}

const ROWS = CHART_KINDS.map((kind) => ({
  key: kind.type,
  glyph: chartGlyph(kind.type),
  label: kind.label,
  hint: kind.hint,
  group: "Chart",
}));

/** The kind a digit picks: 1–9, then 0 for the tenth. */
export function kindForDigit(key: string): ChartType | null {
  if (!/^[0-9]$/.test(key)) return null;
  return CHART_KINDS[key === "0" ? 9 : Number(key) - 1]?.type ?? null;
}

export function ChartTypePopover({
  onDone,
  onClose,
}: {
  /** Insert the chosen kind's fence at the slash point. */
  onDone: (markdown: string) => void;
  onClose: () => void;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [index, setIndex] = useState(0);
  useTransientPopover([rootRef], true, onClose);
  // the picker owns the keys while it is open
  useEffect(() => rootRef.current?.focus(), []);

  const pick = (type: ChartType) => {
    // the new block opens its Edit form once it renders (chartPending.ts)
    requestChartEdit(chartStarter(type));
    onDone(chartFenceFor(type));
  };

  return (
    <SlashRows
      label="Choose a chart"
      rows={ROWS}
      selectedIndex={index}
      onHover={setIndex}
      onPick={(i) => pick(CHART_KINDS[i]!.type)}
      rootRef={rootRef}
      focusable
      onKeyDown={(event) => {
        const count = CHART_KINDS.length;
        const digit = kindForDigit(event.key);
        if (event.key === "ArrowDown") setIndex((i) => (i + 1) % count);
        else if (event.key === "ArrowUp") setIndex((i) => (i - 1 + count) % count);
        else if (event.key === "Enter") pick(CHART_KINDS[index]!.type);
        else if (event.key === "Escape") onClose();
        else if (digit) pick(digit);
        else return;
        event.preventDefault();
        event.stopPropagation();
      }}
    />
  );
}
