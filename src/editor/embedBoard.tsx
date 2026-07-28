// Compact Excalidraw host for ```board fences — the corpus file stays truth.
// While the board's own canvas TAB is open anywhere, the embed goes VIEW-ONLY:
// two live savers on one file silently last-writer-wins'd each other's strokes
// (boards slice 2026-07-28). Save failures surface inline, and pending saves
// register with the quit-flush handshake so ⌘Q can't drop the last strokes.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createCorpusBoardSaver, loadBoard } from "../boards/composition";
import { type BoardInitialData, BoardCanvas } from "../boards/engine/excalidraw";
import { type BoardMeta, EMPTY_BOARD_META, EMPTY_SCENE, serializeBoardScene } from "../boards/session";
import { onQuitFlush } from "../lib/quitFlush";
import { isTauri } from "../lib/tauri";
import { boardTabOpen, usePanesStore } from "../state/panes";
import { useUiStore } from "../state/ui";

type ExcalidrawInitialData = BoardInitialData;

export function BoardEmbed({ boardId }: { boardId: string }) {
  const themeMode = useUiStore((s) => s.theme);
  const excaliTheme: "dark" | "light" =
    themeMode === "dark" ||
    (themeMode === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches)
      ? "dark"
      : "light";

  const [initialData, setInitialData] = useState<ExcalidrawInitialData>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [saveErr, setSaveErr] = useState<string | null>(null);
  // carry the board's AI description/tags through embed edits — an embed save
  // must never drop rotliMeta the full canvas surface wrote
  const metaRef = useRef<BoardMeta>(EMPTY_BOARD_META);

  // the board's own tab open somewhere? that surface owns the pen
  const tabOpen = usePanesStore((s) => boardTabOpen(s.root, boardId));

  const saver = useMemo(() => createCorpusBoardSaver(boardId, setSaveErr), [boardId]);

  useEffect(() => {
    onQuitFlush(() => saver.flush());
  }, [saver]);

  useEffect(() => {
    if (!isTauri()) {
      setStatus("error");
      return;
    }
    let cancelled = false;
    setStatus("loading");
    loadBoard(boardId)
      .then(({ scene, meta }) => {
        if (cancelled) return;
        metaRef.current = meta;
        // canonical baseline — opening the embed must never rewrite the file
        try {
          const s = scene as {
            elements?: unknown[];
            appState?: Record<string, unknown>;
            files?: Record<string, unknown>;
          };
          saver.prime(
            serializeBoardScene({
              elements: s.elements ?? [],
              appState: s.appState ?? {},
              files: s.files ?? {},
              meta,
            }),
          );
        } catch {
          /* a foreign scene that can't re-serialize just skips the baseline */
        }
        setInitialData(scene as ExcalidrawInitialData);
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
      saver.flush();
    };
  }, [boardId, saver]);

  // freshest scene parts ride a ref; serialization runs once per debounce drain
  const sceneRef = useRef<{
    elements: readonly unknown[];
    appState: Record<string, unknown>;
    files: Record<string, unknown>;
  } | null>(null);
  const buildBody = useCallback(() => {
    const s = sceneRef.current;
    if (!s) throw new Error("no scene captured");
    return serializeBoardScene({ ...s, meta: metaRef.current });
  }, []);
  const onChange = useCallback(
    (elements: readonly unknown[], appState: Record<string, unknown>, files: Record<string, unknown>) => {
      if (!isTauri() || status !== "ready" || tabOpen) return;
      sceneRef.current = { elements, appState, files };
      saver.schedule(buildBody);
    },
    [saver, status, tabOpen, buildBody],
  );

  if (status === "loading") {
    return <div className="rotli-embed-placeholder">Loading board…</div>;
  }
  if (status === "error") {
    return (
      <div className="rotli-embed-placeholder">Board needs recovery in its full tab. Source preserved.</div>
    );
  }

  return (
    <div className="rotli-embed-board-inner">
      <BoardCanvas
        initialData={initialData ?? EMPTY_SCENE}
        theme={excaliTheme}
        viewModeEnabled={tabOpen}
        onChange={(els, state, fls) =>
          onChange(els, state as unknown as Record<string, unknown>, fls as Record<string, unknown>)
        }
        UIOptions={{ canvasActions: { toggleTheme: false, export: false, saveAsImage: false } }}
      />
      {tabOpen && (
        <div className="rotli-embed-viewonly">Open in its tab — the embed is view-only meanwhile.</div>
      )}
      {saveErr && (
        <div className="rotli-embed-saveerr" role="alert">
          ⚠ This board isn’t saving — {saveErr}
        </div>
      )}
    </div>
  );
}
