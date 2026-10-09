// The ```chart fence (SYNTAX.md, 2026-10-05): options, a blank line, then the
// data as comma-separated rows whose first row names the columns. Pure parse
// and serialize — the fence text is the only truth, the renderer is swappable
// (chartRender.ts), and anything this file can't read fails closed with a
// reason so the source is shown and never rewritten.

/** The chart kinds a fence may name, in the order `/chart` offers them (the
 * owner, 2026-10-05: "the top 10 people use"). Each is one TanStack mark set
 * in chartRender.ts; one label and one hint per kind serve the picker and the
 * Edit form alike. */
export const CHART_KINDS = [
  { type: "bar", label: "Bar", hint: "Compare values side by side" },
  { type: "horizontal-bar", label: "Horizontal bar", hint: "Rank long labels" },
  { type: "stacked-bar", label: "Stacked bar", hint: "Parts adding up per label" },
  { type: "line", label: "Line", hint: "A trend across steps" },
  { type: "area", label: "Area", hint: "A trend with its volume" },
  { type: "pie", label: "Pie", hint: "Parts of a whole" },
  { type: "donut", label: "Donut", hint: "Parts of a whole, with room to breathe" },
  { type: "scatter", label: "Scatter", hint: "How two numbers relate" },
  { type: "radar", label: "Radar", hint: "Profiles across several measures" },
  { type: "heatmap", label: "Heatmap", hint: "A grid of values, shaded" },
] as const;
export type ChartType = (typeof CHART_KINDS)[number]["type"];
export const CHART_TYPES: readonly ChartType[] = CHART_KINDS.map((kind) => kind.type);

const TYPE_LIST = "bar, horizontal-bar, stacked-bar, line, area, pie, donut, scatter, radar, or heatmap";

export const CHART_LIMITS = { series: 8, rows: 200 } as const;

const OPTION_KEYS = ["type", "title", "unit"] as const;
type OptionKey = (typeof OPTION_KEYS)[number];

export interface ChartRow {
  label: string;
  /** One per series; null is a missing value (a gap, no bar). */
  values: (number | null)[];
}

export interface ChartSpec {
  type: ChartType;
  title?: string;
  unit?: string;
  /** The header row: the label column's name, then one name per series. */
  columns: string[];
  rows: ChartRow[];
}

export type ChartParse = { ok: true; spec: ChartSpec } | { ok: false; reason: string };

const NUMBER = /^-?\d+(?:\.\d+)?$/;

function isChartType(value: string): value is ChartType {
  return (CHART_TYPES as readonly string[]).includes(value);
}

function isOptionKey(value: string): value is OptionKey {
  return (OPTION_KEYS as readonly string[]).includes(value);
}

/** One CSV line into trimmed fields; a quoted field keeps its inner text
 * (a doubled quote is one quote). Null when a quote never closes. */
function splitFields(line: string): string[] | null {
  const fields: string[] = [];
  let at = 0;
  for (;;) {
    while (line[at] === " " || line[at] === "\t") at += 1;
    if (line[at] === '"') {
      let value = "";
      at += 1;
      for (;;) {
        if (at >= line.length) return null;
        if (line[at] === '"') {
          if (line[at + 1] === '"') {
            value += '"';
            at += 2;
            continue;
          }
          at += 1;
          break;
        }
        value += line[at];
        at += 1;
      }
      const comma = line.indexOf(",", at);
      fields.push(value);
      if (comma < 0) return fields;
      at = comma + 1;
    } else {
      const comma = line.indexOf(",", at);
      fields.push((comma < 0 ? line.slice(at) : line.slice(at, comma)).trim());
      if (comma < 0) return fields;
      at = comma + 1;
    }
  }
}

const fail = (reason: string): ChartParse => ({ ok: false, reason });

