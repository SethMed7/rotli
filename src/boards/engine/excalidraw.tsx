// The ONE Excalidraw seam. Board surfaces render <BoardCanvas> and speak these
// types; nothing outside this file imports the vendor API, so a canvas-engine
// swap is this adapter + the surfaces' props.
//
// The stylesheets live HERE, not in app.tsx (perf audit 2026-08): this module is
// only ever reached through a lazy board chunk (canvasSurface via paneTree.lazy,
// embedBoard via a dynamic import), so both sheets load with the board rather
// than blocking first paint. Order is load-bearing — the vendor sheet must come
// BEFORE canvas.css so our overrides win the cascade.
import "@excalidraw/excalidraw/index.css";
import "../../styles/canvas.css";
import { Excalidraw } from "@excalidraw/excalidraw";

// Paint the canvas at most once per frame (2026-10-08). Without it Excalidraw
// redraws the whole scene synchronously for every wheel event, and a trackpad
// sends those faster than the display refreshes — panning felt laggy and
// behind the finger. excalidraw.com runs with this on; it needs React 18+.
(window as unknown as { EXCALIDRAW_THROTTLE_RENDER?: boolean }).EXCALIDRAW_THROTTLE_RENDER = true;

type ExcalidrawProps = Parameters<typeof Excalidraw>[0];

/** The parsed scene fed on mount — held as `null` until loaded, never undefined. */
export type BoardInitialData = NonNullable<ExcalidrawProps["initialData"]> | null;

/** onChange positional payloads (elements, appState, files). */
export type BoardChangeElements = Parameters<NonNullable<ExcalidrawProps["onChange"]>>[0];
export type BoardChangeAppState = Parameters<NonNullable<ExcalidrawProps["onChange"]>>[1];
export type BoardChangeFiles = Parameters<NonNullable<ExcalidrawProps["onChange"]>>[2];

export const BoardCanvas = Excalidraw;
