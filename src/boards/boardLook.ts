// The look an open board takes from the app (2026-09-27): the canvas theme and
// background from brand/boardBackground, for the board tab and a note's board
// embed alike. The file's own background decides whether it was chosen; the
// Settings choice repaints an unchosen board while it is open. A color the
// person picks in the canvas is theirs, and saves as usual.

import { useCallback, useEffect, useMemo, useRef } from "react";

import { boardCanvasLook, boardRepaint } from "../brand/boardBackground";
import { useIsDarkTheme } from "../state/theme";
import { useUiStore } from "../state/ui";

/** The slice of Excalidraw's API the repaint needs. */
export interface BoardLookApi {
  getAppState: () => Record<string, unknown>;
  updateScene: (scene: { appState: Record<string, unknown> }) => void;
}

export function useBoardLook<T>(initialData: T) {
  const mode = useUiStore((s) => s.boardBackground);
  const dark = useIsDarkTheme();
  const scene = initialData as { appState?: Record<string, unknown> } | null;
  const fileBackground = scene?.appState?.viewBackgroundColor;
  const look = boardCanvasLook(mode, typeof fileBackground === "string" ? fileBackground : undefined, dark);
  // the canvas reads initialData once, at mount; later repaints use the API
  const data = useMemo(
    () =>
      (scene
        ? { ...scene, appState: { ...scene.appState, viewBackgroundColor: look.background } }
        : scene) as T,
    [scene, look.background],
  );
  const api = useRef<BoardLookApi | null>(null);
  const bindApi = useCallback((next: unknown) => {
    api.current = next as BoardLookApi;
  }, []);
  useEffect(() => {
    const next = boardRepaint(api.current?.getAppState().viewBackgroundColor, look.background);
    if (next !== null) api.current?.updateScene({ appState: { viewBackgroundColor: next } });
  }, [look.background]);
  return { theme: look.theme, initialData: data, bindApi };
}
