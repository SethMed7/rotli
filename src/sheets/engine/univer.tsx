// THE SWAP BOUNDARY — only this file (and theme re-export) may import @univerjs/*.
// Replace this module (+ drop @univerjs from package.json) to swap engines.

import { LocaleType, createUniver, defaultTheme, merge } from "@univerjs/presets";
import { UniverSheetsCorePreset } from "@univerjs/preset-sheets-core";
import UniverPresetSheetsCoreEnUS from "@univerjs/preset-sheets-core/locales/en-US";
import "@univerjs/preset-sheets-core/lib/index.css";
import type { SheetModel, SheetThemeMode } from "./types";
import { rotliUniverTheme, univerNeutralForTheme } from "./theme";

interface FWorkbookLike {
  save: () => unknown;
}

interface FUniverApiLike {
  createWorkbook: (data: unknown) => FWorkbookLike;
  toggleDarkMode: (dark: boolean) => void;
  onCommandExecuted?: (cb: (c: CommandInfoLike) => void) => { dispose?: () => void } | void;
}

interface CommandInfoLike {
  id?: string;
  type?: number;
}

export interface MountSheetOptions {
  model: SheetModel;
  darkMode: boolean;
  themeMode: SheetThemeMode;
}

export interface SheetHandle {
  save(): SheetModel;
  setDarkMode(dark: boolean): void;
  setThemeMode(mode: SheetThemeMode): void;
  onDirty(cb: () => void): { dispose?: () => void } | void;
  dispose(): void;
}

function liveTheme(): ReturnType<typeof rotliUniverTheme> {
  return rotliUniverTheme(univerNeutralForTheme(document.documentElement.dataset.theme));
}

/** Mount the spreadsheet engine into a host element. */
export function mountSheet(host: HTMLElement, opts: MountSheetOptions): SheetHandle {
  const { univer, univerAPI } = createUniver({
    locale: LocaleType.EN_US,
    locales: { [LocaleType.EN_US]: merge({}, UniverPresetSheetsCoreEnUS) },
    theme: opts.themeMode === "raw" ? defaultTheme : liveTheme(),
    darkMode: opts.themeMode === "raw" ? false : opts.darkMode,
    presets: [UniverSheetsCorePreset({ container: host })],
  });

  const api = univerAPI as unknown as FUniverApiLike;
  const fwb = api.createWorkbook({
    ...opts.model,
    locale: LocaleType.EN_US,
  }) as FWorkbookLike;

  let themeMode = opts.themeMode;
  let darkMode = opts.darkMode;

  const applyThemeMode = () => {
    if (themeMode === "raw") {
      api.toggleDarkMode(false);
      host.classList.add("sheet-raw");
    } else {
      host.classList.remove("sheet-raw");
      api.toggleDarkMode(darkMode);
    }
  };
  applyThemeMode();

  return {
    save: () => fwb.save() as SheetModel,
    setDarkMode(dark: boolean) {
      darkMode = dark;
      if (themeMode === "themed") api.toggleDarkMode(dark);
    },
    setThemeMode(mode: SheetThemeMode) {
      themeMode = mode;
      // Univer theme object is set at create — raw uses light chrome + CSS paper
      applyThemeMode();
    },
    onDirty(cb) {
      return api.onCommandExecuted?.((c) => {
        if (c.type === 1) cb();
      });
    },
    dispose() {
      univer.dispose();
    },
  };
}
