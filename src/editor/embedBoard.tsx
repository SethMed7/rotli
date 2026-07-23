// Compact Excalidraw host for ```board fences — the corpus file stays truth.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createCorpusBoardSaver, loadBoard } from "../boards/composition";
import { type BoardInitialData, BoardCanvas } from "../boards/engine/excalidraw";
import { type BoardMeta, EMPTY_BOARD_META, EMPTY_SCENE, serializeBoardScene } from "../boards/session";
import { isTauri } from "../lib/tauri";
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
  // carry the board's AI description/tags through embed edits — an embed save
  // must never drop rotliMeta the full canvas surface wrote
  const metaRef = useRef<BoardMeta>(EMPTY_BOARD_META);

  const saver = useMemo(() => createCorpusBoardSaver(boardId), [boardId]);

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

  const onChange = useCallback(
    (elements: readonly unknown[], appState: Record<string, unknown>, files: Record<string, unknown>) => {
      if (!isTauri() || status !== "ready") return;
      try {
        saver.schedule(serializeBoardScene({ elements, appState, files, meta: metaRef.current }));
      } catch {
        setStatus("error");
      }
    },
    [saver, status],
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
        onChange={(els, state, fls) =>
          onChange(els, state as unknown as Record<string, unknown>, fls as Record<string, unknown>)
        }
        UIOptions={{ canvasActions: { toggleTheme: false, export: false, saveAsImage: false } }}
      />
    </div>
  );
}
