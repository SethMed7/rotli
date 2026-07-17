// The ONE Excalidraw seam. Board surfaces render <BoardCanvas> and speak these
// types; nothing outside this file imports the vendor API, so a canvas-engine
// swap is this adapter + the surfaces' props. (The vendor stylesheet stays in
// app.tsx: canvas.css must cascade AFTER it, and app.tsx owns that order.)

import { Excalidraw } from "@excalidraw/excalidraw";

type ExcalidrawProps = Parameters<typeof Excalidraw>[0];

/** The parsed scene fed on mount — held as `null` until loaded, never undefined. */
export type BoardInitialData = NonNullable<ExcalidrawProps["initialData"]> | null;

/** onChange positional payloads (elements, appState, files). */
export type BoardChangeElements = Parameters<NonNullable<ExcalidrawProps["onChange"]>>[0];
export type BoardChangeAppState = Parameters<NonNullable<ExcalidrawProps["onChange"]>>[1];
export type BoardChangeFiles = Parameters<NonNullable<ExcalidrawProps["onChange"]>>[2];

export const BoardCanvas = Excalidraw;
