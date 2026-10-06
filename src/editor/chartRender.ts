// The ```chart fence's renderer: the one file that imports TanStack Charts
// (the owner's pick, 2026-10-05). chartSpec.ts owns the portable text; this
// adapter only draws a parsed spec, so a different renderer can replace it
// without touching a note. Colors come from the theme's tokens through the
// library's CSS hooks (`--ts-chart-n`, currentColor), set in render.css.

import {
  areaY,
  barX,
  barY,
  cell,
  colorLegend,
  defineChart,
  dot,
  group,
  lineY,
  ruleX,
  ruleY,
  text,
} from "@tanstack/charts";
import { mountChart } from "@tanstack/charts/dom";
import { angleGrid, pie, polar, radialArc, radialGrid, radialLine } from "@tanstack/charts/polar";
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

/** What the cartesian kinds share: their labels, the value axis, and color. */
function cartesianParts(spec: ChartSpec) {
  const data = chartData(spec);
  const series = spec.columns.slice(1);
  const several = series.length > 1;
  return {
    data,
    several,
    labels: [...new Set(data.map((datum) => datum.label))],
    value: {
      scale: scaleLinear,
      nice: true,
      grid: true,
      axis: { ticks: { format: valueFormat(spec.unit) } },
    },
    color: { domain: series, ...(several ? { legend: colorLegend() } : {}) },
  };
}

/** Bar and stacked bar: several series stand side by side in a bar chart and
 * stack in a stacked one (the library's default for one value channel). */
function columnChart(spec: ChartSpec) {
  const { data, several, labels, value, color } = cartesianParts(spec);
  const side = spec.type === "bar" && several;
  return defineChart({
    marks: [
      barY(data, {
        x: "label",
        y: "value",
        color: "series",
        key: "id",
        ...(side ? { layout: group() } : {}),
      }),
      ruleY([0]),
    ],
    scales: { x: { scale: () => scaleBand<string>().domain(labels).padding(0.2) }, y: value },
    color,
  });
}

function horizontalBarChart(spec: ChartSpec) {
  const { data, several, labels, value, color } = cartesianParts(spec);
  return defineChart({
    marks: [
      barX(data, {
        y: "label",
        x: "value",
        color: "series",
        key: "id",
        ...(several ? { layout: group() } : {}),
      }),
      ruleX([0]),
    ],
    scales: { y: { scale: () => scaleBand<string>().domain(labels).padding(0.2) }, x: value },
    color,
  });
}

/** Line and area (several areas stack). */
function trendChart(spec: ChartSpec) {
  const { data, labels, value, color } = cartesianParts(spec);
  const mark = spec.type === "area" ? areaY : lineY;
  return defineChart({
    marks: [mark(data, { x: "label", y: "value", color: "series", key: "id" }), ruleY([0])],
    scales: { x: { scale: () => scalePoint<string>().domain(labels).padding(0.3) }, y: value },
    color,
  });
}

/** Scatter: the label column is the x axis (chartSpec checks it is numbers). */
function scatterChart(spec: ChartSpec) {
  const series = spec.columns.slice(1);
  const points = chartData(spec)
    .filter((datum) => datum.value !== null)
    .map((datum) => ({ ...datum, x: Number(datum.label.replace(/ \(\d+\)$/, "")) }));
  return defineChart({
    marks: [dot(points, { x: "x", y: "value", color: "series", key: "id", r: 4 })],
    scales: {
      x: { scale: scaleLinear, nice: true, grid: true, axis: { label: spec.columns[0] ?? "" } },
      y: { scale: scaleLinear, nice: true, grid: true, axis: { ticks: { format: valueFormat(spec.unit) } } },
    },
    color: { domain: series, ...(series.length > 1 ? { legend: colorLegend() } : {}) },
  });
}

/** Radar: one closed outline per series around the rows. The first point is
 * repeated at the end of each outline to close it. */
function radarChart(spec: ChartSpec) {
  const series = spec.columns.slice(1);
  const labels = rowLabels(spec);
  const data = chartData(spec);
  const closed = series.flatMap((name) => {
    const own = data.filter((datum) => datum.series === name);
    return own.length ? [...own, { ...own[0]!, id: `${own[0]!.id}:end` }] : [];
  });
  const max = Math.max(1, ...data.map((datum) => datum.value ?? 0));
  return defineChart({
    marks: [
      polar({
        radiusRatio: 0.78,
        scales: {
          angle: { scale: scalePoint<string>().domain(labels), wrap: true },
          radius: { scale: scaleLinear().domain([0, max]).nice() },
        },
        guides: [radialGrid({ shape: "polygon" }), angleGrid({ labels: true })],
        marks: [
          radialLine(closed, {
            angle: "label",
            radius: "value",
            z: "series",
            color: "series",
            strokeWidth: 2,
          }),
        ],
      }),
    ],
    scales: { x: null, y: null },
    color: { domain: series, ...(series.length > 1 ? { legend: colorLegend() } : {}) },
  });
}

/** Heatmap: rows down, series across, each cell shaded by its value. The
 * shades are five steps of the theme's accent, so every theme tunes them. */
const HEAT_STEPS = [12, 30, 48, 66, 84];

function heatmapChart(spec: ChartSpec) {
  const series = spec.columns.slice(1);
  const labels = rowLabels(spec);
  const data = chartData(spec).filter((datum) => datum.value !== null);
  const values = data.map((datum) => datum.value ?? 0);
  const low = Math.min(...values);
  const span = Math.max(...values) - low || 1;
  const step = (value: number) =>
    Math.min(HEAT_STEPS.length - 1, Math.floor(((value - low) / span) * HEAT_STEPS.length));
  return defineChart({
    marks: [
      ...HEAT_STEPS.map((percent, s) =>
        cell(
          data.filter((datum) => step(datum.value ?? 0) === s),
          {
            x: "series",
            y: "label",
            key: "id",
            inset: 1,
            fill: `color-mix(in srgb, var(--accent) ${percent}%, var(--surface))`,
          },
        ),
      ),
      // each cell says its value, so the shade never has to be decoded
      text(data, {
        x: "series",
        y: "label",
        key: "id",
        text: (datum) => valueFormat(spec.unit)(datum.value ?? 0),
      }),
    ],
    // configured instances, not factories: the five shade layers each hold
    // some cells, and the columns and rows must keep the fence's order
    scales: {
      x: { scale: scaleBand<string>().domain(series).padding(0.04) },
      y: { scale: scaleBand<string>().domain(labels).padding(0.04) },
    },
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
        marks: [
          radialArc(slices, {
            color: "label",
            key: "id",
            cornerRadius: 3,
            // a donut is a pie with its middle open
            ...(spec.type === "donut"
              ? { innerRadius: ({ radius }: { radius: number }) => radius * 0.58 }
              : {}),
          }),
        ],
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
    spec.type === "pie" || spec.type === "donut"
      ? mountChart(host, { ...options, definition: pieChart(spec) })
      : spec.type === "scatter"
        ? mountChart(host, { ...options, definition: scatterChart(spec) })
        : spec.type === "radar"
          ? mountChart(host, { ...options, definition: radarChart(spec) })
          : spec.type === "heatmap"
            ? mountChart(host, { ...options, definition: heatmapChart(spec) })
            : spec.type === "horizontal-bar"
              ? mountChart(host, { ...options, definition: horizontalBarChart(spec) })
              : spec.type === "line" || spec.type === "area"
                ? mountChart(host, { ...options, definition: trendChart(spec) })
                : mountChart(host, { ...options, definition: columnChart(spec) });
  return () => chart.destroy();
}
