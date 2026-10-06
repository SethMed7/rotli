// Figures in posts: charts and small diagrams written as a ```figure fence in the Markdown and
// drawn at build time, so a page carries no chart library, no script, and no inline style (the
// production CSP drops `style=`). One spec, three readings:
//   - the page (`figureHtml`): a titled <figure>, a bar chart as an SVG whose bars are sized by
//     percentage attributes (it reflows with the column and its text never shrinks) or a flow as
//     an ordered list, a caption that cites the source, and the numbers as a table;
//   - the Markdown twin (`figureMarkdown`, src/agents.ts): the same numbers as a Markdown table,
//     so Copy Markdown and agents get data, never a fence of chart syntax;
//   - the build: a spec that does not parse fails the build with the line at fault.
// Colours come from classes styled in WritingPage.astro on the site's tokens; SVG presentation
// attributes cannot read var(), so no colour is ever written here.
//
// The fence: `key: value` lines, a `---` line, then one row per line.
//
//   ```figure
//   kind: bar                       bar | flow
//   title: What the chart shows     its accessible name and visible title
//   caption: Who was asked, when.   under the figure
//   source: Label | https://…       optional, linked after the caption
//   label: Tool                     the table's first column (bar)
//   value: Hadn't used it           the table's second column (bar)
//   unit: %                         shown after each value (bar)
//   max: 100                        the scale's end; bars start at zero (bar, optional)
//   ---
//   ChatGPT | 50.4                  bar: label | value, copied exactly as written
//   Your note | A plain file        flow: step | what happens there
//   - Your AI plan | Claude Code    flow: an alternative that can do the step above
//   ```

export type FigureKind = 'bar' | 'flow';

export interface BarRow {
  label: string;
  /** Exactly as written in the post: figures are never reformatted. */
  value: string;
  amount: number;
}

export interface FlowStep {
  name: string;
  detail: string;
  /** Alternatives that can each do this step ("or"). */
  options: { name: string; detail: string }[];
}

interface FigureBase {
  title: string;
  caption: string;
  source?: { label: string; url: string };
}

export interface BarFigure extends FigureBase {
  kind: 'bar';
  label: string;
  value: string;
  unit: string;
  /** The scale's end; undefined lets the chart pick one with room for the values. */
  max?: number;
  rows: BarRow[];
}

export interface FlowFigure extends FigureBase {
  kind: 'flow';
  steps: FlowStep[];
}

export type Figure = BarFigure | FlowFigure;

const KEYS = {
  bar: ['kind', 'title', 'caption', 'source', 'label', 'value', 'unit', 'max'],
  flow: ['kind', 'title', 'caption', 'source'],
} as const;

function fail(message: string): never {
  throw new Error(`figure: ${message}`);
}

function cells(line: string, at: number): [string, string] {
  const parts = line.split('|').map((part) => part.trim());
  if (parts.length !== 2 || !parts[0] || !parts[1]) fail(`row ${at} needs "name | value", got "${line}"`);
  return [parts[0], parts[1]];
}

