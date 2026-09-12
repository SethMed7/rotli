// Where a new item lands in Main. Pure so the rule is testable without stores.

import { MAIN_ROOT, type MainNode, mainParentOfNote } from "../services/mainTree";

/** Beside the note that is open, else the Main root. The last-clicked folder
 * no longer decides: with nothing open, New used to put the note inside the
 * Welcome folder browsed minutes earlier. */
export function newItemParent(tree: MainNode[], focusedId: string | null): string {
  return (focusedId && mainParentOfNote(tree, focusedId)) || MAIN_ROOT;
}
