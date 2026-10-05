// The chart block's Edit form (SYNTAX.md, the ```chart fence): type, title,
// unit, and a grid of the rows. Plain DOM inside the CodeMirror widget, like
// the table editor. Apply builds a spec, runs it through the same parser the
// fence uses (so the form can never write what the fence would refuse), and
// hands it to the host, which replaces only the fence body.

import {
  CHART_LIMITS,
  CHART_TYPES,
  type ChartSpec,
  type ChartType,
  parseChart,
  serializeChart,
} from "./chartSpec";

const TYPE_LABELS: Record<ChartType, string> = { bar: "Bar", line: "Line", area: "Area", pie: "Pie" };

export interface ChartFormActions {
  /** Write the spec; returns why it couldn't, or null when written. */
  apply: (spec: ChartSpec) => string | null;
  cancel: () => void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function textInput(value: string, label: string, className = "chart-form-input"): HTMLInputElement {
  const input = el("input", className);
  input.type = "text";
  input.value = value;
  input.setAttribute("aria-label", label);
  input.spellcheck = false;
  return input;
}

function button(text: string, label: string, onClick: () => void, className = "chart-form-btn") {
  const node = el("button", className, text);
  node.type = "button";
  node.setAttribute("aria-label", label);
  node.addEventListener("click", onClick);
  return node;
}

/** The form's working copy, read back from its inputs on every change. */
interface Draft {
  type: ChartType;
  title: string;
  unit: string;
  columns: string[];
  rows: { label: string; values: string[] }[];
}

function draftOf(spec: ChartSpec): Draft {
  return {
    type: spec.type,
    title: spec.title ?? "",
    unit: spec.unit ?? "",
    columns: [...spec.columns],
    rows: spec.rows.map((row) => ({
      label: row.label,
      values: row.values.map((value) => (value === null ? "" : String(value))),
    })),
  };
}

/** A draft as a spec, or why it isn't one — the fence parser is the judge. */
export function specFromDraft(draft: Draft): { ok: true; spec: ChartSpec } | { ok: false; reason: string } {
  for (const [r, row] of draft.rows.entries()) {
    for (const value of row.values) {
      const trimmed = value.trim();
      if (trimmed !== "" && !/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
        return { ok: false, reason: `“${trimmed}” in row ${r + 1} isn’t a number.` };
      }
    }
  }
  const spec: ChartSpec = {
    type: draft.type,
    title: draft.title.trim(),
    unit: draft.unit.trim(),
    columns: draft.columns.map((name) => name.trim()),
    rows: draft.rows.map((row) => ({
      label: row.label.trim(),
      values: row.values.map((value) => (value.trim() === "" ? null : Number(value.trim()))),
    })),
  };
  return parseChart(serializeChart(spec));
}

export function mountChartForm(host: HTMLElement, spec: ChartSpec, actions: ChartFormActions): () => void {
  const draft = draftOf(spec);
  const form = el("div", "chart-form");
  form.setAttribute("role", "group");
  form.setAttribute("aria-label", "Edit chart");
  const status = el("p", "chart-form-status");
  status.setAttribute("role", "alert");

  const render = () => {
    form.replaceChildren();
    const head = el("div", "chart-form-head");
    const type = el("select", "chart-form-select");
    type.setAttribute("aria-label", "Chart type");
    for (const value of CHART_TYPES) {
      const option = el("option", undefined, TYPE_LABELS[value]);
      option.value = value;
      option.selected = value === draft.type;
      type.append(option);
    }
    type.addEventListener("change", () => {
      draft.type = type.value as ChartType;
      render(); // a pie draws one series, so it offers no "+ Series"
      form.querySelector<HTMLSelectElement>(".chart-form-select")?.focus();
    });
    const title = textInput(draft.title, "Chart title");
    title.placeholder = "Title";
    title.addEventListener("input", () => (draft.title = title.value));
    const unit = textInput(draft.unit, "Unit", "chart-form-input chart-form-unit");
    unit.placeholder = "Unit";
    unit.addEventListener("input", () => (draft.unit = unit.value));
    head.append(type, title, unit);

    const table = el("table", "chart-form-grid");
    const headerRow = el("tr");
    draft.columns.forEach((name, c) => {
      const cell = el("th");
      const input = textInput(name, c === 0 ? "Label column name" : `Series ${c} name`);
      input.addEventListener("input", () => (draft.columns[c] = input.value));
      cell.append(input);
      if (c > 0 && draft.columns.length > 2) {
        cell.append(
          button("×", `Remove series ${name || c}`, () => {
            draft.columns.splice(c, 1);
            for (const row of draft.rows) row.values.splice(c - 1, 1);
            render();
          }),
        );
      }
      headerRow.append(cell);
    });
    const corner = el("th");
    if (draft.type !== "pie" && draft.columns.length - 1 < CHART_LIMITS.series) {
      corner.append(
        button("+ Series", "Add a series", () => {
          draft.columns.push(`Series ${draft.columns.length}`);
          for (const row of draft.rows) row.values.push("");
          render();
        }),
      );
    }
    headerRow.append(corner);
    table.append(headerRow);

    draft.rows.forEach((row, r) => {
      const line = el("tr");
      const labelCell = el("td");
      const label = textInput(row.label, `Row ${r + 1} label`);
      label.addEventListener("input", () => (row.label = label.value));
      labelCell.append(label);
      line.append(labelCell);
      row.values.forEach((value, s) => {
        const cell = el("td");
        const input = textInput(value, `Row ${r + 1}, ${draft.columns[s + 1] || `series ${s + 1}`}`);
        input.inputMode = "decimal";
        input.addEventListener("input", () => (row.values[s] = input.value));
        cell.append(input);
        line.append(cell);
      });
      const tail = el("td");
      if (draft.rows.length > 1) {
        tail.append(
          button("×", `Remove row ${r + 1}`, () => {
            draft.rows.splice(r, 1);
            render();
          }),
        );
      }
      line.append(tail);
      table.append(line);
    });

    const foot = el("div", "chart-form-foot");
    if (draft.rows.length < CHART_LIMITS.rows) {
      foot.append(
        button("+ Row", "Add a row", () => {
          draft.rows.push({ label: "", values: draft.columns.slice(1).map(() => "") });
          render();
          form.querySelector<HTMLInputElement>("tr:last-child input")?.focus();
        }),
      );
    }
    const spacer = el("span", "chart-form-spacer");
    const cancel = button("Cancel", "Cancel editing the chart", () => actions.cancel());
    const apply = button("Apply", "Apply the chart", () => submit(), "chart-form-btn chart-form-apply");
    foot.append(spacer, cancel, apply);
    form.append(head, table, status, foot);
  };

  const submit = () => {
    const result = specFromDraft(draft);
    const reason = result.ok ? actions.apply(result.spec) : result.reason;
    status.textContent = reason ?? "";
  };

  form.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      actions.cancel();
    } else if (event.key === "Enter" && event.target instanceof HTMLInputElement) {
      event.preventDefault();
      submit();
    }
  });

  render();
  host.append(form);
  form.querySelector<HTMLElement>("select, input")?.focus();
  return () => form.remove();
}
