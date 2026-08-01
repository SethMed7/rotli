// The ONE way to open the System browser at a root (Library / Assets / Archive
// / Trash). It sets three pieces of ui state that must always move together —
// the ⌘N create target, the browser's root, and the content view — so every
// caller (a System row, a roving Enter, a reveal) lands identically.
//
// A store-mutating command module, so it lives in services/ rather than lib/
// (docs/development/adding-things.md).

import { useUiStore } from "../state/ui";

export function openSystemRoot(id: string): void {
  const ui = useUiStore.getState();
  ui.setSelectedFolderId(id);
  ui.setSystemRoot(id);
  ui.setContentView("system");
}
