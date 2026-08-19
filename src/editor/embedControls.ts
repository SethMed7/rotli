import { rememberEmbedHeight, rememberedEmbedHeight } from "./embedSizeMemory";
import {
  EMBED_MIN_HEIGHT,
  createEmbedSizeState,
  embedHeightLimit,
  fitExpandedEmbed,
  resizeEmbed,
  toggleEmbedExpanded,
} from "./embedSizing";

export type EmbedKind = "board" | "sheet" | "document";

const DEFAULT_HEIGHT: Record<EmbedKind, number> = {
  board: 240,
  sheet: 360,
  document: 420,
};

/**
 * Install the shared embed chrome without coupling it to CodeMirror, React, or
 * pane navigation. Those systems supply only a host, body, kind, and open hook.
 */
export function installEmbedControls({
  container,
  body,
  kind,
  onOpen,
  persistKey,
}: {
  container: HTMLElement;
  body: HTMLElement;
  kind: EmbedKind;
  onOpen: () => void;
  /** File id whose resized height is REMEMBERED across widget rebuilds and
   * restarts (the maintainer, 2026-07-29); omitted = per-mount sizing as before. */
  persistKey?: string;
}): () => void {
  const actions = document.createElement("div");
  actions.className = "rotli-render-actions";
  const expand = document.createElement("button");
  expand.type = "button";
  expand.className = "rotli-render-action";
  expand.setAttribute("aria-controls", body.id);
  actions.appendChild(expand);
  const open = document.createElement("button");
  open.type = "button";
  open.className = "rotli-render-action";
  open.textContent = "Open in tab";
  open.setAttribute("aria-label", `Open ${kind} in a new tab`);
  actions.appendChild(open);
  container.appendChild(actions);

  let size = createEmbedSizeState(
    (persistKey ? rememberedEmbedHeight(persistKey) : null) ?? DEFAULT_HEIGHT[kind],
  );
  // CodeMirror calls WidgetType.toDOM before attaching the result, so resolve
  // the pane lazily instead of capturing a guaranteed-null ancestor here.
  const viewport = () => container.closest<HTMLElement>(".ed-scroll");
  const viewportHeight = () => viewport()?.clientHeight || window.innerHeight;
  const applyFocusRect = () => {
    if (!size.expanded) {
      for (const property of ["position", "top", "left", "width", "height", "margin"]) {
        container.style.removeProperty(property);
      }
      return;
    }
    const rect = viewport()?.getBoundingClientRect() ?? {
      top: 0,
      left: 0,
      width: window.innerWidth,
      height: window.innerHeight,
    };
    Object.assign(container.style, {
      position: "fixed",
      top: `${rect.top}px`,
      left: `${rect.left}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      margin: "0",
    });
  };
  const applySize = () => {
    applyFocusRect();
    body.style.height = size.expanded ? "100%" : `${size.height}px`;
    container.classList.toggle("is-expanded", size.expanded);
    expand.textContent = size.expanded ? "Zoom out" : "Zoom in";
    expand.setAttribute("aria-label", `${size.expanded ? "Zoom out of" : "Zoom into"} embedded ${kind}`);
    expand.setAttribute("aria-expanded", String(size.expanded));
  };

  const stopMouse = (event: MouseEvent) => event.stopPropagation();
  expand.addEventListener("mousedown", stopMouse);
  expand.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    size = toggleEmbedExpanded(size, viewportHeight());
    applySize();
  });
  open.addEventListener("mousedown", stopMouse);
  open.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onOpen();
  });

  const resize = document.createElement("div");
  resize.className = "rotli-render-resize";
  resize.tabIndex = 0;
  resize.setAttribute("role", "separator");
  resize.setAttribute("aria-orientation", "horizontal");
  resize.setAttribute("aria-label", `Resize embedded ${kind}`);
  resize.setAttribute("aria-valuemin", String(EMBED_MIN_HEIGHT));
  resize.title = `Drag to resize ${kind}; use arrow keys for precise resizing`;
  container.appendChild(resize);

  const applyResize = (height: number, remember = true) => {
    size = resizeEmbed(size, height, viewportHeight());
    resize.setAttribute("aria-valuemax", String(embedHeightLimit(viewportHeight())));
    resize.setAttribute("aria-valuenow", String(size.height));
    if (remember && persistKey) rememberEmbedHeight(persistKey, size.height);
    applySize();
  };
  resize.addEventListener("keydown", (event) => {
    const step = event.shiftKey ? 64 : 24;
    if (event.key === "ArrowUp") applyResize(size.height - step);
    else if (event.key === "ArrowDown") applyResize(size.height + step);
    else if (event.key === "Home") applyResize(EMBED_MIN_HEIGHT);
    else if (event.key === "End") applyResize(embedHeightLimit(viewportHeight()));
    else return;
    event.preventDefault();
    event.stopPropagation();
  });

  let activePointer: number | null = null;
  let startY = 0;
  let startHeight = 0;
  resize.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || size.expanded) return;
    activePointer = event.pointerId;
    startY = event.clientY;
    startHeight = size.height;
    container.classList.add("is-resizing");
    resize.setPointerCapture(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  });
  resize.addEventListener("pointermove", (event) => {
    if (activePointer !== event.pointerId) return;
    applyResize(startHeight + event.clientY - startY);
    event.preventDefault();
    event.stopPropagation();
  });
  const finishResize = (event: PointerEvent) => {
    if (activePointer !== event.pointerId) return;
    activePointer = null;
    container.classList.remove("is-resizing");
    if (resize.hasPointerCapture(event.pointerId)) resize.releasePointerCapture(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  };
  resize.addEventListener("pointerup", finishResize);
  resize.addEventListener("pointercancel", finishResize);

  const fitExpanded = () => {
    const next = fitExpandedEmbed(size, viewportHeight());
    if (next !== size) size = next;
    if (size.expanded) applySize();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || !size.expanded) return;
    event.preventDefault();
    event.stopPropagation();
    size = toggleEmbedExpanded(size, viewportHeight());
    applySize();
    expand.focus();
  };
  const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(fitExpanded) : null;
  queueMicrotask(() => {
    const pane = viewport();
    if (pane) observer?.observe(pane);
  });
  window.addEventListener("resize", fitExpanded);
  document.addEventListener("keydown", onKeyDown, true);
  // seed pass — never re-records the height it just read
  applyResize(size.height, false);

  return () => {
    observer?.disconnect();
    window.removeEventListener("resize", fitExpanded);
    document.removeEventListener("keydown", onKeyDown, true);
  };
}
