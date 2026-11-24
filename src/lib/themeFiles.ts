// Personal custom themes on this Mac (src-tauri/src/theme_files.rs): one
// JSON file per theme beside the app settings. Only the Mac app has them;
// src/themes/composition.ts keeps an in-memory store everywhere else.

import { invoke } from "@tauri-apps/api/core";

export const themeFilesList = (): Promise<string[]> => invoke<string[]>("theme_files_list");

export const themeFileRead = (id: string): Promise<string | null> =>
  invoke<string | null>("theme_file_read", { id });

export const themeFileWrite = (id: string, contents: string): Promise<void> =>
  invoke("theme_file_write", { id, contents });

export const themeFileRemove = (id: string): Promise<void> => invoke("theme_file_remove", { id });

/** The macOS save panel; false when the person cancels. */
export const themeFileExport = (id: string, name: string): Promise<boolean> =>
  invoke<boolean>("theme_file_export", { id, name });
