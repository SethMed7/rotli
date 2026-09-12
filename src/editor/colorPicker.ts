// The `:color` picker: while a color suffix is typed inside a result or toggle
// bracket, list the names in rainbow order; 1–9 and 0 pick by position.

import { createCaretPicker } from "./caretPicker";
import { colorChoices, colorHotkey, colorPickAt } from "./colorPickState";
import { colorEdge, colorValue, type ResultColorName } from "./resultColors";

export const colorPicker = createCaretPicker<ResultColorName>({
  className: "rotli-colorpick",
  label: "Label color",
  numberKeys: true,
  detect(state) {
    const head = state.selection.main.head;
    const line = state.doc.lineAt(head);
    const span = colorPickAt(line.text, head - line.from);
    if (!span) return null;
    const choices = colorChoices(span.query);
    // the name is already complete (a pick just landed): nothing to offer
    if (choices.length === 1 && choices[0] === span.query.toLowerCase()) return null;
    return {
      from: line.from + span.from,
      to: line.from + span.to,
      anchor: line.from + span.from - 1,
      query: span.query,
      choices,
    };
  },
  insert: (name) => name,
  row(node, name, index) {
    node.dataset.color = name;
    node.style.setProperty("--colorpick-color", colorValue(name));
    node.style.setProperty("--colorpick-edge", colorEdge(name));
    const swatch = document.createElement("span");
    swatch.className = "rotli-colorpick-swatch";
    const label = document.createElement("span");
    label.className = "rotli-colorpick-name";
    label.textContent = name;
    const key = document.createElement("kbd");
    key.className = "rotli-colorpick-key";
    key.textContent = colorHotkey(index) ?? "";
    node.append(swatch, label, key);
  },
});
