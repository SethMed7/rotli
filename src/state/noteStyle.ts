// The Aa styling layer (r3 frame C, typography only — heading levels live on
// the format bar per r5). Per-note map, NEVER written into the document —
// persisted to .rotli/settings.json in the shell, the .md file never changes.

import { create } from "zustand";

export type Measure = "narrow" | "comfort" | "wide";

export interface NoteStyle {
  /** Body text size in px (the gate's 14.5 default). */
  size: number;
  measure: Measure;
}

export const DEFAULT_NOTE_STYLE: NoteStyle = { size: 15, measure: "comfort" };

/** Comfort = a roomy centered measure; Narrow/Wide step around it. (Widened
 *  2026-06-26 so a note fills more of a big screen once it's centered.) */
export const MEASURE_MAX_WIDTH: Record<Measure, number> = {
  narrow: 580,
  comfort: 720,
  wide: 900,
};

export const MIN_TEXT_SIZE = 12;
export const MAX_TEXT_SIZE = 20;
export const TEXT_SIZE_STEP = 0.5;

interface NoteStyleState {
  styles: Record<string, NoteStyle>;
  setSize: (noteId: string, size: number) => void;
  setMeasure: (noteId: string, measure: Measure) => void;
}

export const useNoteStyleStore = create<NoteStyleState>((set) => ({
  styles: {},
  setSize: (noteId, size) =>
    set((s) => ({
      styles: {
        ...s.styles,
        [noteId]: {
          ...(s.styles[noteId] ?? DEFAULT_NOTE_STYLE),
          size: Math.min(MAX_TEXT_SIZE, Math.max(MIN_TEXT_SIZE, size)),
        },
      },
    })),
  setMeasure: (noteId, measure) =>
    set((s) => ({
      styles: { ...s.styles, [noteId]: { ...(s.styles[noteId] ?? DEFAULT_NOTE_STYLE), measure } },
    })),
}));

export function useNoteStyle(noteId: string): NoteStyle {
  return useNoteStyleStore((s) => s.styles[noteId]) ?? DEFAULT_NOTE_STYLE;
}
