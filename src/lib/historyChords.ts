// The platform's undo and redo chords, for editors whose vendor doesn't always
// answer them (Univer, in sheets and Word documents: its ⌘Z shortcut stands
// down while a cell is only selected, and it binds redo to ⌘Y): ⌘Z / ⇧⌘Z on
// the Mac, Ctrl+Z / ⇧Ctrl+Z elsewhere.

interface ChordLike {
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

function commandZ(event: ChordLike, isMac: boolean): boolean {
  if (event.code !== "KeyZ" || event.altKey) return false;
  return isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
}

export function isUndoChord(event: ChordLike, isMac: boolean): boolean {
  return commandZ(event, isMac) && !event.shiftKey;
}

export function isRedoChord(event: ChordLike, isMac: boolean): boolean {
  return commandZ(event, isMac) && event.shiftKey;
}
