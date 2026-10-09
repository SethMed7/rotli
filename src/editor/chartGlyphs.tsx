// One small mark per chart kind, in the slash menu's stroke voice (the same
// 24-unit box and 1.7 stroke as Mermaid's glyph). The `/chart` picker and the
// slash menu's Chart row both draw from here.

import type { ReactNode } from "react";

import type { ChartType } from "./chartSpec";

const SHAPES: Record<ChartType, ReactNode> = {
  bar: <path d="M5 20v-6M10 20V8M15 20v-9M20 20V4" />,
  "horizontal-bar": <path d="M4 5h9M4 10h15M4 15h6M4 20h12" />,
  "stacked-bar": (
    <>
      <path d="M6 20v-9M12 20V6M18 20v-7" />
      <path d="M4.5 15h3M10.5 12h3M16.5 16h3" />
    </>
  ),
  line: <path d="M3 17l5-6 4 3 5-7 4 4" />,
  area: <path d="M3 19l5-7 4 3 5-7 4 4v7z" />,
  pie: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 4v8l6 5" />
    </>
  ),
  donut: (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3.5" />
      <path d="M12 4v4.5" />
    </>
  ),
  scatter: (
    <>
      <circle cx="6" cy="17" r="1.4" />
      <circle cx="10" cy="12" r="1.4" />
      <circle cx="14" cy="14" r="1.4" />
      <circle cx="18" cy="7" r="1.4" />
    </>
  ),
  radar: <path d="M12 3l8 6-3 10H7L4 9zM12 8l4 3-1.5 5h-5L8 11z" />,
  heatmap: <path d="M4 4h5v5H4zM10 4h5v5h-5zM16 4h4v5h-4zM4 10h5v5H4zM10 10h5v5h-5zM4 16h5v4H4z" />,
};

export function chartGlyph(type: ChartType) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={15}
      height={15}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {SHAPES[type]}
    </svg>
  );
}
