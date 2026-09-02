// The Excalidraw canvas surface — mounted for a CanvasTab (surfaceKind:"canvas")
// the same way EditorSurface is for a note. The board is a real *.excalidraw
// file in the corpus (id === its corpus-relative path); the file is the source
// of truth. On mount we read its raw JSON, parse it into a scene, and save back
// (debounced) on every change. Outside the Tauri shell the corpus doesn't exist,
// so we render a themed placeholder instead. Kit tokens only (styles/canvas.css).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  createCorpusBoardSaver,
  loadBoard,
  replaceCorruptBoardWithEmptyScene,
  revealBoardSource,
} from "../boards/composition";
import {
  type BoardChangeAppState,
  type BoardChangeElements,
  type BoardChangeFiles,
  type BoardInitialData,
  BoardCanvas,
} from "../boards/engine/excalidraw";
import { type BoardMeta, EMPTY_BOARD_META, serializeBoardScene } from "../boards/session";
import { onQuitFlush } from "../lib/quitFlush";
import { isTauri } from "../lib/tauri";
import { keepTabsFor } from "../state/panes";
import { useIsDarkTheme } from "../state/theme";

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
type ExcalidrawInitialData = BoardInitialData;

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
  // Excalidraw's `theme` prop follows the rotli theme (the maintainer, 2026-06-26).
  // the applied data-theme, live — a System-mode OS flip re-themes an open
  // board too (it used to read matchMedia once and go stale)
  const excaliTheme: "dark" | "light" = useIsDarkTheme() ? "dark" : "light";

  const [state, setState] = useState<CanvasState>({ status: "loading", initialData: null });
  const [loadVersion, setLoadVersion] = useState(0);
  const [repairConfirm, setRepairConfirm] = useState(false);
  const [repairBusy, setRepairBusy] = useState(false);
  // a failed board write is the closest thing the shell has to data loss —
  // SAY so inline instead of a console.warn (#11, audit 2026-07). Cleared by
  // the next successful write (the debounced saves keep retrying naturally).
  const [saveErr, setSaveErr] = useState<string | null>(null);

  // every save path (debounce, flush-on-unmount, metadata) funnels through the
  // shared saver so the failure/recovery surfacing can't drift between them
  const saver = useMemo(
    () =>
      createCorpusBoardSaver(boardId, (err) => {
        setSaveErr(err);
        // a real saved change = intent to keep the tab (preview → permanent)
        if (!err) keepTabsFor(boardId);
      }),
    [boardId],
  );

  // G — board metadata (the maintainer, 2026-06-26): description + tags ride top-level in
  // the .excalidraw (see boards/session.ts BoardMeta).
  const apiRef = useRef<ExcaliApi | null>(null);
  const sourceSceneRef = useRef<Record<string, unknown> | null>(null);
  const metaRef = useRef<BoardMeta>(EMPTY_BOARD_META);
  const [meta, setMeta] = useState<BoardMeta>(EMPTY_BOARD_META);
  const [metaOpen, setMetaOpen] = useState(false);

  // load the board once per boardId
  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    setState({ status: "loading", initialData: null });
    setRepairConfirm(false);
    loadBoard(boardId)
      .then(({ scene, meta: loaded, revision }) => {
        if (cancelled) return;
        metaRef.current = loaded;
        setMeta(loaded);
        // prime the saver with the CANONICAL body — merely opening the board
        // (or panning it) then produces an identical body and never writes
        try {
          const s = scene as {
            elements?: unknown[];
            appState?: Record<string, unknown>;
            files?: Record<string, unknown>;
          };
          sourceSceneRef.current = scene as Record<string, unknown>;
          saver.prime(
            serializeBoardScene({
              sourceScene: sourceSceneRef.current,
              elements: s.elements ?? [],
              appState: s.appState ?? {},
              files: s.files ?? {},
              meta: loaded,
            }),
            revision,
          );
        } catch {
          /* a foreign scene that can't re-serialize just skips the baseline */
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
  }, [boardId, loadVersion, saver]);

  // flush any pending save when the board changes or the surface unmounts —
  // and on ⌘Q/tray-Quit, which can fire inside the debounce window (the
  // quit-flush handshake; boards never registered before and could lose the
  // last strokes). The registration unregisters with the effect: a live surface
  // still flushes at quit, a dead one no longer pins its scene (perf audit
  // 2026-07-30, finding 22).
  useEffect(
    () => () => {
      void saver.flush(); // unmount can't await; quit-flush below holds the ack
    },
    [saver],
  );
  useEffect(() => onQuitFlush(() => saver.flush()), [saver]);

  // the freshest scene parts ride a ref; serialization runs inside the saver's
  // debounce (at most once per drain) — it used to run per onChange, i.e. per
  // pointer move, which was the big-board stutter
  const sceneRef = useRef<{
    elements: readonly unknown[];
    appState: Record<string, unknown>;
    files: Record<string, unknown>;
  } | null>(null);
  const buildBody = useCallback(() => {
    const s = sceneRef.current;
    if (!s) throw new Error("no scene captured");
    return serializeBoardScene({
      ...s,
      ...(sourceSceneRef.current ? { sourceScene: sourceSceneRef.current } : {}),
      meta: metaRef.current,
    });
  }, []);
  const onChange = useCallback(
    (elements: BoardChangeElements, appState: BoardChangeAppState, files: BoardChangeFiles) => {
      // Don't write while still loading (the initialData render fires onChange).
      if (state.status !== "ready") return;
      sceneRef.current = {
        elements,
        appState: appState as unknown as Record<string, unknown>,
        files: files as unknown as Record<string, unknown>,
      };
      saver.schedule(buildBody);
    },
    [state.status, saver, buildBody],
  );

  // Persist a metadata edit right away (it doesn't ride the Excalidraw onChange
  // save). Re-serialize the live scene from the API + the new meta.
  const saveMeta = useCallback(
    (next: BoardMeta) => {
      metaRef.current = next;
      setMeta(next);
      const api = apiRef.current;
      if (!api || !isTauri()) return;
      try {
        const body = serializeBoardScene({
          ...(sourceSceneRef.current ? { sourceScene: sourceSceneRef.current } : {}),
          elements: api.getSceneElements(),
          appState: api.getAppState(),
          files: api.getFiles(),
          meta: next,
        });
        saver.saveNow(body);
      } catch (error) {
        setSaveErr(error instanceof Error ? error.message : String(error));
      }
    },
    [saver],
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
          <span>The source file is preserved. You can reveal it for recovery or explicitly replace it.</span>
          <div className="canvas-recovery-actions">
            <button
              type="button"
              onClick={() =>
                void revealBoardSource(boardId).catch((error: unknown) => {
                  setState({
                    status: "error",
                    initialData: null,
                    error: error instanceof Error ? error.message : String(error),
                  });
                })
              }
            >
              Reveal original
            </button>
            <button type="button" onClick={() => setLoadVersion((version) => version + 1)}>
              Try again
            </button>
            {!repairConfirm ? (
              <button type="button" className="canvas-repair-danger" onClick={() => setRepairConfirm(true)}>
                Replace with blank board…
              </button>
            ) : (
              <button
                type="button"
                className="canvas-repair-danger"
                disabled={repairBusy}
                onClick={() => {
                  setRepairBusy(true);
                  void replaceCorruptBoardWithEmptyScene(boardId).then(
                    () => {
                      setRepairBusy(false);
                      setLoadVersion((version) => version + 1);
                    },
                    (error: unknown) => {
                      setRepairBusy(false);
                      setState({
                        status: "error",
                        initialData: null,
                        error: error instanceof Error ? error.message : String(error),
                      });
                    },
                  );
                }}
              >
                {repairBusy ? "Replacing…" : "Confirm replacement"}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="canvas-surface">
      <BoardCanvas
        initialData={state.initialData}
        onChange={onChange}
        theme={excaliTheme}
        // the titlebar sun is the ONE theme owner — the vendor's own toggle
        // was a second authority fighting it (boards slice 2026-07-28)
        UIOptions={{ canvasActions: { toggleTheme: false } }}
        excalidrawAPI={(api) => {
          apiRef.current = api as unknown as ExcaliApi;
        }}
      />
      {saveErr && (
        <div className="canvas-save-err" role="alert">
          ⚠ This board isn’t saving — your latest strokes may not be on disk. {saveErr}
        </div>
      )}
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
