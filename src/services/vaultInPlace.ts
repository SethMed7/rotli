// Whether the active vault is a folder connected in place (protected): set
// from its config at boot and on every vault switch (fsNotes.syncFolderRoles).
// A leaf with no imports, so the notes service and the Librarian switch can
// both read it without a cycle.

let inPlace = false;

export function setOpenedInPlace(value: boolean): void {
  inPlace = value;
}

export function openedInPlace(): boolean {
  return inPlace;
}
