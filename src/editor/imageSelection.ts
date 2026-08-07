export interface TextSelection {
  from: number;
  to: number;
}

/** True when a non-empty selection contains the complete image source span. */
export function selectionCoversImage(selection: TextSelection, from: number, to: number): boolean {
  return selection.from < selection.to && selection.from <= from && selection.to >= to;
}
