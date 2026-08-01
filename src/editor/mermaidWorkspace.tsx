import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";

import { mermaidErrorMessage, renderMermaidElement } from "./mermaidRender";
import {
  type MermaidPoint,
  type MermaidViewport,
  fitMermaidViewport,
  panMermaidViewport,
  zoomMermaidViewportAt,
} from "./mermaidViewport";
import { MermaidVisualEditor } from "./mermaidVisualEditor";

type WorkspaceMode = "view" | "visual" | "code";
type RenderStatus = "loading" | "ready" | "empty" | "error";

interface MermaidWorkspaceProps {
  code: string;
  dark: boolean;
  conversionAvailable: boolean;
  onApply: (code: string) => string | null;
  onConvertToExcalidraw: (code: string) => Promise<void>;
  /** Convert AND swap the note's mermaid fence for a ```board embed — returns
   * an error message when the fence went stale, null on success. */
  onConvertAndEmbed?: (code: string) => Promise<string | null>;
  onClose: () => void;
  onRequestCloseReady?: (requestClose: () => void) => void;
}

export type MermaidWorkspaceOptions = MermaidWorkspaceProps;

const INITIAL_VIEWPORT: MermaidViewport = { x: 0, y: 0, scale: 1 };

function svgSize(element: HTMLElement): MermaidPoint {
  const svg = element.querySelector("svg");
  if (!svg) return { x: 0, y: 0 };
  const viewBox = svg.viewBox.baseVal;
  const width = viewBox.width || svg.getBoundingClientRect().width;
  const height = viewBox.height || svg.getBoundingClientRect().height;
  if (width > 0 && height > 0) {
    svg.style.width = `${width}px`;
    svg.style.height = `${height}px`;
    svg.style.maxWidth = "none";
  }
  return { x: width, y: height };
}

function focusableInside(node: HTMLElement): HTMLElement[] {
  return [
    ...node.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ].filter((item) => !item.hidden);
}

