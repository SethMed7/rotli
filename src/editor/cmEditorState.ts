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

/** The /image-gen popover's anchor (engine + prompt → PNG in storage/images). */
export interface ImageGenState {
  left: number;
  top: number;
  up: boolean;
  insertAt: number;
  continuation: string;
}
