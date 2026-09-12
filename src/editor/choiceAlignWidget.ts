// Placement control for a `[##?]` prompt row. The choice is source-backed: the
// buttons rewrite the marker suffix, so the panel reads the same in any editor.

import { EditorView, WidgetType } from "@codemirror/view";

import { type ChoicePromptAlign, setChoicePromptAlign } from "./controlState";

const ALIGNMENTS: readonly ChoicePromptAlign[] = ["left", "center", "right"];
const LABEL: Record<ChoicePromptAlign, string> = { left: "Left", center: "Center", right: "Right" };

export class ChoiceAlignWidget extends WidgetType {
  constructor(
    readonly align: ChoicePromptAlign,
    readonly touched: boolean,
  ) {
    super();
  }

  eq(other: ChoiceAlignWidget) {
    return other.align === this.align && other.touched === this.touched;
  }

  toDOM(view: EditorView) {
    const group = document.createElement("span");
    group.className = `rotli-choice-align${this.touched ? " is-touched" : ""}`;
    group.setAttribute("role", "radiogroup");
    group.setAttribute("aria-label", "Panel alignment");
    for (const align of ALIGNMENTS) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `rotli-choice-align-option${align === this.align ? " is-selected" : ""}`;
      btn.dataset.align = align;
      btn.textContent = LABEL[align];
      btn.setAttribute("role", "radio");
      btn.setAttribute("aria-checked", String(align === this.align));
      btn.setAttribute("aria-label", `Align panel ${align}`);
      const apply = (restoreFocus: boolean) => {
        const line = view.state.doc.lineAt(view.posAtDOM(group));
        const next = setChoicePromptAlign(line.text, align);
        if (next === null || next === line.text) return;
        view.dispatch({ changes: { from: line.from, to: line.to, insert: next }, userEvent: "input" });
        if (!restoreFocus) return;
        const lineFrom = line.from;
        requestAnimationFrame(() => {
          const replacement = Array.from(
            view.dom.querySelectorAll<HTMLButtonElement>(`.rotli-choice-align-option[data-align="${align}"]`),
          ).find((candidate) => view.state.doc.lineAt(view.posAtDOM(candidate)).from === lineFrom);
          replacement?.focus();
        });
      };
      btn.addEventListener("keydown", (event) => {
        if (event.key === "Tab" || event.key === " " || event.key === "Enter") event.stopPropagation();
      });
      btn.addEventListener("mousedown", (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        apply(false);
      });
      btn.addEventListener("click", (event) => {
        event.preventDefault();
        if (event.detail === 0) apply(true);
      });
      group.append(btn);
    }
    return group;
  }

  ignoreEvent() {
    return false;
  }
}