function MermaidWorkspace({
  code,
  dark,
  conversionAvailable,
  onApply,
  onConvertToExcalidraw,
  onConvertAndEmbed,
  onClose,
  onRequestCloseReady,
}: MermaidWorkspaceProps) {
  const [mode, setMode] = useState<WorkspaceMode>("view");
  const [draft, setDraft] = useState(code);
  const [viewport, setViewport] = useState(INITIAL_VIEWPORT);
  const [contentSize, setContentSize] = useState<MermaidPoint>({ x: 0, y: 0 });
  const [renderStatus, setRenderStatus] = useState<RenderStatus>(code.trim() ? "loading" : "empty");
  const [renderError, setRenderError] = useState("");
  const [isPanning, setIsPanning] = useState(false);
  const [conversionStatus, setConversionStatus] = useState<"idle" | "creating" | "error">("idle");
  const [conversionError, setConversionError] = useState("");
  const [moreOpen, setMoreOpen] = useState(false);
  const [confirmConversion, setConfirmConversion] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [applyError, setApplyError] = useState("");
  const panelRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const diagramRef = useRef<HTMLDivElement>(null);
  const codeRef = useRef<HTMLTextAreaElement>(null);
  const dragRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const renderId = useMemo(() => Math.random().toString(36).slice(2, 10), []);
  const dirty = draft !== code;

  const fitDiagram = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setViewport(fitMermaidViewport({ x: canvas.clientWidth, y: canvas.clientHeight }, contentSize));
  }, [contentSize]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || renderStatus !== "ready") return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        setViewport(fitMermaidViewport({ x: canvas.clientWidth, y: canvas.clientHeight }, contentSize));
      });
    });
    observer.observe(canvas);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [contentSize, renderStatus]);

  useEffect(() => {
    if (mode !== "view") return;
    const host = diagramRef.current;
    if (!host) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setRenderError("");
      if (!draft.trim()) {
        host.replaceChildren();
        setContentSize({ x: 0, y: 0 });
        setRenderStatus("empty");
        return;
      }
      setRenderStatus("loading");
      void renderMermaidElement(draft, {
        dark,
        id: `rotli-mermaid-workspace-${renderId}-${Date.now()}`,
      }).then(
        (element) => {
          if (cancelled) return;
          host.replaceChildren(element);
          const size = svgSize(element);
          setContentSize(size);
          setRenderStatus("ready");
          window.requestAnimationFrame(() => {
            const canvas = canvasRef.current;
            if (!canvas) return;
            setViewport(fitMermaidViewport({ x: canvas.clientWidth, y: canvas.clientHeight }, size));
          });
        },
        (error: unknown) => {
          if (cancelled) return;
          host.replaceChildren();
          setContentSize({ x: 0, y: 0 });
          setRenderError(mermaidErrorMessage(error));
          setRenderStatus("error");
        },
      );
    }, 120);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [dark, draft, mode, renderId]);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const first = focusableInside(panel)[0];
    first?.focus();
  }, []);

  useEffect(() => {
    if (mode === "code") codeRef.current?.focus();
  }, [mode]);

  const requestClose = useCallback(() => {
    if (dirty) {
      setConfirmClose(true);
      return;
    }
    onClose();
  }, [dirty, onClose]);

  useEffect(() => {
    onRequestCloseReady?.(requestClose);
  }, [onRequestCloseReady, requestClose]);

  const zoomBy = useCallback((factor: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setViewport((current) =>
      zoomMermaidViewportAt(current, current.scale * factor, {
        x: canvas.clientWidth / 2,
        y: canvas.clientHeight / 2,
      }),
    );
  }, []);

  const onWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const factor = Math.exp(-event.deltaY * 0.0015);
    setViewport((current) =>
      zoomMermaidViewportAt(current, current.scale * factor, {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      }),
    );
  }, []);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    setIsPanning(true);
  }, []);

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const delta = { x: event.clientX - drag.x, y: event.clientY - drag.y };
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    setViewport((current) => panMermaidViewport(current, delta));
  }, []);

  const endPan = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setIsPanning(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const createExcalidrawCopy = useCallback(async () => {
    setConversionStatus("creating");
    setConversionError("");
    try {
      await onConvertToExcalidraw(draft);
      onClose();
    } catch (error) {
      setConfirmConversion(false);
      setConversionError(error instanceof Error ? error.message : String(error));
      setConversionStatus("error");
    }
  }, [draft, onClose, onConvertToExcalidraw]);

  const convertAndEmbed = useCallback(async () => {
    if (!onConvertAndEmbed) return;
    setConversionStatus("creating");
    setConversionError("");
    try {
      const error = await onConvertAndEmbed(draft);
      if (error) {
        setConfirmConversion(false);
        setConversionError(error);
        setConversionStatus("error");
        return;
      }
      onClose();
    } catch (error) {
      setConfirmConversion(false);
      setConversionError(error instanceof Error ? error.message : String(error));
      setConversionStatus("error");
    }
  }, [draft, onClose, onConvertAndEmbed]);

  const applyDraft = useCallback(() => {
    const error = onApply(draft);
    if (error) setApplyError(error);
  }, [draft, onApply]);

  const onPanelKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      if (event.key === "Tab") {
        const panel = panelRef.current;
        if (!panel) return;
        const items = focusableInside(panel);
        if (items.length === 0) return;
        const current = items.indexOf(document.activeElement as HTMLElement);
        const next = event.shiftKey
          ? current <= 0
            ? items.length - 1
            : current - 1
          : current === items.length - 1
            ? 0
            : current + 1;
        event.preventDefault();
        items[next]?.focus();
        return;
      }
      if (event.key === "Escape") {
        if (moreOpen) {
          event.preventDefault();
          event.stopPropagation();
          setMoreOpen(false);
          return;
        }
        if (confirmConversion) {
          event.preventDefault();
          event.stopPropagation();
          setConfirmConversion(false);
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        requestClose();
        return;
      }
      if (mode !== "view" && event.metaKey && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (dirty) applyDraft();
        return;
      }
      if (mode !== "view" || event.target instanceof HTMLTextAreaElement) return;
      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        zoomBy(1.2);
      } else if (event.key === "-") {
        event.preventDefault();
        zoomBy(1 / 1.2);
      } else if (event.key === "0") {
        event.preventDefault();
        fitDiagram();
      }
    },
    [applyDraft, confirmConversion, dirty, fitDiagram, mode, moreOpen, requestClose, zoomBy],
  );

  return (
    <div
      className="rotli-mermaid-workspace"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
    >
      <section
        ref={panelRef}
        className="rotli-mermaid-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Mermaid diagram"
        onKeyDown={onPanelKeyDown}
      >
        <header className="rotli-mermaid-toolbar">
          <div className="rotli-mermaid-mode" aria-label="Diagram mode">
            <button
              type="button"
              className={mode === "view" ? "is-active" : ""}
              aria-pressed={mode === "view"}
              onClick={() => setMode("view")}
            >
              View
            </button>
            <button
              type="button"
              className={mode === "visual" ? "is-active" : ""}
              aria-pressed={mode === "visual"}
              onClick={() => setMode("visual")}
            >
              Visual
            </button>
            <button
              type="button"
              className={mode === "code" ? "is-active" : ""}
              aria-pressed={mode === "code"}
              onClick={() => setMode("code")}
            >
              Code
            </button>
          </div>

          {mode === "view" && (
            <div className="rotli-mermaid-zoom" aria-label="Diagram zoom">
              <button type="button" aria-label="Zoom out" onClick={() => zoomBy(1 / 1.2)}>
                −
              </button>
              <output aria-label="Zoom level">{Math.round(viewport.scale * 100)}%</output>
              <button type="button" aria-label="Zoom in" onClick={() => zoomBy(1.2)}>
                +
              </button>
              <button type="button" onClick={fitDiagram} disabled={renderStatus !== "ready"}>
                Fit
              </button>
            </div>
          )}

          <div className="rotli-mermaid-toolbar-end">
            <div className="rotli-mermaid-more-wrap">
              <button
                type="button"
                aria-expanded={moreOpen}
                aria-controls="rotli-mermaid-more-menu"
                onClick={() => setMoreOpen((open) => !open)}
              >
                More
              </button>
              {moreOpen && (
                <div id="rotli-mermaid-more-menu" className="rotli-mermaid-more-menu" role="menu">
                  <button
                    type="button"
                    role="menuitem"
                    disabled={
                      !conversionAvailable || conversionStatus === "creating" || !draft.trim() || dirty
                    }
                    onClick={() => {
                      setMoreOpen(false);
                      setConfirmConversion(true);
                    }}
                  >
                    <strong>Convert copy to Excalidraw…</strong>
                    <span>
                      {!conversionAvailable
                        ? "Available in the Rotli desktop app"
                        : dirty
                          ? "Apply Mermaid changes first"
                          : "Creates a separate board; Mermaid stays unchanged"}
                    </span>
                  </button>
                </div>
              )}
            </div>
            <button type="button" aria-label="Close Mermaid diagram" onClick={requestClose}>
              Close
            </button>
          </div>
        </header>

        {confirmClose && (
          <div className="rotli-mermaid-discard" role="alert">
            <span>Discard unapplied diagram changes?</span>
            <button type="button" onClick={() => setConfirmClose(false)}>
              Keep editing
            </button>
            <button type="button" className="is-destructive" onClick={onClose}>
              Discard
            </button>
          </div>
        )}

        {confirmConversion && (
          <div className="rotli-mermaid-convert-confirm" role="alert">
            <span>
              <strong>Convert to an Excalidraw board?</strong> Keep the Mermaid fence and open a separate
              board — or replace the fence with the board embedded right here.
            </span>
            <button type="button" onClick={() => setConfirmConversion(false)}>
              Cancel
            </button>
            <button
              type="button"
              disabled={conversionStatus === "creating"}
              onClick={() => void createExcalidrawCopy()}
            >
              {conversionStatus === "creating" ? "Creating…" : "Create board copy"}
            </button>
            {onConvertAndEmbed && (
              <button
                type="button"
                className="is-primary"
                disabled={conversionStatus === "creating"}
                onClick={() => void convertAndEmbed()}
              >
                {conversionStatus === "creating" ? "Converting…" : "Convert & replace in note"}
              </button>
            )}
          </div>
        )}

        <div className="rotli-mermaid-stage">
          {mode === "view" ? (
            <div
              ref={canvasRef}
              className={isPanning ? "rotli-mermaid-canvas is-panning" : "rotli-mermaid-canvas"}
              tabIndex={0}
              aria-label="Mermaid diagram canvas. Drag to pan and scroll to zoom."
              onWheel={onWheel}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={endPan}
              onPointerCancel={endPan}
              onDoubleClick={fitDiagram}
            >
              <div
                ref={diagramRef}
                className="rotli-mermaid-diagram"
                style={{
                  transform: `translate3d(${viewport.x}px, ${viewport.y}px, 0) scale(${viewport.scale})`,
                }}
              />
              {renderStatus === "loading" && (
                <div className="rotli-mermaid-state" role="status">
                  Rendering diagram…
                </div>
              )}
              {renderStatus === "empty" && (
                <div className="rotli-mermaid-state" role="status">
                  Add Mermaid source in Code to render a diagram.
                </div>
              )}
              {renderStatus === "error" && (
                <div className="rotli-mermaid-state is-error" role="alert">
                  <strong>Mermaid could not render this source.</strong>
                  <span>{renderError}</span>
                  <button type="button" onClick={() => setMode("code")}>
                    Edit code
                  </button>
                </div>
              )}
              {renderStatus === "ready" && (
                <div className="rotli-mermaid-hint">Drag to pan · Scroll to zoom · 0 to fit</div>
              )}
            </div>
          ) : mode === "visual" ? (
            <MermaidVisualEditor
              source={draft}
              dirty={dirty}
              applyError={applyError}
              onChange={(nextCode) => {
                setDraft(nextCode);
                setConfirmClose(false);
                setApplyError("");
              }}
              onApply={applyDraft}
              onEditCode={() => setMode("code")}
            />
          ) : (
            <div className="rotli-mermaid-code">
              <textarea
                ref={codeRef}
                value={draft}
                spellCheck={false}
                aria-label="Mermaid source"
                onChange={(event) => {
                  setDraft(event.target.value);
                  setConfirmClose(false);
                  setApplyError("");
                }}
              />
              <footer>
                {applyError ? (
                  <span className="rotli-mermaid-apply-error" role="alert">
                    {applyError}
                  </span>
                ) : (
                  <span>Markdown remains the source of truth.</span>
                )}
                <button type="button" className="is-primary" disabled={!dirty} onClick={applyDraft}>
                  Apply to note
                </button>
              </footer>
            </div>
          )}
        </div>

        {conversionStatus === "error" && (
          <div className="rotli-mermaid-conversion-error" role="alert">
            Excalidraw copy failed: {conversionError}
          </div>
        )}
      </section>
    </div>
  );
}

export function mountMermaidWorkspace(options: MermaidWorkspaceOptions): () => void {
  const host = document.createElement("div");
  host.className = "rotli-mermaid-workspace-root";
  document.body.appendChild(host);
  const root = createRoot(host);
  root.render(<MermaidWorkspace {...options} />);
  return () => {
    root.unmount();
    host.remove();
  };
}
