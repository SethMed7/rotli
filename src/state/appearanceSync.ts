// Appearance follows the user everywhere — one hook, three effects:
//
// 1. The MAIN window broadcasts every app setting (theme, accent, quokka,
//    syntax palette, hotkey peek, rebinds, per-note typography) to the quick
//    and capture webviews so they follow live instead of reading settings at
//    launch and going stale (issue #4; widened to the full snapshot 2026-09-01).
//    Main is the source and never listens; the others listen and never emit.
// 2. Every other webview applies what main broadcast.
// 3. Breve's PDFs follow the app theme (2026-09-02): after the theme/accent
//    has landed on :root, main reads its six live tokens and hands them to
//    Rust, which merges only `pdfTheme.resolved` into the routine config the
//    renderer reads — skipped when Breve is not set up in this vault, or when
//    nothing changed. The short delay lets the stylesheet settle first.
//
// Lifted out of app.tsx so the shell composes effects instead of carrying
// them (its line ceiling is a ratchet).

import { useEffect } from "react";

import { readDocumentPdfPalette } from "../brand/pdfPalette";
import { useBindingsStore } from "../keys/bindings";
import type { Surface } from "../keys/registry";
import { breveWritePdfPalette, emitAppearance, isTauri, onAppearance } from "../lib/tauri";
import { applyAppearanceLookBroadcast, useAppearanceLook } from "./appearanceLook";
import { useNoteStyleStore } from "./noteStyle";
import { type AppearanceBroadcast, appearanceBroadcast, applyAppearanceBroadcast } from "./persist";
import { useDataTheme } from "./theme";
import { useUiStore } from "./ui";

const PDF_PALETTE_SETTLE_MS = 250;

/** Emit the current appearance once, then again whenever any of the three
 * stores changes it — but never twice for the same serialized payload (a
 * store write that touches nothing the payload carries stays silent).
 * Returns the unsubscribe. */
export function startAppearanceBroadcast(emit: (payload: AppearanceBroadcast) => void): () => void {
  let last = "";
  const push = (): void => {
    const payload = appearanceBroadcast();
    const key = `${payload.app}\u0000${payload.noteStyles}`;
    if (key === last) return;
    last = key;
    emit(payload);
  };
  push();
  const unsubs = [
    useUiStore.subscribe(push),
    useBindingsStore.subscribe(push),
    useNoteStyleStore.subscribe(push),
    useAppearanceLook.subscribe(push),
  ];
  return () => {
    for (const unsub of unsubs) unsub();
  };
}

export function useAppearanceSync(surface: Surface): void {
  const accentColor = useUiStore((s) => s.accentColor);
  const accentHue = useUiStore((s) => s.accentHue);
  const dataTheme = useDataTheme();

  useEffect(() => {
    if (surface !== "main" || !isTauri()) return;
    return startAppearanceBroadcast(emitAppearance);
  }, [surface]);

  useEffect(() => {
    if (surface === "main") return;
    return onAppearance((payload) => {
      applyAppearanceBroadcast(payload);
      applyAppearanceLookBroadcast(payload.app);
    });
  }, [surface]);

  useEffect(() => {
    if (surface !== "main" || !isTauri()) return;
    const timer = window.setTimeout(() => {
      const palette = readDocumentPdfPalette(dataTheme);
      if (palette) void breveWritePdfPalette(palette).catch(() => {});
    }, PDF_PALETTE_SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [surface, dataTheme, accentColor, accentHue]);
}
