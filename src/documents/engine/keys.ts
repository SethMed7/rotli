// Closes Univer 0.25's keyboard gaps in a document at the adapter.
//
// Tab: Univer's Tab only nests a list item or moves between table cells; in an
// ordinary paragraph it swallows the key and does nothing. A lowest-priority
// auto-format inserts a tab character there, like Word (the codec writes it as
// <w:tab/>). Shift+Tab keeps Univer's list and table meaning only.
//
// Select All: Univer's select-all is two-step — the first press selects only
// the caret's paragraph (or table), the second the document as one range per
// paragraph, and typing then replaces only the active range. One Select All
// here selects the whole document as a single range, so typing replaces all
// of it; a document with tables keeps Univer's table-aware ranges instead.
//
// The macOS Edit menu owns ⌘A and ⌘Z/⇧⌘Z before the web view sees a keydown
// (native check, 2026-09-15). WebKit turns its selectAll:, undo:, and redo:
// into selectstart and beforeinput (historyUndo/historyRedo) on the focused
// input, which acted on that hidden element's DOM text. Both routes — Univer's
// keydown shortcut and the menu — are answered with Univer's own commands.

import type { IInsertCommandParams } from "@univerjs/preset-docs-core";

import { documentTableRanges, isSelectAllChord } from "./policy";

type DocumentBodyLike = {
  dataStream: string;
  tables?: readonly { startIndex: number; endIndex: number; tableId: string }[];
};

/** The part of Univer's auto-format context a Tab rule reads. */
export interface TabContext {
  selection: { startOffset: number; endOffset: number; collapsed: boolean; segmentId?: string };
  commandParams: object | null | undefined | void;
}

/** Structurally Univer's IAutoFormat (not exported by its preset). */
export interface TabRule {
  id: string;
  priority: number;
  match(context: TabContext): boolean;
  getMutations(context: TabContext): { id: string; params: object }[];
}

/** The vendor pieces this seam needs, injected by univer.ts so the rules stay
 * testable without loading Univer's DOM-bound UI package. */
export interface DocumentKeyServices {
  commands: {
    executeCommand(id: string): unknown;
    onCommandExecuted(listener: (command: { id: string }) => void): { dispose(): void };
  };
  autoFormat: { registerAutoFormat(rule: TabRule): { dispose(): void } };
  selection: {
    getDocRanges(): readonly { startOffset: number; endOffset: number }[];
    replaceDocRanges(
      ranges: { startOffset: number; endOffset: number }[],
      params: { unitId: string; subUnitId: string },
      isEditing: boolean,
    ): void;
  };
  /** The live document body (dataStream ends with the final "\r\n"). */
  body: () => DocumentBodyLike | null | undefined;
  ids: { tab: string; insertText: string; selectAll: string; undo: string; redo: string };
}

/** A command Univer already ran from its keydown must not run again via the menu. */
const MENU_DEDUPE_MS = 300;

/** Tab in an ordinary paragraph inserts a tab character. Univer's list nesting
 * (priority 100) and table-cell move (99) still match first. */
export function plainTabRule(ids: DocumentKeyServices["ids"], unitId: string): TabRule {
  return {
    id: ids.tab,
    priority: -1,
    match: (context) => !(context.commandParams as { shift?: boolean } | null | undefined)?.shift,
    getMutations: (context) => {
      const params: IInsertCommandParams = {
        unitId,
        body: { dataStream: "\t" },
        range: context.selection,
        ...(context.selection.segmentId ? { segmentId: context.selection.segmentId } : {}),
      };
      return [{ id: ids.insertText, params }];
    },
  };
}

/** The whole document as one text range, or null when tables need Univer's
 * rectangular ranges (a text range cannot cross a table). */
export function wholeDocumentRange(
  body: DocumentBodyLike | null | undefined,
): { startOffset: number; endOffset: number } | null {
  if (!body || documentTableRanges(body.dataStream, body.tables, []).length) return null;
  return { startOffset: 0, endOffset: Math.max(0, body.dataStream.length - 2) };
}

/** How much of the document a selection spans, first offset to last. */
export function selectionSpan(ranges: readonly { startOffset: number; endOffset: number }[]): number {
  if (!ranges.length) return 0;
  return (
    Math.max(...ranges.map((range) => range.endOffset)) -
    Math.min(...ranges.map((range) => range.startOffset))
  );
}