export function parseChart(body: string): ChartParse {
  const lines = body.replace(/\r\n?/g, "\n").split("\n");
  const blank = lines.findIndex((line) => line.trim() === "");
  if (blank < 0) return fail("Add a blank line after the options, then the data.");

  const options: Partial<Record<OptionKey, string>> = {};
  for (const line of lines.slice(0, blank)) {
    const match = /^\s*([A-Za-z]+)\s*:\s*(.*)$/.exec(line);
    if (!match) return fail(`“${line.trim()}” isn’t an option. Write it as key: value.`);
    const key = match[1]!;
    if (!isOptionKey(key)) return fail(`“${key}” isn’t a chart option. Use type, title, or unit.`);
    if (options[key] !== undefined) return fail(`“${key}” is given twice.`);
    options[key] = match[2]!.trim();
  }
  if (!options.type) return fail(`A chart needs a type: ${TYPE_LIST}.`);
  if (!isChartType(options.type)) {
    return fail(`“${options.type}” isn’t a chart type. Use ${TYPE_LIST}.`);
  }

  const data = lines.slice(blank + 1).filter((line) => line.trim() !== "");
  const header = data[0] === undefined ? null : splitFields(data[0]);
  if (!header)
    return fail(data[0] === undefined ? "The chart has no data." : "The header has an unclosed quote.");
  if (header.length < 2) return fail("The header needs a label column and at least one series.");
  const emptyName = header.findIndex((name, i) => i > 0 && name === "");
  if (emptyName > 0) return fail(`The header’s column ${emptyName + 1} has no name.`);
  const series = header.length - 1;
  if (series > CHART_LIMITS.series) return fail(`A chart holds up to ${CHART_LIMITS.series} series.`);
  if (data.length < 2) return fail("The chart has no data rows.");
  if (data.length - 1 > CHART_LIMITS.rows) return fail(`A chart holds up to ${CHART_LIMITS.rows} rows.`);

  const rows: ChartRow[] = [];
  for (const [i, line] of data.slice(1).entries()) {
    const fields = splitFields(line);
    if (!fields) return fail(`Row ${i + 1} has an unclosed quote.`);
    if (fields.length > header.length) {
      return fail(`Row ${i + 1} has ${fields.length} fields; the header has ${header.length}.`);
    }
    const values: (number | null)[] = [];
    for (let s = 1; s <= series; s += 1) {
      const raw = fields[s] ?? "";
      if (raw === "") values.push(null);
      else if (NUMBER.test(raw)) values.push(Number(raw));
      else return fail(`“${raw}” in row ${i + 1} isn’t a number.`);
    }
    rows.push({ label: fields[0] ?? "", values });
  }

  if (options.type === "pie" || options.type === "donut") {
    const slices = rows.map((row) => row.values[0] ?? 0);
    if (slices.some((value) => value < 0)) return fail("A pie can’t have negative values.");
    if (!slices.some((value) => value > 0)) return fail("A pie needs a value above zero.");
  }
  if (options.type === "scatter") {
    // the label column is the x axis: every label must be a number
    const notNumber = rows.find((row) => !NUMBER.test(row.label));
    if (notNumber) return fail(`A scatter’s first column is numbers; “${notNumber.label}” isn’t one.`);
  }
  if (options.type === "radar" && rows.length < 3) return fail("A radar needs at least three rows.");

  const spec: ChartSpec = { type: options.type, columns: header, rows };
  if (options.title) spec.title = options.title;
  if (options.unit) spec.unit = options.unit;
  return { ok: true, spec };
}

function field(value: string): string {
  return /[",]|^\s|\s$/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

/** The canonical fence body: what Apply writes and what a starter inserts. */
export function serializeChart(spec: ChartSpec): string {
  const options = [`type: ${spec.type}`];
  if (spec.title) options.push(`title: ${spec.title}`);
  if (spec.unit) options.push(`unit: ${spec.unit}`);
  const rows = spec.rows.map((row) =>
    [field(row.label), ...row.values.map((value) => (value === null ? "" : String(value)))].join(", "),
  );
  return [...options, "", spec.columns.map(field).join(", "), ...rows].join("\n");
}

const row = (label: string, ...values: number[]): ChartRow => ({ label, values });

const STARTERS: Record<ChartType, ChartSpec> = {
  bar: {
    type: "bar",
    title: "Hours this week",
    unit: "h",
    columns: ["Day", "Writing", "Reading"],
    rows: [row("Mon", 4, 1), row("Tue", 6, 2), row("Wed", 3, 2)],
  },
  "horizontal-bar": {
    type: "horizontal-bar",
    title: "Notes by area",
    columns: ["Area", "Notes"],
    rows: [row("Projects", 42), row("Reading list", 27), row("Meeting notes", 19), row("Journal", 11)],
  },
  "stacked-bar": {
    type: "stacked-bar",
    title: "Tasks by week",
    columns: ["Week", "Done", "Open"],
    rows: [row("W1", 8, 4), row("W2", 11, 3), row("W3", 9, 6)],
  },
  line: {
    type: "line",
    title: "Words written",
    columns: ["Week", "Words"],
    rows: [row("W1", 1200), row("W2", 1800), row("W3", 1500), row("W4", 2400)],
  },
  area: {
    type: "area",
    title: "Notes filed",
    columns: ["Month", "Notes"],
    rows: [row("Jul", 12), row("Aug", 20), row("Sep", 31)],
  },
  pie: {
    type: "pie",
    title: "Where the time went",
    unit: "h",
    columns: ["Task", "Hours"],
    rows: [row("Writing", 6), row("Reading", 3), row("Email", 1)],
  },
  donut: {
    type: "donut",
    title: "Budget",
    unit: "$",
    columns: ["Category", "Spent"],
    rows: [row("Rent", 1200), row("Food", 450), row("Travel", 300), row("Other", 150)],
  },
  scatter: {
    type: "scatter",
    title: "Sleep and focus",
    columns: ["Hours slept", "Focus"],
    rows: [row("5", 4), row("6", 5), row("7", 7), row("8", 8), row("9", 7)],
  },
  radar: {
    type: "radar",
    title: "Skills",
    columns: ["Skill", "Me", "Goal"],
    rows: [
      row("Writing", 7, 9),
      row("Research", 6, 8),
      row("Design", 4, 6),
      row("Code", 8, 8),
      row("Speaking", 5, 7),
    ],
  },
  heatmap: {
    type: "heatmap",
    title: "Writing by day",
    unit: "min",
    columns: ["Day", "Morning", "Afternoon", "Evening"],
    rows: [row("Mon", 30, 10, 45), row("Tue", 20, 0, 60), row("Wed", 40, 15, 20)],
  },
};

export function chartStarter(type: ChartType): string {
  return serializeChart(STARTERS[type]);
}