/** Reads a ```figure fence's body; throws (failing the build) on anything it does not understand. */
export function parseFigure(source: string): Figure {
  const lines = source.split('\n').map((line) => line.replace(/\s+$/, ''));
  const split = lines.findIndex((line) => line.trim() === '---');
  if (split < 0) fail('needs a "---" line between its settings and its rows');
  const head = new Map<string, string>();
  for (const line of lines.slice(0, split)) {
    if (!line.trim()) continue;
    const match = line.match(/^([a-z]+):\s*(.+)$/);
    if (!match) fail(`setting "${line}" is not "key: value"`);
    const [, key = '', value = ''] = match;
    if (head.has(key)) fail(`"${key}" is set twice`);
    head.set(key, value.trim());
  }
  const kind = head.get('kind');
  if (kind !== 'bar' && kind !== 'flow') fail(`kind must be bar or flow, got "${kind ?? ''}"`);
  for (const key of head.keys()) {
    if (!(KEYS[kind] as readonly string[]).includes(key)) fail(`"${key}" is not a ${kind} setting`);
  }
  const title = head.get('title') ?? fail('needs a title (its accessible name)');
  const caption = head.get('caption') ?? fail('needs a caption that says where the numbers come from');
  const sourceLine = head.get('source');
  let figureSource: FigureBase['source'];
  if (sourceLine) {
    const [label, url] = cells(sourceLine, 0);
    if (!/^https:\/\/\S+$/.test(url)) fail(`source link must be https, got "${url}"`);
    figureSource = { label, url };
  }
  const body = lines.slice(split + 1).filter((line) => line.trim());
  if (body.length === 0) fail('has no rows');

  if (kind === 'bar') {
    const rows = body.map((line, index) => {
      const [label, value] = cells(line, index + 1);
      if (!/^-?\d+(\.\d+)?$/.test(value)) fail(`"${value}" in row ${index + 1} is not a number`);
      const amount = Number(value);
      if (amount < 0) fail('bars start at zero; a negative value needs another kind of chart');
      return { label, value, amount };
    });
    const maxSetting = head.get('max');
    const max = maxSetting === undefined ? undefined : Number(maxSetting);
    if (max !== undefined && !(max > 0)) fail(`max must be a positive number, got "${maxSetting}"`);
    if (max !== undefined && rows.some((row) => row.amount > max)) fail(`a value is above max ${max}`);
    return {
      kind,
      title,
      caption,
      source: figureSource,
      label: head.get('label') ?? fail('a bar chart needs `label:` (the table’s first column)'),
      value: head.get('value') ?? fail('a bar chart needs `value:` (the table’s second column)'),
      unit: head.get('unit') ?? '',
      max,
      rows,
    };
  }

  const steps: FlowStep[] = [];
  body.forEach((line, index) => {
    const option = line.match(/^\s*-\s+(.+)$/);
    if (option) {
      const step = steps.at(-1) ?? fail('an option ("- …") needs a step above it');
      const [name, detail] = cells(option[1] ?? '', index + 1);
      step.options.push({ name, detail });
      return;
    }
    const [name, detail] = cells(line, index + 1);
    steps.push({ name, detail, options: [] });
  });
  if (steps.length < 2) fail('a flow needs at least two steps');
  return { kind, title, caption, source: figureSource, steps };
}

/** The scale's end: the spec's `max`, or the largest value plus a fifth, rounded up to a step of
 * ten, so a value written after its bar always has room. */
export function scaleMax(figure: BarFigure): number {
  if (figure.max !== undefined) return figure.max;
  const top = Math.max(...figure.rows.map((row) => row.amount));
  return top === 0 ? 1 : Math.ceil((top * 1.2) / 10) * 10;
}

const escape = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A stable id from the title, made unique on its page by `taken`. */
export function figureId(title: string, taken: Set<string>): string {
  const words = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  // At most 48 characters, cut at a word.
  const short = words.length > 48 ? words.slice(0, 49).replace(/-[^-]*$/, '') : words;
  const base = `figure-${short || 'chart'}`;
  let id = base;
  for (let n = 2; taken.has(id); n += 1) id = `${base}-${n}`;
  taken.add(id);
  return id;
}

/** The bar chart's geometry, in CSS pixels down and percent across (so it reflows with the column). */
export const BAR_LAYOUT = { row: 56, labelBaseline: 17, barTop: 26, bar: 14, pad: 4 } as const;

export function barWidth(row: BarRow, max: number): number {
  return Math.round((row.amount / max) * 10000) / 100;
}

/** "ChatGPT 50.4%, Midjourney 42.6%, …": the chart's description, read with its name. */
export function barSummary(figure: BarFigure): string {
  return `${figure.value}: ${figure.rows.map((row) => `${row.label} ${row.value}${figure.unit}`).join(', ')}.`;
}

function captionHtml(figure: Figure): string {
  const source = figure.source
    ? ` Source: <a href="${escape(figure.source.url)}" rel="noopener">${escape(figure.source.label)}</a>.`
    : '';
  return `<figcaption class="figure-caption">${escape(figure.caption)}${source}</figcaption>`;
}

