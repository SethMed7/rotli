// The ```chart block in the editor (SYNTAX.md, 2026-10-05): the rendered
// chart, or — failing closed — the reason and the source as code; and the
// Edit form, whose Apply replaces only the fence body after the same stale
// guard Mermaid's workspace uses. The renderer loads on first use.

import { EditorView } from "@codemirror/view";

import { mountChartForm } from "./chartForm";
import { type ChartSpec, parseChart, serializeChart } from "./chartSpec";
import { fenceBodyRange } from "./fences";

/** Teardowns for mounted charts, found again when their widget goes. */
const TEARDOWNS = new WeakMap<HTMLElement, () => void>();

/** The block's body: the chart, or the reason and the source as code. */
export async function renderChartBlock(code: string): Promise<HTMLElement> {
  const parsed = parseChart(code);
  if (!parsed.ok) {
    const box = document.createElement("div");
    box.className = "rotli-render-chart-refused";
    const reason = document.createElement("p");
    reason.className = "rotli-render-error";
    reason.textContent = `chart: ${parsed.reason}`;
    const source = document.createElement("pre");
    source.textContent = code;
    box.append(reason, source);
    return box;
  }
  const host = document.createElement("div");
  host.className = "rotli-render-chart";
  if (parsed.spec.title) {
    const title = document.createElement("p");
    title.className = "rotli-render-chart-title";
    title.textContent = parsed.spec.title;
    host.append(title);
  }
  const canvas = document.createElement("div");
  canvas.className = "rotli-render-chart-canvas";
  host.append(canvas);
  const { mountChartSpec } = await import("./chartRender");
  TEARDOWNS.set(host, mountChartSpec(canvas, parsed.spec));
  return host;
}

/** Release every chart under a widget that is going away. */
export function destroyChartBlocks(root: HTMLElement): void {
  for (const host of root.querySelectorAll<HTMLElement>(".rotli-render-chart")) {
    TEARDOWNS.get(host)?.();
    TEARDOWNS.delete(host);
  }
}

/** Write a spec over the fence body, if the fence is still what was opened. */
export function applyChartSpec(
  view: EditorView,
  code: string,
  sourceFrom: number,
  sourceTo: number,
  spec: ChartSpec,
): string | null {
  const range = fenceBodyRange(view.state.doc, sourceFrom, sourceTo);
  if (!range) return "The chart moved in the note. Close the form and open it again.";
  if (view.state.doc.sliceString(range.from, range.to) !== code) {
    return "The chart changed in the note while the form was open. Close it and open it again.";
  }
  const next = serializeChart(spec);
  view.dispatch({ changes: { from: range.from, to: range.to, insert: next } });
  view.focus();
  return null;
}

/** Open the Edit form under the chart. A chart Rotli can't read has no form:
 * its source opens instead, so it can be fixed by hand. */
export function openChartForm(
  container: HTMLElement,
  code: string,
  sourceFrom: number,
  sourceTo: number,
): void {
  const view = EditorView.findFromDOM(container);
  if (!view) return;
  const parsed = parseChart(code);
  if (!parsed.ok) {
    const range = fenceBodyRange(view.state.doc, sourceFrom, sourceTo);
    if (range) view.dispatch({ selection: { anchor: range.from }, scrollIntoView: true });
    view.focus();
    return;
  }
  if (container.querySelector(".chart-form")) return;
  container.dataset.editing = "true";
  let unmount = () => {};
  const close = () => {
    unmount();
    delete container.dataset.editing;
  };
  unmount = mountChartForm(container, parsed.spec, {
    apply: (spec) => {
      const reason = applyChartSpec(view, code, sourceFrom, sourceTo, spec);
      if (reason === null) close();
      return reason;
    },
    cancel: () => {
      close();
      view.focus();
    },
  });
}
