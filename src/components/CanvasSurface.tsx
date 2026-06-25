// The Excalidraw canvas surface — mounted for a CanvasTab (surfaceKind:"canvas")
// the same way EditorSurface is for a note. The board is a real *.excalidraw
// file in the corpus (id === its corpus-relative path); the file is the source
// of truth. On mount we read its raw JSON, parse it into a scene, and save back
// (debounced) on every change. Outside the Tauri shell the corpus doesn't exist,
// so we render a themed placeholder instead. Kit tokens only (styles/canvas.css).

import { Excalidraw } from "@excalidraw/excalidraw";
import { useCallback, useEffect, useRef, useState } from "react";
import { type CorpusBoardDoc, corpusReadBoard, corpusWriteBoard, isTauri } from "../lib/tauri";

const SAVE_DEBOUNCE_MS = 500;

/** A minimal valid empty Excalidraw scene (used when the file is empty/new or
 * the JSON fails to parse — never throw a blank board away). */
const EMPTY_SCENE = {
  type: "excalidraw" as const,
  version: 2,
  source: "rotli",
  elements: [],
  appState: {},
  files: {},
};

// Excalidraw's initialData prop is optional (`| undefined`); we never pass
// undefined — we hold `null` until loaded, then the parsed scene — so strip the
// undefined to satisfy exactOptionalPropertyTypes at the call site.
type ExcalidrawInitialData = NonNullable<Parameters<typeof Excalidraw>[0]["initialData"]> | null;

interface CanvasState {
  status: "loading" | "ready" | "error";
  initialData: ExcalidrawInitialData;
  error?: string;
}

export function CanvasSurface({ paneId, boardId }: { paneId: string; boardId: string }) {
  // paneId is accepted to match the EditorSurface seam (PaneTree passes it);
  // the canvas doesn't need it yet, but keeping the signature parallel avoids a
  // special-case at the call site.
  void paneId;

  const [state, setState] = useState<CanvasState>({ status: "loading", initialData: null });
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // serialize the latest scene; the debounced write picks up the freshest one.
  const pending = useRef<string | null>(null);

  // load the board once per boardId
  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    setState({ status: "loading", initialData: null });
    corpusReadBoard(boardId)
      .then((doc: CorpusBoardDoc) => {
        if (cancelled) return;
        let scene: unknown = EMPTY_SCENE;
        const raw = doc.body.trim();
        if (raw) {
          try {
            scene = JSON.parse(raw);
          } catch {
            scene = EMPTY_SCENE; // corrupt JSON => start from a blank scene
          }
        }
        setState({ status: "ready", initialData: scene as ExcalidrawInitialData });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState({
          status: "error",
          initialData: null,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [boardId]);

  // flush any pending save when the board changes or the surface unmounts
  const flush = useCallback(() => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    const body = pending.current;
    pending.current = null;
    if (body !== null && isTauri()) void corpusWriteBoard(boardId, body).catch(() => {});
  }, [boardId]);

  useEffect(() => () => flush(), [flush]);

  const onChange = useCallback(
    (
      elements: Parameters<NonNullable<Parameters<typeof Excalidraw>[0]["onChange"]>>[0],
      appState: Parameters<NonNullable<Parameters<typeof Excalidraw>[0]["onChange"]>>[1],
      files: Parameters<NonNullable<Parameters<typeof Excalidraw>[0]["onChange"]>>[2],
    ) => {
      // Don't write while still loading (the initialData render fires onChange).
      if (state.status !== "ready") return;
      const scene = {
        type: "excalidraw" as const,
        version: 2,
        source: "rotli",
        elements,
        // strip volatile UI cruft so saves stay diff-friendly
        appState: {
          ...appState,
          collaborators: undefined,
          // don't persist transient selection/dragging state
        },
        files,
      };
      pending.current = JSON.stringify(scene);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        const body = pending.current;
        pending.current = null;
        saveTimer.current = null;
        if (body !== null && isTauri()) void corpusWriteBoard(boardId, body).catch(() => {});
      }, SAVE_DEBOUNCE_MS);
    },
    [boardId, state.status],
  );

  if (!isTauri()) {
    return (
      <div className="canvas-surface canvas-placeholder">
        <div className="canvas-placeholder-card">
          <strong>Excalidraw board</strong>
          <span>Boards live in the corpus — open rotli to draw.</span>
        </div>
      </div>
    );
  }

  if (state.status === "loading") {
    return (
      <div className="canvas-surface canvas-placeholder">
        <div className="canvas-placeholder-card">
          <span>Loading board…</span>
        </div>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="canvas-surface canvas-placeholder">
        <div className="canvas-placeholder-card">
          <strong>Couldn’t open this board</strong>
          <span>{state.error}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="canvas-surface">
      <Excalidraw initialData={state.initialData} onChange={onChange} />
    </div>
  );
}
