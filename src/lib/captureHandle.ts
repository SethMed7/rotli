// The mounted capture card registers itself here; the registry's capture.*
// actions route through this handle (same pattern as the editor's
// activeEditor seam) — no keydown listeners on the card itself.

export interface CaptureHandle {
  /** Save the field into Inbox; openAfter reveals the main window on the new note. */
  save(openAfter: boolean): void;
  dismiss(): void;
}

let current: CaptureHandle | null = null;

export function setCaptureHandle(handle: CaptureHandle | null): void {
  current = handle;
}

export function captureHandle(): CaptureHandle | null {
  return current;
}
