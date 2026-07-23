/**
 * A folder already supplies context in the tree, so repeating its exact label
 * at the start of every child note wastes the row's scarce horizontal space.
 * This is presentation only: note Markdown remains the durable title truth.
 */
export function noteDisplayTitle(title: string, parentFolderName?: string): string {
  const noteTitle = title.trim();
  const folderName = parentFolderName?.trim();
  if (!noteTitle || !folderName) return noteTitle;

  const escapedFolder = folderName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const redundantPrefix = new RegExp(`^${escapedFolder}\\s*(?:—|–|-|:)\\s+(.+)$`, "i");
  const match = redundantPrefix.exec(noteTitle);
  return match?.[1]?.trim() || noteTitle;
}
