// Source-backed result controls for live preview. Compact `[][]` keeps its
// pass/fail semantics; labeled adjacent boxes share the same exclusive write
// policy while preserving every user-authored label and color suffix.

import { EditorView, WidgetType } from "@codemirror/view";

import {
  chooseResult,
  RESULT_REASON_SEPARATOR,
  type ResultChoice,
  type ResultColor,
  type ResultOption,
} from "./resultState";

function colorValue(color: ResultColor | null): string {
  if (color === null || color === "accent") return "var(--accent)";
  if (color === "green") return "var(--success)";
  if (color === "yellow") return "var(--accent-swatch-amber)";
  if (color === "red") return "var(--failure)";
  if (color === "neutral") return "var(--text-muted)";
  return color;
}

function selectedInk(color: ResultColor | null): string {
  if (color === null || color === "accent") return "var(--on-accent)";
  if (color === "green") return "var(--check-ink)";
  if (color === "yellow") return "var(--rotli-cocoa)";
  if (color === "red") return "var(--on-accent)";
  if (color === "neutral") return "var(--surface)";
  const value = color.slice(1);
  const full = value.length === 3 ? value.replace(/(.)/g, "$1$1") : value;
  const channels = [0, 2, 4].map((at) => Number.parseInt(full.slice(at, at + 2), 16) / 255);
  const linear = channels.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  const luminance = 0.2126 * (linear[0] ?? 0) + 0.7152 * (linear[1] ?? 0) + 0.0722 * (linear[2] ?? 0);
  return luminance > 0.42 ? "var(--rotli-cocoa)" : "var(--rotli-linen)";
}

export class ResultWidget extends WidgetType {
  constructor(
    readonly options: ResultOption[],
    readonly compact: boolean,
    readonly marker: string | null = null,
  ) {
    super();
  }

  eq(other: ResultWidget) {
    return (
      other.marker === this.marker &&
      other.compact === this.compact &&
      other.options.length === this.options.length &&
      other.options.every((option, index) => {
        const mine = this.options[index];
        return (
          mine?.label === option.label &&
          mine.selected === option.selected &&
          mine.color === option.color &&
          mine.source === option.source
        );
      })
    );
  }

  toDOM(view: EditorView) {
    const controls = document.createElement("span");
    controls.className = this.compact ? "rotli-result" : "rotli-result is-labeled";
    controls.setAttribute("role", "group");
    controls.setAttribute("aria-label", this.compact ? "Yes or no result" : "Choose one result");

    const choose = (choice: ResultChoice | number, restoreFocus: boolean) => {
      const pos = view.posAtDOM(controls);
      const line = view.state.doc.lineAt(pos);
      const next = chooseResult(line.text, choice);
      if (!next || next === line.text) return;
      view.dispatch({ changes: { from: line.from, to: line.to, insert: next }, userEvent: "input" });
      if (!restoreFocus) return;
      const lineFrom = line.from;
      const index = typeof choice === "number" ? choice : choice === "yes" ? 0 : 1;
      requestAnimationFrame(() => {
        const replacement = Array.from(
          view.dom.querySelectorAll<HTMLButtonElement>(`.rotli-result-choice[data-result-index="${index}"]`),
        ).find((candidate) => view.state.doc.lineAt(view.posAtDOM(candidate)).from === lineFrom);
        replacement?.focus();
      });
    };

    const button = (option: ResultOption, index: number) => {
      const choice: ResultChoice | number = this.compact ? (index === 0 ? "yes" : "no") : index;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `rotli-result-choice${this.compact ? ` rotli-result-choice--${choice}` : " is-labeled"}${option.selected ? " is-selected" : ""}`;
      btn.textContent = this.compact ? (index === 0 ? "✓" : "×") : option.label;
      btn.dataset.resultIndex = String(index);
      btn.style.setProperty("--result-color", colorValue(option.color));
      btn.style.setProperty("--result-selected-ink", selectedInk(option.color));
      const label = this.compact ? (index === 0 ? "Yes or passed" : "No or failed") : option.label;
      btn.setAttribute("aria-label", label);
      btn.setAttribute("aria-pressed", String(option.selected));
      btn.title = label;
      btn.addEventListener("keydown", (event) => {
        if (event.key === "Tab" || event.key === " " || event.key === "Enter") event.stopPropagation();
      });
      btn.addEventListener("mousedown", (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        choose(choice, false);
      });
      btn.addEventListener("click", (event) => {
        event.preventDefault();
        if (event.detail === 0) choose(choice, true);
      });
      return btn;
    };

    controls.append(...this.options.map(button));
    if (!this.marker) return controls;
    const wrap = document.createElement("span");
    const num = document.createElement("span");
    num.className = "rotli-marker num";
    num.textContent = this.marker;
    num.setAttribute("aria-hidden", "true");
    wrap.append(num, controls);
    return wrap;
  }

  ignoreEvent() {
    return false;
  }
}

export class ResultReasonWidget extends WidgetType {
  eq() {
    return true;
  }

  toDOM(view: EditorView) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "rotli-result-reason-add";
    btn.textContent = "+ reason";
    btn.setAttribute("aria-label", "Add a reason for this result");
    const add = () => {
      const pos = view.posAtDOM(btn);
      const line = view.state.doc.lineAt(pos);
      view.dispatch({
        changes: { from: line.to, insert: RESULT_REASON_SEPARATOR },
        selection: { anchor: line.to + RESULT_REASON_SEPARATOR.length },
        scrollIntoView: true,
        userEvent: "input",
      });
      view.focus();
    };
    btn.addEventListener("keydown", (event) => {
      if (event.key === "Tab" || event.key === " " || event.key === "Enter") event.stopPropagation();
    });
    btn.addEventListener("mousedown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      add();
    });
    btn.addEventListener("click", (event) => {
      event.preventDefault();
      if (event.detail === 0) add();
    });
    return btn;
  }

  ignoreEvent() {
    return false;
  }
}
