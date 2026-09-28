// A board's canvas background (2026-09-27). Unless the person chose a color
// for a board, its canvas follows the app: with "Match theme" (the default)
// the canvas is transparent over the theme's ground, so it is the theme's own
// color in all fourteen environments and changes with them; Excalidraw's dark
// filter inverts a painted color, but it has nothing to invert on transparent.
// With "White" an unchosen board stays light, like paper, in every theme.
// Only a chosen color is written to the file; no color, Excalidraw's default
// white, and transparent all mean "not chosen" (a file saved before this has
// the default white in it).

export type BoardBackgroundMode = "theme" | "white";

export const BOARD_BACKGROUND_MODES: readonly BoardBackgroundMode[] = ["theme", "white"];

/** The background Excalidraw writes when nobody chose one. */
export const EXCALIDRAW_DEFAULT_BACKGROUND = "#ffffff";
const WHITE = EXCALIDRAW_DEFAULT_BACKGROUND;
const UNCHOSEN = new Set(["", "#ffffff", "#fff", "transparent"]);

export function isUnchosenBoardBackground(color: string | undefined): boolean {
  return UNCHOSEN.has((color ?? "").trim().toLowerCase());
}

export interface BoardCanvasLook {
  /** Excalidraw's `theme` prop. */
  theme: "light" | "dark";
  /** Excalidraw's `appState.viewBackgroundColor`. */
  background: string;
}

export function boardCanvasLook(
  mode: BoardBackgroundMode,
  fileBackground: string | undefined,
  dark: boolean,
): BoardCanvasLook {
  const theme = mode === "white" || !dark ? "light" : "dark";
  if (!isUnchosenBoardBackground(fileBackground)) return { theme, background: (fileBackground ?? "").trim() };
  return { theme, background: mode === "white" ? WHITE : "transparent" };
}

/** The background an open board should switch to when the setting or theme
 * changes (another window's appearance sync), or null to leave it: a color
 * the person picked in the canvas this session is theirs. */
export function boardRepaint(current: unknown, next: string): string | null {
  if (typeof current !== "string" || !isUnchosenBoardBackground(current) || current === next) return null;
  return next;
}

/** What a save writes as `viewBackgroundColor`: the chosen color, or nothing. */
export function durableBoardBackground(color: string | undefined): string | undefined {
  return isUnchosenBoardBackground(color) ? undefined : (color ?? "").trim();
}
