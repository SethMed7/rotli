// The recovery journal's view of the editor's buffers: every buffer with edits
// not yet on disk, with the baseline it was typed against, so a page that
// unloads mid-save can finish it next boot (Rotli Web writes it from
// components/onboarding/webVaultOverlays.tsx). Read-only: the buffers are the
// model's (model.ts), which hands each one over as it reads it.

import type { Note } from "../types";
import { dirtyNoteIds } from "./saveStatus";

/** A buffer with edits not yet on disk: its text and the baseline it was
 * typed against, so a page that unloads mid-save can finish it next boot. */
export interface UnsavedDraft {
  noteId: string;
  body: string;
  expectedRevision: string;
  expectedBody: string;
  protection?: { secure: boolean; locked: boolean };
}

/** One buffer as the model holds it. */
interface Buffer {
  lines: readonly string[] | undefined;
  /** A Command-T buffer with no file yet. */
  pending: boolean;
  revision: string | undefined;
  persisted: string | undefined;
}

const protections = new Map<string, { secure: boolean; locked: boolean }>();

export function setDocumentProtection(noteId: string, note: Pick<Note, "secure" | "locked">): void {
  protections.set(noteId, { secure: note.secure === true, locked: note.locked === true });
}

/** What the note's last read said about its protection, if anything. */
export function protectionOf(noteId: string): { secure: boolean; locked: boolean } | undefined {
  return protections.get(noteId);
}

export function forgetProtection(noteId: string): void {
  protections.delete(noteId);
}

/** Every dirty buffer, read synchronously (an unloading page can't await). */
export function draftsOf(buffer: (noteId: string) => Buffer): UnsavedDraft[] {
  const out: UnsavedDraft[] = [];
  for (const noteId of dirtyNoteIds()) {
    const { lines, pending, revision, persisted } = buffer(noteId);
    if (pending) {
      const body = lines?.join("\n") ?? "";
      if (body.trim())
        out.push({
          noteId,
          body,
          expectedRevision: "0",
          expectedBody: "",
          protection: { secure: false, locked: false },
        });
      continue;
    }
    if (lines && revision && persisted !== undefined) {
      out.push({
        noteId,
        body: lines.join("\n"),
        expectedRevision: revision,
        expectedBody: persisted,
        ...(protections.has(noteId) ? { protection: protections.get(noteId)! } : {}),
      });
    }
  }
  return out;
}