function barHtml(figure: BarFigure, id: string): string {
  const { row: rowHeight, labelBaseline, barTop, bar, pad } = BAR_LAYOUT;
  const max = scaleMax(figure);
  const height = figure.rows.length * rowHeight + pad;
  const rows = figure.rows
    .map((row, index) => {
      const top = index * rowHeight;
      const width = barWidth(row, max);
      const value = `${row.value}${figure.unit}`;
      return [
        `<text class="chart-label" x="0" y="${top + labelBaseline}">${escape(row.label)}</text>`,
        figure.max !== undefined
          ? `<rect class="chart-track" x="0" y="${top + barTop}" width="100%" height="${bar}" rx="${bar / 2}"></rect>`
          : '',
        `<rect class="chart-bar" x="0" y="${top + barTop}" width="${width}%" height="${bar}" rx="${bar / 2}"></rect>`,
        `<text class="chart-value" x="${width}%" dx="10" y="${top + barTop + bar - 2}">${escape(value)}</text>`,
      ].join('');
    })
    .join('');
  const table = [
    '<table>',
    `<caption class="visually-hidden">${escape(figure.title)}</caption>`,
    `<thead><tr><th scope="col">${escape(figure.label)}</th><th scope="col">${escape(figure.value)}</th></tr></thead>`,
    '<tbody>',
    ...figure.rows.map(
      (row) => `<tr><th scope="row">${escape(row.label)}</th><td>${escape(row.value)}${escape(figure.unit)}</td></tr>`,
    ),
    '</tbody></table>',
  ].join('');
  return [
    `<figure class="figure figure-bar" id="${id}" data-figure="bar">`,
    `<p class="figure-title" id="${id}-title">${escape(figure.title)}</p>`,
    `<svg class="chart" width="100%" height="${height}" role="img" aria-labelledby="${id}-title" aria-describedby="${id}-desc">`,
    `<desc id="${id}-desc">${escape(barSummary(figure))}</desc>`,
    rows,
    '</svg>',
    captionHtml(figure),
    `<details class="figure-data"><summary>The numbers as a table</summary>${table}</details>`,
    '</figure>',
  ].join('');
}

function flowHtml(figure: FlowFigure, id: string): string {
  const steps = figure.steps
    .map((step) => {
      const options =
        step.options.length > 0
          ? `<ul class="flow-options" aria-label="Either of these">${step.options
              .map((option) => `<li><b>${escape(option.name)}</b><span>${escape(option.detail)}</span></li>`)
              .join('')}</ul>`
          : '';
      return `<li class="flow-step"><b>${escape(step.name)}</b><span>${escape(step.detail)}</span>${options}</li>`;
    })
    .join('');
  return [
    `<figure class="figure figure-flow" id="${id}" data-figure="flow">`,
    `<p class="figure-title" id="${id}-title">${escape(figure.title)}</p>`,
    `<ol class="flow" aria-labelledby="${id}-title">${steps}</ol>`,
    captionHtml(figure),
    '</figure>',
  ].join('');
}

export function figureHtml(figure: Figure, id: string): string {
  return figure.kind === 'bar' ? barHtml(figure, id) : flowHtml(figure, id);
}

/** The figure in the Markdown twin: its title, its rows as a table or a numbered list, its caption. */
export function figureMarkdown(figure: Figure): string {
  const source = figure.source ? ` Source: [${figure.source.label}](${figure.source.url}).` : '';
  const body =
    figure.kind === 'bar'
      ? [
          `| ${figure.label} | ${figure.value} |`,
          '| --- | --- |',
          ...figure.rows.map((row) => `| ${row.label} | ${row.value}${figure.unit} |`),
        ]
      : figure.steps.map((step, index) => {
          const options = step.options.map((option) => `${option.name} (${option.detail})`).join(', or ');
          return `${index + 1}. **${step.name}**: ${step.detail}${options ? `. Either: ${options}.` : ''}`;
        });
  return [`**Figure: ${figure.title}**`, '', ...body, '', `*${figure.caption}${source}*`].join('\n');
}

const FENCE = /^```figure[^\S\n]*\n([\s\S]*?)\n```[^\S\n]*$/gm;

/** A post's Markdown without its figures: the prose a reading time counts. */
export function withoutFigures(markdown: string): string {
  return markdown.replace(FENCE, '');
}

/** A post's Markdown with every ```figure fence replaced by its Markdown reading (the twin). */
export function figuresToMarkdown(markdown: string): string {
  return markdown.replace(FENCE, (_, body: string) => figureMarkdown(parseFigure(body)));
}

interface CodeNode {
  lang?: string | null;
  value: string;
}

/**
 * The Markdown plugin (Astro's Sätteri processor; astro.config.mjs adds it): every ```figure
 * code block becomes its HTML. A factory, so each document starts with its own set of ids.
 */
export function figurePlugin() {
  const taken = new Set<string>();
  return {
    name: 'rotli-figures',
    code(node: CodeNode, ctx: { replaceNode(node: CodeNode, content: { rawHtml: string }): void }) {
      if (node.lang !== 'figure') return;
      const figure = parseFigure(node.value);
      ctx.replaceNode(node, { rawHtml: figureHtml(figure, figureId(figure.title, taken)) });
    },
  };
}
