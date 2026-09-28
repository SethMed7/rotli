// "Copy File Path" from a note's menu (split out of useNoteMenu.ts,
// 2026-09-26): the note's absolute path onto the pasteboard, or a plain row
// error saying why not.

import { corpusNoteAbsolutePath } from "../lib/tauri";
import { useUiStore } from "../state/ui";

export async function copyFilePath(id: string): Promise<void> {
  try {
    const path = await corpusNoteAbsolutePath(id);
    if (!navigator.clipboard) throw new Error("the clipboard is unavailable");
    await navigator.clipboard.writeText(path);
  } catch (err) {
    useUiStore
      .getState()
      .setRowActionError(`Couldn’t copy the file path — ${err instanceof Error ? err.message : String(err)}`);
  }
}
