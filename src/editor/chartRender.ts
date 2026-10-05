// The ```chart fence's renderer: the one file that imports TanStack Charts
// (the owner's pick, 2026-10-05). chartSpec.ts owns the portable text; this
// adapter only draws a parsed spec, so a different renderer can replace it
// without touching a note. Colors come from the theme's tokens through the
// library's CSS hooks (`--ts-chart-n`, currentColor), set in render.css.

import { areaY, barY, colorLegend, defineChart, group, lineY, ruleY } from "@tanstack/charts";
import { mountChart } from "@tanstack/charts/dom";
import { pie, polar, radialArc } from "@tanstack/charts/polar";
import { scaleBand } from "@tanstack/charts/scales/band";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { scalePoint } from "@tanstack/charts/scales/point";

import type { ChartSpec } from "./chartSpec";

const CHART_HEIGHT = 260;

/** One datum per label × series; a missing value stays null (a gap, no bar). */
interface ChartDatum {
  id: string;
  label: string;
  series: string;
  value: number | null;
}

/** The spec's rows as the long form the marks read, labels kept unique so a
 * repeated label still draws its own bar. Exported for tests. */
export function chartData(spec: ChartSpec): ChartDatum[] {
  const series = spec.columns.slice(1);
  const labels = rowLabels(spec);
  return spec.rows.flatMap((row, r) =>
    series.map((name, s) => ({
      id: `${r}:${s}`,
      label: labels[r]!,
      series: name,
      value: row.values[s] ?? null,
    })),
  );
}

/** Each row's axis label: a blank one numbered, a repeat counted ("Mon (2)"),
 * so no two rows share a band or a slice. */
function rowLabels(spec: ChartSpec): string[] {
  const seen = new Map<string, number>();
  return spec.rows.map((row, r) => {
    const base = row.label || `#${r + 1}`;
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return count === 1 ? base : `${base} (${count})`;
  });
}

function valueFormat(unit: string | undefined) {
  return (value: number) => (unit ? `${value.toLocaleString()} ${unit}` : value.toLocaleString());
}

function cartesian(spec: ChartSpec) {
  const data = chartData(spec);
  const labels = [...new Set(data.map((datum) => datum.label))];
  const series = spec.columns.slice(1);
  const several = series.length > 1;
  const y = {
    scale: scaleLinear,
    nice: true,
    grid: true,
    axis: { ticks: { format: valueFormat(spec.unit) } },
  };
  const color = {
    domain: series,
    ...(several ? { legend: colorLegend() } : {}),
  };
  if (spec.type === "bar") {
    return defineChart({
      marks: [
        barY(data, {
          x: "label",
          y: "value",
          color: "series",
          key: "id",
          ...(several ? { layout: group() } : {}),
        }),
        ruleY([0]),
      ],
      scales: { x: { scale: () => scaleBand<string>().domain(labels).padding(0.2) }, y },
      color,
    });
  }
  const mark = spec.type === "area" ? areaY : lineY;
  return defineChart({
    marks: [mark(data, { x: "label", y: "value", color: "series", key: "id" }), ruleY([0])],
    scales: { x: { scale: () => scalePoint<string>().domain(labels).padding(0.3) }, y },
    color,
  });
}

function pieChart(spec: ChartSpec) {
  const labels = rowLabels(spec);
  const rows = spec.rows.map((row, r) => ({ id: String(r), label: labels[r]!, value: row.values[0] ?? 0 }));
  const slices = pie(rows, { value: "value" });
  return defineChart({
    marks: [
      polar({
        inset: 8,
        marks: [radialArc(slices, { color: "label", key: "id", cornerRadius: 3 })],
        scales: { angle: null, radius: null },
      }),
    ],
    scales: { x: null, y: null },
    color: { domain: rows.map((row) => row.label), legend: colorLegend() },
  });
}

/** Draw a parsed spec into `host`; returns the teardown. */
export function mountChartSpec(host: HTMLElement, spec: ChartSpec): () => void {
  const options = { height: CHART_HEIGHT, ariaLabel: spec.title || `${spec.type} chart` };
  // each kind mounts with its own datum type; the host is the same
  const chart =
    spec.type === "pie"
      ? mountChart(host, { ...options, definition: pieChart(spec) })
      : mountChart(host, { ...options, definition: cartesian(spec) });
  return () => chart.destroy();
}
