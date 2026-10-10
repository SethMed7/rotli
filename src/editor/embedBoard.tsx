// Compact Excalidraw host for ```board fences — the corpus file stays truth.
// While the board's own canvas TAB is open anywhere, the embed goes VIEW-ONLY:
// two live savers on one file silently last-writer-wins'd each other's strokes
// (boards slice 2026-07-28). Save failures surface inline, and pending saves
// register with the quit-flush handshake so ⌘Q can't drop the last strokes.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { type BoardLinkApi, useBoardLinkOpener } from "../boards/boardLinks";
import { useBoardLook } from "../boards/boardLook";
import { boardsAvailable, createCorpusBoardSaver, loadBoard } from "../boards/composition";
import { type BoardInitialData, BoardCanvas } from "../boards/engine/excalidraw";
import {
  type BoardMeta,
  EMPTY_BOARD_META,
  EMPTY_SCENE,
  createBoardChangeGate,
  serializeBoardScene,
} from "../boards/session";
import { onQuitFlush } from "../lib/quitFlush";
import { boardTabOpen, usePanesStore } from "../state/panes";

type ExcalidrawInitialData = BoardInitialData;

export function BoardEmbed({ boardId }: { boardId: string }) {
  const [initialData, setInitialData] = useState<ExcalidrawInitialData>(null);
  // the same app-following look as the board tab (boards/boardLook.ts)
  const look = useBoardLook(initialData);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [saveErr, setSaveErr] = useState<string | null>(null);
  // carry the board's AI description/tags through embed edits — an embed save
  // must never drop rotliMeta the full canvas surface wrote
  const metaRef = useRef<BoardMeta>(EMPTY_BOARD_META);
  const sourceSceneRef = useRef<Record<string, unknown> | null>(null);

  // the board's own tab open somewhere? that surface owns the pen
  const tabOpen = usePanesStore((s) => boardTabOpen(s.root, boardId));

  const saver = useMemo(() => createCorpusBoardSaver(boardId, setSaveErr), [boardId]);
  const [changed] = useState(() => createBoardChangeGate());
  const apiRef = useRef<BoardLinkApi | null>(null);
  const onLinkOpen = useBoardLinkOpener(apiRef);
  const bindLook = look.bindApi;
  const bindApi = useCallback(
    (api: unknown) => {
      apiRef.current = api as BoardLinkApi;
      bindLook(api);
    },
    [bindLook],
  );

  // cleanup returns the unregister — same leak class as the full board surface
  // (perf audit 2026-07-30, finding 22): one closure per embed mount otherwise
  useEffect(() => onQuitFlush(() => saver.flush()), [saver]);

  useEffect(() => {
    if (!boardsAvailable()) {
      setStatus("error");
      return;
    }
    let cancelled = false;
    setStatus("loading");
    loadBoard(boardId)
      .then(({ scene, meta, revision }) => {
        if (cancelled) return;
        metaRef.current = meta;
        // canonical baseline — opening the embed must never rewrite the file
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
              meta,
            }),
            revision,
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
      void saver.flush(); // unmount can't await; the quit-flush registration holds the ack
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
    return serializeBoardScene({
      ...s,
      ...(sourceSceneRef.current ? { sourceScene: sourceSceneRef.current } : {}),
      meta: metaRef.current,
    });
  }, []);
  const onChange = useCallback(
    (elements: readonly unknown[], appState: Record<string, unknown>, files: Record<string, unknown>) => {
      if (!boardsAvailable() || status !== "ready" || tabOpen) return;
      // a pan or a selection changes nothing a save writes (boards/session.ts)
      if (!changed(elements, appState, files)) return;
      sceneRef.current = { elements, appState, files };
      saver.schedule(buildBody);
    },
    [saver, status, tabOpen, buildBody, changed],
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
        initialData={look.initialData ?? EMPTY_SCENE}
        theme={look.theme}
        excalidrawAPI={bindApi}
        onLinkOpen={onLinkOpen}
        viewModeEnabled={tabOpen}
        onChange={(els, state, fls) =>
          onChange(els, state as unknown as Record<string, unknown>, fls as Record<string, unknown>)
        }
        UIOptions={{
          // no Open: it would load another scene over this board's file
          canvasActions: { toggleTheme: false, export: false, saveAsImage: false, loadScene: false },
        }}
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
