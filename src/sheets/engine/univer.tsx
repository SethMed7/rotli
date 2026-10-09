// THE SWAP BOUNDARY — only this file (and theme re-export) may import @univerjs/*.
// Replace this module (+ drop @univerjs from package.json) to swap engines.

import { LocaleType, createUniver, defaultTheme, merge } from "@univerjs/presets";
import { COPY_TYPE, ISheetClipboardService, UniverSheetsCorePreset } from "@univerjs/preset-sheets-core";
import UniverPresetSheetsCoreEnUS from "@univerjs/preset-sheets-core/locales/en-US";
import "@univerjs/preset-sheets-core/lib/index.css";
import type { SheetModel, SheetThemeMode } from "./types";
import { rotliUniverTheme, univerNeutralForTheme } from "./theme";

interface FWorkbookLike {
  save: () => unknown;
  setEditable?: (editable: boolean) => FWorkbookLike;
}

interface FActiveWorkbookLike {
  getId: () => string;
  getActiveSheet: () => { getSheetId: () => string };
  getActiveRange: () => { getRange: () => unknown } | null;
  isCellEditing?: () => boolean;
}

interface FUniverApiLike {
  createWorkbook: (data: unknown) => FWorkbookLike;
  getActiveWorkbook: () => FActiveWorkbookLike | null;
  undo: () => Promise<boolean>;
  redo: () => Promise<boolean>;
  toggleDarkMode: (dark: boolean) => void;
  onCommandExecuted?: (
    cb: (c: CommandInfoLike, options?: ExecutionOptionsLike) => void,
  ) => { dispose?: () => void } | void;
}

/** Univer's CommandType.MUTATION (COMMAND 0, OPERATION 1, MUTATION 2). */
const MUTATION = 2;

/** Only a sheet MUTATION made by the person changes the workbook. Clicking
 * through cells runs selection OPERATIONs and, around them, mutations that
 * touch no cell — the formula engine's bookkeeping (formula.mutation.*) and
 * the in-cell editor priming its text box (doc.mutation.*). And the formula
 * engine writes its results back with a sheet.mutation.set-range-values of
 * its own, marked local (`onlyLocal`, `fromFormula`): a workbook with a =SUM
 * would mark itself changed on open. Counting any of those set autosave
 * writing an unchanged file (the owner, 2026-10-09: "I am just clicking,
 * nothing changed"). */
export function isWorkbookEdit(c: CommandInfoLike, options?: ExecutionOptionsLike): boolean {
  if (c.type !== MUTATION || !(c.id ?? "").startsWith("sheet.mutation.")) return false;
  return !(options?.onlyLocal || options?.fromFormula || options?.applyFormulaCalculationResult);
}

interface CommandInfoLike {
  id?: string;
  type?: number;
}

/** The execution options Univer passes beside a command (IExecutionOptions). */
interface ExecutionOptionsLike {
  onlyLocal?: boolean;
  fromFormula?: boolean;
  applyFormulaCalculationResult?: boolean;
  [key: string]: unknown;
}

export interface MountSheetOptions {
  model: SheetModel;
  darkMode: boolean;
  themeMode: SheetThemeMode;
  readOnly?: boolean;
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

const UNDO_ID = "univer.command.undo";
const REDO_ID = "univer.command.redo";
/** An undo Univer just ran from its own ⌘Z keydown must not run again here. */
const MENU_DEDUPE_MS = 300;

/** ⌘Z / ⇧⌘Z in a sheet (the owner, 2026-10-09: "we need the
 * hotkeys for undo and redo to work"). AppKit takes those keys for the menu
 * before the web view sees a keydown, and WebKit turns undo:/redo: into
 * beforeinput (historyUndo/historyRedo) on the focused element — Univer's
 * hidden cell input, which has no history of its own, so nothing changed.
 * Answered with Univer's own undo/redo, as the DOCX adapter does
 * (documents/engine/keys.ts). Native text fields keep WebKit's undo. */
function installMenuHistory(host: HTMLElement, api: FUniverApiLike): () => void {
  const lastRun = new Map<string, number>();
  const watch = api.onCommandExecuted?.((c) => {
    if (c.id === UNDO_ID || c.id === REDO_ID) lastRun.set(c.id, performance.now());
  });
  const onBeforeInput = (event: Event) => {
    const type = (event as InputEvent).inputType;
    if (type !== "historyUndo" && type !== "historyRedo") return;
    const focused = host.ownerDocument.activeElement;
    if (!focused || !host.contains(focused)) return;
    if (focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement) return;
    event.preventDefault();
    const id = type === "historyUndo" ? UNDO_ID : REDO_ID;
    if (performance.now() - (lastRun.get(id) ?? -Infinity) < MENU_DEDUPE_MS) return;
    void (type === "historyUndo" ? api.undo() : api.redo());
  };
  // ⇧⌘Z is the Mac's redo; Univer binds only ⌘Y (it answers ⌘Z itself)
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.code !== "KeyZ" || !event.shiftKey || event.altKey) return;
    if (!(event.metaKey || event.ctrlKey)) return;
    const focused = host.ownerDocument.activeElement;
    if (!focused || !host.contains(focused)) return;
    if (focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement) return;
    event.preventDefault();
    void api.redo();
  };
  host.ownerDocument.addEventListener("beforeinput", onBeforeInput, true);
  host.ownerDocument.addEventListener("keydown", onKeyDown, true);
  return () => {
    host.ownerDocument.removeEventListener("beforeinput", onBeforeInput, true);
    host.ownerDocument.removeEventListener("keydown", onKeyDown, true);
    if (watch && typeof watch === "object") watch.dispose?.();
  };
}

