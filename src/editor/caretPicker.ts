// A picker that follows the caret: a CodeMirror tooltip listing choices for
// whatever is being typed (a `:color` suffix, a `[[wikilink`), with one keymap
// (arrows move, Enter/Tab/click pick, Escape dismisses until the caret moves)
// and optional number keys. State lives in a field so the tooltip and keymap
// share it; each picker supplies only its detection, rows, and edit.

import { type EditorState, Prec, StateEffect, StateField } from "@codemirror/state";
import { EditorView, keymap, showTooltip, type Tooltip } from "@codemirror/view";

export interface CaretPick<T> {
  /** Absolute document range the pick replaces. */
  from: number;
  to: number;
  /** Where the tooltip anchors (the trigger's start). */
  anchor: number;
  /** What was typed; a picker keeps its highlight while this is unchanged. */
  query: string;
  choices: T[];
  index: number;
  /** Offer this pick only when typing produced it (or it is already open) —
   * the caret merely arriving at the spot keeps the picker closed. */
  typedOnly?: boolean;
}

export interface CaretPickerSpec<T> {
  /** CSS class and accessible name of the list. */
  className: string;
  label: string;
  /** The current pick for this selection, or null when the picker is closed. */
  detect(state: EditorState): Omit<CaretPick<T>, "index"> | null;
  /** The text that replaces `[from, to)` for a choice. */
  insert(choice: T): string;
  /** Fill one row (already a button with the row class). */
  row(node: HTMLButtonElement, choice: T, index: number): void;
  /** When true, 1–9 and 0 pick by position. */
  numberKeys?: boolean;
}

export function createCaretPicker<T>(spec: CaretPickerSpec<T>) {
  const moveIndex = StateEffect.define<number>();
  const dismissAt = StateEffect.define<number>();

  interface FieldValue {
    pick: CaretPick<T> | null;
    dismissed: number | null;
  }

  const detect = (state: EditorState, dismissed: number | null): CaretPick<T> | null => {
    const range = state.selection.main;
    if (!range.empty || range.head === dismissed) return null;
    const pick = spec.detect(state);
    return pick && pick.choices.length > 0 ? { ...pick, index: 0 } : null;
  };

  const field = StateField.define<FieldValue>({
    create: (state) => {
      const pick = detect(state, null);
      return { pick: pick?.typedOnly ? null : pick, dismissed: null };
    },
    update(value, tr) {
      let dismissed = value.dismissed;
      for (const effect of tr.effects) if (effect.is(dismissAt)) dismissed = effect.value;
      if (!tr.docChanged && !tr.selection && tr.effects.length === 0) return value;
      if (tr.docChanged) dismissed = null;
      let pick = detect(tr.state, dismissed);
      if (pick?.typedOnly && !tr.docChanged && !value.pick) pick = null;
      if (pick && value.pick && value.pick.query === pick.query) {
        pick = { ...pick, index: Math.min(value.pick.index, pick.choices.length - 1) };
      }
      for (const effect of tr.effects) {
        if (effect.is(moveIndex) && pick) {
          pick = { ...pick, index: (pick.index + effect.value + pick.choices.length) % pick.choices.length };
        }
      }
      return { pick, dismissed };
    },
    provide: (self) =>
      showTooltip.compute([self], (state) => {
        const { pick } = state.field(self);
        return pick ? tooltipFor(pick) : null;
      }),
  });

  const apply = (view: EditorView, index?: number): boolean => {
    const { pick } = view.state.field(field);
    if (!pick) return false;
    const choice = pick.choices[index ?? pick.index];
    if (choice === undefined) return false;
    const insert = spec.insert(choice);
    view.dispatch({
      changes: { from: pick.from, to: pick.to, insert },
      selection: { anchor: pick.from + insert.length },
      userEvent: "input",
    });
    return true;
  };

  const tooltipFor = (pick: CaretPick<T>): Tooltip => ({
    pos: pick.anchor,
    above: false,
    strictSide: false,
    create: (view) => {
      const dom = document.createElement("div");
      dom.className = spec.className;
      dom.setAttribute("role", "listbox");
      dom.setAttribute("aria-label", spec.label);
      const render = () => {
        const current = view.state.field(field).pick ?? pick;
        dom.replaceChildren(
          ...current.choices.map((choice, index) => {
            const row = document.createElement("button");
            row.type = "button";
            row.className = `${spec.className}-row${index === current.index ? " is-active" : ""}`;
            row.setAttribute("role", "option");
            row.setAttribute("aria-selected", String(index === current.index));
            spec.row(row, choice, index);
            // mousedown keeps the editor's focus and caret; the click picks
            row.addEventListener("mousedown", (event) => event.preventDefault());
            row.addEventListener("click", () => apply(view, index));
            return row;
          }),
        );
      };
      render();
      return { dom, update: render };
    },
  });

  const whenOpen =
    (run: (view: EditorView) => boolean) =>
    (view: EditorView): boolean =>
      view.state.field(field).pick ? run(view) : false;
  const bindings = [
    { key: "ArrowDown", run: whenOpen((view) => (view.dispatch({ effects: moveIndex.of(1) }), true)) },
    { key: "ArrowUp", run: whenOpen((view) => (view.dispatch({ effects: moveIndex.of(-1) }), true)) },
    { key: "Enter", run: whenOpen((view) => apply(view)) },
    { key: "Tab", run: whenOpen((view) => apply(view)) },
    {
      key: "Escape",
      run: whenOpen(
        (view) => (view.dispatch({ effects: dismissAt.of(view.state.selection.main.head) }), true),
      ),
    },
    ...(spec.numberKeys
      ? ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"].map((key, index) => ({
          key,
          run: whenOpen((view) => apply(view, index)),
        }))
      : []),
  ];
  return [field, Prec.highest(keymap.of(bindings))];
}
