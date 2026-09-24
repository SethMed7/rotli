/** Mounted presentation surfaces register the commands that require their live
 * component state here. The central key registry routes actions through these
 * handles, so surfaces never install parallel global command listeners. */

export interface CaptureHandle {
  /** Save the field into Inbox; openAfter reveals the main window on the new note. */
  save(openAfter: boolean): void;
  dismiss(): void;
}

export interface QuickHandle {
  /** Create a fresh note in the quick folder, file it into Main, and open it
   * (not pinned — ★ pins deliberately). */
  newNote(): void;
  /** Open the search-and-swap overlay. */
  openSearch(): void;
  /** With the overlay open, open its row at this 0-based index (⌘1–⌘9,
   * ⌘⇧1–⌘⇧9); does nothing while it is closed. */
  openRow(index: number): void;
}

export interface SetupHandle {
  continue(): void;
  back?: () => void;
}

let currentCapture: CaptureHandle | null = null;
let currentQuick: QuickHandle | null = null;
let currentSetup: SetupHandle | null = null;

export function setCaptureHandle(handle: CaptureHandle | null): void {
  currentCapture = handle;
}

export function captureHandle(): CaptureHandle | null {
  return currentCapture;
}

export function setQuickHandle(handle: QuickHandle | null): void {
  currentQuick = handle;
}

export function quickHandle(): QuickHandle | null {
  return currentQuick;
}

export function setSetupHandle(handle: SetupHandle | null): void {
  currentSetup = handle;
}

export function setupHandle(): SetupHandle | null {
  return currentSetup;
}
