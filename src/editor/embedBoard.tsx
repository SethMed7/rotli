// Compact Excalidraw host for ```board fences — the corpus file stays truth.

import { Excalidraw } from "@excalidraw/excalidraw";
import { useCallback, useEffect, useRef, useState } from "react";
import { type CorpusBoardDoc, corpusReadBoard, corpusWriteBoard, isTauri } from "../lib/tauri";
import { useUiStore } from "../state/ui";

const SAVE_DEBOUNCE_MS = 500;

const EMPTY_SCENE = {
  type: "excalidraw" as const,
  version: 2,
  source: "rotli",
  elements: [],
  appState: {},
  files: {},
};

type ExcalidrawInitialData = NonNullable<Parameters<typeof Excalidraw>[0]["initialData"]> | null;

export function BoardEmbed({ boardId }: { boardId: string }) {
  const themeMode = useUiStore((s) => s.theme);
  const excaliTheme: "dark" | "light" =
    themeMode === "dark" ||
    (themeMode === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches)
      ? "dark"
      : "light";

  const [initialData, setInitialData] = useState<ExcalidrawInitialData>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<string | null>(null);

  const flush = useCallback(() => {
    if (!isTauri() || pending.current == null) return;
    const body = pending.current;
    pending.current = null;
    void corpusWriteBoard(boardId, body).catch(() => {});
  }, [boardId]);

  useEffect(() => {
    if (!isTauri()) {
      setStatus("error");
      return;
    }
    let cancelled = false;
    setStatus("loading");
    corpusReadBoard(boardId)
      .then((doc: CorpusBoardDoc) => {
        if (cancelled) return;
        let scene: ExcalidrawInitialData = EMPTY_SCENE;
        const raw = doc.body.trim();
        if (raw) {
          try {
            scene = JSON.parse(raw) as ExcalidrawInitialData;
          } catch {
            scene = EMPTY_SCENE;
          }
        }
        setInitialData(scene);
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      flush();
    };
  }, [boardId, flush]);

  const onChange = useCallback(
    (elements: readonly unknown[], appState: Record<string, unknown>, files: Record<string, unknown>) => {
      if (!isTauri()) return;
      const body = JSON.stringify({
        type: "excalidraw",
        version: 2,
        source: "rotli",
        elements,
        appState,
        files,
      });
      pending.current = body;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(flush, SAVE_DEBOUNCE_MS);
    },
    [flush],
  );

  if (status === "loading") {
    return <div className="rotli-embed-placeholder">Loading board…</div>;
  }
  if (status === "error") {
    return <div className="rotli-embed-placeholder">Board unavailable</div>;
  }

  return (
    <div className="rotli-embed-board-inner">
      <Excalidraw
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
