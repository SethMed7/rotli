// The Excalidraw canvas surface — mounted for a CanvasTab (surfaceKind:"canvas")
// the same way EditorSurface is for a note. The board is a real *.excalidraw
// file in the corpus (id === its corpus-relative path); the file is the source
// of truth. On mount we read its raw JSON, parse it into a scene, and save back
// (debounced) on every change. Outside the Tauri shell the corpus doesn't exist,
// so we render a themed placeholder instead. Kit tokens only (styles/canvas.css).

import { Excalidraw } from "@excalidraw/excalidraw";
import { useCallback, useEffect, useRef, useState } from "react";
import { type CorpusBoardDoc, corpusReadBoard, corpusWriteBoard, isTauri } from "../lib/tauri";
import { useUiStore } from "../state/ui";

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

interface BoardMeta {
  description: string;
  tags: string;
}
const EMPTY_META: BoardMeta = { description: "", tags: "" };
/** The slice of Excalidraw's imperative API we use to re-serialize the scene on a
 * metadata save (a metadata edit isn't an Excalidraw change, so we rebuild it). */
type ExcaliApi = {
  getSceneElements: () => readonly unknown[];
  getAppState: () => Record<string, unknown>;
  getFiles: () => Record<string, unknown>;
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

  // a new board opens in the app's color mode (dark/light), not always-light —
  // Excalidraw's `theme` prop follows the rotli theme (Seth, 2026-06-26).
  const themeMode = useUiStore((s) => s.theme);
  const excaliTheme: "dark" | "light" =
    themeMode === "dark" ||
    (themeMode === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches)
      ? "dark"
      : "light";

  const [state, setState] = useState<CanvasState>({ status: "loading", initialData: null });
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // serialize the latest scene; the debounced write picks up the freshest one.
  const pending = useRef<string | null>(null);

  // G — board metadata (Seth, 2026-06-26): a board is an image to a text LLM, so it
  // carries a description + tags, stored TOP-LEVEL in the .excalidraw (NOT in
  // appState, which Excalidraw would strip) so the AI can know + search it later.
  const apiRef = useRef<ExcaliApi | null>(null);
  const metaRef = useRef<BoardMeta>(EMPTY_META);
  const [meta, setMeta] = useState<BoardMeta>(EMPTY_META);
  const [metaOpen, setMetaOpen] = useState(false);

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
        const rm = (scene as { rotliMeta?: Partial<BoardMeta> }).rotliMeta;
        const loaded: BoardMeta = { description: rm?.description ?? "", tags: rm?.tags ?? "" };
        metaRef.current = loaded;
        setMeta(loaded);
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
        rotliMeta: metaRef.current,
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

  // Persist a metadata edit right away (it doesn't ride the Excalidraw onChange
  // save). Re-serialize the live scene from the API + the new meta.
  const saveMeta = useCallback(
    (next: BoardMeta) => {
      metaRef.current = next;
      setMeta(next);
      const api = apiRef.current;
      if (!api || !isTauri()) return;
      const scene = {
        type: "excalidraw" as const,
        version: 2,
        source: "rotli",
        elements: api.getSceneElements(),
        appState: { ...api.getAppState(), collaborators: undefined },
        files: api.getFiles(),
        rotliMeta: next,
      };
      void corpusWriteBoard(boardId, JSON.stringify(scene)).catch(() => {});
    },
    [boardId],
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
      <Excalidraw
        initialData={state.initialData}
        onChange={onChange}
        theme={excaliTheme}
        excalidrawAPI={(api) => {
          apiRef.current = api as unknown as ExcaliApi;
        }}
      />
      <button
        type="button"
        className="canvas-meta-btn"
        aria-label="Board info — a description + tags so the AI can find and use this board"
        title="About this board (for AI search)"
        onClick={() => setMetaOpen((o) => !o)}
      >
        ⓘ
      </button>
      {metaOpen && (
        <div className="canvas-meta-panel">
          <div className="cmp-title">About this board</div>
          <p className="cmp-hint">
            A board is just an image to the AI — describe it so it can find and pull it into a chat.
          </p>
          <label className="cmp-field">
            <span>Description</span>
            <textarea
              defaultValue={meta.description}
              placeholder="What's on this board, and what it's for…"
              onBlur={(e) => saveMeta({ ...metaRef.current, description: e.currentTarget.value })}
            />
          </label>
          <label className="cmp-field">
            <span>Tags</span>
            <input
              type="text"
              defaultValue={meta.tags}
              placeholder="comma, separated"
              onBlur={(e) => saveMeta({ ...metaRef.current, tags: e.currentTarget.value })}
            />
          </label>
        </div>
      )}
    </div>
  );
}
