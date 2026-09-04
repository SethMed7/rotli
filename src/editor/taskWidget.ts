// The source-backed task control used by live preview. Keeping its activation
// and focus policy beside the task grammar prevents the main decoration builder
// from becoming the owner of task-specific interaction state.

import { EditorView, WidgetType } from "@codemirror/view";

import { useUiStore } from "../state/ui";
import { markOf, nextTaskState, type TaskState, TASK_LINE_RE, taskStateOf } from "./taskState";

/** What each state says out loud. "Mark done" cannot describe all three. */
const CHECK_LABEL: Record<TaskState, string> = {
  open: "Not started",
  doing: "In progress",
  done: "Done",
};

export class CheckboxWidget extends WidgetType {
  /** `marker` carries the `1.` glyph of an ordered task. */
  constructor(
    readonly state: TaskState,
    readonly marker: string | null = null,
  ) {
    super();
  }

  eq(other: CheckboxWidget) {
    return other.state === this.state && other.marker === this.marker;
  }

  toDOM(view: EditorView) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = this.state === "open" ? "rotli-check" : `rotli-check ${this.state}`;
    btn.setAttribute("role", "checkbox");
    // "mixed" is ARIA's own word for a partly-checked box — `[/]` is exactly
    // that, so assistive tech reads it without Rotli inventing a vocabulary.
    btn.setAttribute("aria-checked", this.state === "doing" ? "mixed" : String(this.state === "done"));
    btn.setAttribute("aria-label", CHECK_LABEL[this.state]);

    const toggle = (restoreFocus: boolean) => {
      const pos = view.posAtDOM(btn);
      const line = view.state.doc.lineAt(pos);
      const match = TASK_LINE_RE.exec(line.text);
      if (!match) return;
      // Read the setting at activation time so every open editor responds to a
      // change immediately, without a remount or stale extension.
      const threeState = useUiStore.getState().taskCycle === "three";
      const next = `${match[1]}[${markOf(nextTaskState(taskStateOf(match[2] ?? " "), threeState))}] `;
      view.dispatch({ changes: { from: line.from, to: line.from + match[0].length, insert: next } });

      if (restoreFocus) {
        const lineFrom = line.from;
        requestAnimationFrame(() => {
          const replacement = Array.from(view.dom.querySelectorAll<HTMLButtonElement>(".rotli-check")).find(
            (candidate) => view.state.doc.lineAt(view.posAtDOM(candidate)).from === lineFrom,
          );
          replacement?.focus();
        });
      }
    };

    btn.addEventListener("keydown", (event) => {
      if (event.key === "Tab" || event.key === " " || event.key === "Enter") event.stopPropagation();
    });
    // Toggle on mousedown without moving the caret into hidden source.
    btn.addEventListener("mousedown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      toggle(false);
    });
    btn.addEventListener("click", (event) => {
      event.preventDefault();
      // Pointer activation already committed on mousedown. detail=0 identifies
      // keyboard or assistive-technology activation.
      if (event.detail === 0) toggle(true);
    });

    if (!this.marker) return btn;
    const wrap = document.createElement("span");
    const num = document.createElement("span");
    num.className = "rotli-marker num";
    num.textContent = this.marker;
    num.setAttribute("aria-hidden", "true");
    wrap.append(num, btn);
    return wrap;
  }

  ignoreEvent() {
    return false;
  }
}