/** After one select-all, keep stepping Univer's two-step toggle until the
 * selection stops growing: a scoped paragraph widens to the document, and a
 * press that already had the document is restored after the toggle shrinks it. */
export async function widenToDocument(runSelectAll: () => unknown, span: () => number): Promise<void> {
  const first = span();
  await runSelectAll();
  const second = span();
  if (second < first) await runSelectAll();
}

export function installDocumentKeys(
  { commands, autoFormat, selection, body, ids }: DocumentKeyServices,
  host: HTMLElement,
  unitId: string,
): { dispose(): void } {
  const view = host.ownerDocument;
  const isMac = /Mac/.test(navigator.platform || navigator.userAgent);
  const plainTab = autoFormat.registerAutoFormat(plainTabRule(ids, unitId));

  // Univer's hidden text input for the page. The toolbar (font size, color
  // fields) lives in the same host and keeps its own field-level shortcuts.
  const inDocumentInput = (node: EventTarget | null) => {
    const element = node instanceof Element ? node : node instanceof Node ? node.parentElement : null;
    const input = element?.closest('[data-u-comp="editor"]');
    return !!input && host.contains(input);
  };

  const lastRun = new Map<string, number>();
  let widening = false;
  const watchCommands = commands.onCommandExecuted((command) => {
    lastRun.set(command.id, performance.now());
    if (command.id !== ids.selectAll || widening) return;
    widening = true;
    queueMicrotask(() => {
      const whole = wholeDocumentRange(body());
      if (whole) {
        selection.replaceDocRanges([whole], { unitId, subUnitId: unitId }, false);
        widening = false;
        return;
      }
      void widenToDocument(
        () => commands.executeCommand(ids.selectAll),
        () => selectionSpan(selection.getDocRanges()),
      ).finally(() => {
        widening = false;
      });
    });
  });
  const runFromMenu = (id: string) => {
    if (performance.now() - (lastRun.get(id) ?? -Infinity) < MENU_DEDUPE_MS) return;
    void commands.executeCommand(id);
  };

  // Registered after Univer's own capture listener, so a chord Univer handled
  // arrives here already defaultPrevented.
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || !isSelectAllChord(event, isMac)) return;
    if (!inDocumentInput(view.activeElement)) return;
    event.preventDefault();
    runFromMenu(ids.selectAll);
  };

  // A mouse drag also starts a selection; only a keyboard/menu Select All counts.
  // WebKit may target the editable root or body rather than the input itself,
  // so ownership follows focus.
  let pointerDown = false;
  const onPointerDown = () => {
    pointerDown = true;
  };
  const onPointerUp = () => {
    pointerDown = false;
  };
  const onSelectStart = (event: Event) => {
    if (pointerDown || !inDocumentInput(view.activeElement)) return;
    event.preventDefault();
    runFromMenu(ids.selectAll);
  };

  const onBeforeInput = (event: Event) => {
    const inputType = (event as InputEvent).inputType;
    if (inputType !== "historyUndo" && inputType !== "historyRedo") return;
    if (!inDocumentInput(view.activeElement)) return;
    event.preventDefault();
    runFromMenu(inputType === "historyUndo" ? ids.undo : ids.redo);
  };

  view.defaultView?.addEventListener("keydown", onKeyDown, true);
  view.addEventListener("pointerdown", onPointerDown, true);
  view.addEventListener("pointerup", onPointerUp, true);
  view.addEventListener("pointercancel", onPointerUp, true);
  view.addEventListener("selectstart", onSelectStart, true);
  view.addEventListener("beforeinput", onBeforeInput, true);

  return {
    dispose: () => {
      plainTab.dispose();
      watchCommands.dispose();
      view.defaultView?.removeEventListener("keydown", onKeyDown, true);
      view.removeEventListener("pointerdown", onPointerDown, true);
      view.removeEventListener("pointerup", onPointerUp, true);
      view.removeEventListener("pointercancel", onPointerUp, true);
      view.removeEventListener("selectstart", onSelectStart, true);
      view.removeEventListener("beforeinput", onBeforeInput, true);
    },
  };
}
