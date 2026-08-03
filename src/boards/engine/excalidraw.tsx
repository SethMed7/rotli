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

type ExcalidrawProps = Parameters<typeof Excalidraw>[0];

/** The parsed scene fed on mount — held as `null` until loaded, never undefined. */
export type BoardInitialData = NonNullable<ExcalidrawProps["initialData"]> | null;

/** onChange positional payloads (elements, appState, files). */
export type BoardChangeElements = Parameters<NonNullable<ExcalidrawProps["onChange"]>>[0];
export type BoardChangeAppState = Parameters<NonNullable<ExcalidrawProps["onChange"]>>[1];
export type BoardChangeFiles = Parameters<NonNullable<ExcalidrawProps["onChange"]>>[2];

export const BoardCanvas = Excalidraw;
