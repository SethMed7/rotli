import type { SlashPickerMode } from "./slashMenu";

export interface SlashState {
  open: boolean;
  query: string;
  index: number;
  left: number;
  top: number;
  /** Opens upward when the caret row is too close to the window's bottom edge. */
  up: boolean;
}

export interface PickerState {
  mode: SlashPickerMode;
  index: number;
  left: number;
  top: number;
  up: boolean;
  insertAt: number;
  continuation: string;
}

/** The anchor of a popover a slash command opens at the cursor: /image-gen
 * (engine + prompt → PNG in storage/images) or Ask AI (`/ai`). */
export interface ImageGenState {
  kind: "imageGen" | "ai" | "chart";
  left: number;
  top: number;
  up: boolean;
  insertAt: number;
  continuation: string;
}