type SheetClipboardLike = Pick<ISheetClipboardService, "generateCopyContent" | "copyContentCache">;

/** ⌘C / ⌘X from the Mac's Edit menu (the owner, 2026-10-09: "cmd+c is not
 * working in sheets when copying a column"). AppKit takes those keys for the
 * menu, and WebKit fires `copy` / `cut` at the focused element — Univer's
 * hidden cell input, holding at most one cell's text — while Univer copies
 * only from its own ⌘C keydown. So the selection is put on the clipboard here,
 * exactly as Univer's copy() builds it (and cached, so pasting back into
 * Rotli keeps formulas and styles; a cut moves the cells on that paste), but
 * written into the event, the one place WebKit takes it synchronously. In the
 * browser Univer's own copy listener still runs after this one and wins.
 * A cell being typed in keeps the browser's copy of its selected text. */
function installMenuClipboard(
  host: HTMLElement,
  api: FUniverApiLike,
  // looked up per copy: Univer registers it only once the workbook is up
  clipboardService: () => SheetClipboardLike | null,
): () => void {
  const onClipboard = (event: ClipboardEvent) => {
    const focused = host.ownerDocument.activeElement;
    if (!focused || !host.contains(focused) || !event.clipboardData) return;
    if (focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement) return;
    const workbook = api.getActiveWorkbook();
    const range = workbook?.getActiveRange()?.getRange();
    const clipboard = clipboardService();
    if (!workbook || !range || !clipboard || workbook.isCellEditing?.()) return;
    const copyType = event.type === "cut" ? COPY_TYPE.CUT : COPY_TYPE.COPY;
    const unitId = workbook.getId();
    const subUnitId = workbook.getActiveSheet().getSheetId();
    const content = clipboard.generateCopyContent(unitId, subUnitId, range as never, { copyType });
    if (!content) return;
    clipboard.copyContentCache().set(content.copyId, {
      unitId,
      subUnitId,
      range: content.discreteRange,
      matrix: content.matrixFragment,
      copyType,
    });
    event.clipboardData.setData("text/plain", content.plain);
    event.clipboardData.setData("text/html", content.html);
    event.preventDefault();
  };
  host.ownerDocument.addEventListener("copy", onClipboard, true);
  host.ownerDocument.addEventListener("cut", onClipboard, true);
  return () => {
    host.ownerDocument.removeEventListener("copy", onClipboard, true);
    host.ownerDocument.removeEventListener("cut", onClipboard, true);
  };
}

/** Mount the spreadsheet engine into a host element. */
export function mountSheet(host: HTMLElement, opts: MountSheetOptions): SheetHandle {
  const { univer, univerAPI } = createUniver({
    locale: LocaleType.EN_US,
    locales: { [LocaleType.EN_US]: merge({}, UniverPresetSheetsCoreEnUS) },
    theme: opts.themeMode === "raw" ? defaultTheme : liveTheme(),
    darkMode: opts.themeMode === "raw" ? false : opts.darkMode,
    // One toolbar row, as the DOCX editor has: Univer's classic ribbon adds a
    // Start / Formulas / Data tab row above a centred toolbar.
    presets: [UniverSheetsCorePreset({ container: host, ribbonType: "simple" })],
  });

  const api = univerAPI as unknown as FUniverApiLike;
  const releaseMenuHistory = installMenuHistory(host, api);
  const injector = univer.__getInjector();
  const releaseMenuClipboard = installMenuClipboard(host, api, () => {
    try {
      return injector.get(ISheetClipboardService);
    } catch {
      return null;
    }
  });
  const fwb = api.createWorkbook({
    ...opts.model,
    locale: LocaleType.EN_US,
  }) as FWorkbookLike;
  if (opts.readOnly) fwb.setEditable?.(false);

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
      return api.onCommandExecuted?.((c, options) => {
        if (isWorkbookEdit(c, options)) cb();
      });
    },
    dispose() {
      releaseMenuHistory();
      releaseMenuClipboard();
      univer.dispose();
    },
  };
}
