// THE DOCUMENT-EDITOR SWAP BOUNDARY. Only this adapter imports Univer. The
// application and OOXML codec exchange the framework-free EditableDocument.

import {
  DocumentFlavor,
  HorizontalAlign,
  ICommandService,
  LocaleType,
  NamedStyleType,
  createUniver,
  merge,
  type IDocumentData,
  type ICustomTable,
  type IParagraph,
  type ITable,
  type ITableCell,
  type ITextRun,
  type ITextStyle,
} from "@univerjs/presets";
import {
  DOCS_VIEW_KEY,
  CreateDocTableCommand,
  DocBackground,
  DocContentInsertService,
  DocCreateTableOperation,
  DocSelectionManagerService,
  DocSkeletonManagerService,
  IRenderManagerService,
  ReplaceSnapshotCommand,
  SetDocZoomRatioOperation,
  UniverDocsCorePreset,
  VIEWPORT_KEY,
} from "@univerjs/preset-docs-core";
import UniverPresetDocsCoreEnUS from "@univerjs/preset-docs-core/locales/en-US";
import "@univerjs/preset-docs-core/lib/index.css";
import { DOCUMENT_CANVAS_COLORS, documentUniverTheme } from "../../brand/univerTheme";
import { documentFitZoom } from "../layout";
import { documentInsertionRange, documentTableRanges, isDocumentContentMutation } from "./policy";
import { GENERATED_DOCX_THEME } from "../theme";
import type {
  DocumentAlignment,
  DocumentContent,
  DocumentNamedStyle,
  DocumentParagraph,
  DocumentTable,
  DocumentTableCell,
  DocumentTextStyle,
  EditableDocument,
} from "../model";

interface FDocumentLike {
  getSnapshot(): IDocumentData;
}

interface CommandLike {
  id: string;
  type?: number;
  params?: {
    rowCount?: number;
    colCount?: number;
  };
}

interface UniverApiLike {
  createUniverDoc(data: Partial<IDocumentData>): FDocumentLike;
  executeCommand?(id: string, params: object): Promise<boolean> | boolean;
  onCommandExecuted?(callback: (command: CommandLike) => void): { dispose?: () => void } | void;
}

export interface DocumentEngineHandle {
  ready: Promise<void>;
  save(): EditableDocument;
  onDirty(callback: () => void): { dispose?: () => void } | void;
  onStructureChange(callback: () => void): { dispose(): void };
  dispose(): void;
}

function namedStyle(value?: DocumentNamedStyle): NamedStyleType | undefined {
  if (value === "title") return NamedStyleType.TITLE;
  if (value === "subtitle") return NamedStyleType.SUBTITLE;
  if (value === "heading1") return NamedStyleType.HEADING_1;
  if (value === "heading2") return NamedStyleType.HEADING_2;
  if (value === "heading3") return NamedStyleType.HEADING_3;
  if (value === "normal") return NamedStyleType.NORMAL_TEXT;
  return undefined;
}

function fromNamedStyle(value?: NamedStyleType): DocumentNamedStyle | undefined {
  if (value === NamedStyleType.TITLE) return "title";
  if (value === NamedStyleType.SUBTITLE) return "subtitle";
  if (value === NamedStyleType.HEADING_1) return "heading1";
  if (value === NamedStyleType.HEADING_2) return "heading2";
  if (value === NamedStyleType.HEADING_3) return "heading3";
  if (value === NamedStyleType.NORMAL_TEXT) return "normal";
  return undefined;
}

function horizontalAlign(value?: DocumentAlignment): HorizontalAlign | undefined {
  if (value === "left") return HorizontalAlign.LEFT;
  if (value === "center") return HorizontalAlign.CENTER;
  if (value === "right") return HorizontalAlign.RIGHT;
  if (value === "justify") return HorizontalAlign.JUSTIFIED;
  return undefined;
}

function fromHorizontalAlign(value?: HorizontalAlign): DocumentAlignment | undefined {
  if (value === HorizontalAlign.LEFT) return "left";
  if (value === HorizontalAlign.CENTER) return "center";
  if (value === HorizontalAlign.RIGHT) return "right";
  if (value === HorizontalAlign.JUSTIFIED || value === HorizontalAlign.BOTH) return "justify";
  return undefined;
}

function textStyle(style?: DocumentTextStyle): ITextStyle | undefined {
  if (!style) return undefined;
  return {
    ...(style.fontFamily ? { ff: style.fontFamily } : {}),
    ...(style.fontSize ? { fs: style.fontSize } : {}),
    ...(style.bold ? { bl: 1 } : {}),
    ...(style.italic ? { it: 1 } : {}),
    ...(style.underline ? { ul: { s: 1 } } : {}),
    ...(style.strike ? { st: { s: 1 } } : {}),
    ...(style.color ? { cl: { rgb: style.color } } : {}),
  };
}

function fromTextStyle(style?: ITextStyle): DocumentTextStyle | undefined {
  if (!style) return undefined;
  const next: DocumentTextStyle = {
    ...(style.ff ? { fontFamily: style.ff } : {}),
    ...(style.fs ? { fontSize: style.fs } : {}),
    ...(style.bl ? { bold: true } : {}),
    ...(style.it ? { italic: true } : {}),
    ...(style.ul?.s ? { underline: true } : {}),
    ...(style.st?.s ? { strike: true } : {}),
    ...(style.cl?.rgb ? { color: style.cl.rgb } : {}),
  };
  return Object.keys(next).length ? next : undefined;
}

export function documentToSnapshot(document: EditableDocument): IDocumentData {
  let dataStream = "";
  const textRuns: ITextRun[] = [];
  const paragraphs: IParagraph[] = [];
  const sectionBreaks: Array<{ startIndex: number }> = [];
  const tables: ICustomTable[] = [];
  const tableSource: Record<string, ITable> = {};

  const appendParagraph = (paragraph: DocumentParagraph) => {
    for (const run of paragraph.runs) {
      const start = dataStream.length;
      dataStream += run.text;
      const end = dataStream.length;
      const style = textStyle(run.style);
      if (style && end > start) textRuns.push({ st: start, ed: end, ts: style });
    }
    const startIndex = dataStream.length;
    dataStream += "\r";
    const paragraphNamedStyle = namedStyle(paragraph.namedStyle);
    const paragraphHorizontalAlign = horizontalAlign(paragraph.alignment);
    paragraphs.push({
      startIndex,
      ...(paragraph.namedStyle || paragraph.alignment
        ? {
            paragraphStyle: {
              ...(paragraphNamedStyle ? { namedStyleType: paragraphNamedStyle } : {}),
              ...(paragraphHorizontalAlign ? { horizontalAlign: paragraphHorizontalAlign } : {}),
            },
          }
        : {}),
      ...(paragraph.list
        ? {
            bullet: {
              listType: paragraph.list === "number" ? "decimal" : "bullet",
              listId: `rotli-${paragraph.list}`,
              nestingLevel: 0,
            },
          }
        : {}),
    });
  };

  for (const content of document.content) {
    if (content.kind === "paragraph") {
      appendParagraph(content.paragraph);
      continue;
    }
    const table = content.table;
    const tableStart = dataStream.length;
    dataStream += "\x1a";
    for (const row of table.rows) {
      dataStream += "\x1b";
      for (const cell of row.cells) {
        dataStream += "\x1c";
        const cellParagraphs = cell.paragraphs.length ? cell.paragraphs : [{ runs: [{ text: "" }] }];
        for (const paragraph of cellParagraphs) appendParagraph(paragraph);
        sectionBreaks.push({ startIndex: dataStream.length });
        dataStream += "\n\x1d";
      }
      dataStream += "\x0e";
    }
    dataStream += "\x0f";
    tables.push({ startIndex: tableStart, endIndex: dataStream.length, tableId: table.id });
    tableSource[table.id] = documentTableSource(table);
  }

  if (!document.content.length) {
    dataStream = "\r";
    paragraphs.push({ startIndex: 0 });
  }
  dataStream += "\n";
  sectionBreaks.push({ startIndex: dataStream.length - 1 });
  return {
    id: document.id,
    title: document.title,
    locale: LocaleType.EN_US,
    body: {
      dataStream,
      textRuns,
      paragraphs,
      sectionBreaks,
      ...(tables.length ? { tables } : {}),
    },
    ...(tables.length ? { tableSource } : {}),
    documentStyle: {
      documentFlavor: DocumentFlavor.TRADITIONAL,
      pageSize: { width: 816, height: 1056 },
      marginTop: 72,
      marginRight: 84,
      marginBottom: 72,
      marginLeft: 84,
      textStyle: {
        ff: GENERATED_DOCX_THEME.bodyFont,
        fs: GENERATED_DOCX_THEME.bodySizeHalfPoints / 2,
        cl: { rgb: `#${GENERATED_DOCX_THEME.bodyColor}` },
      },
    },
  };
}

function tableCellSource(cell: DocumentTableCell): ITableCell {
  return {
    margin: {
      start: { v: 10 },
      end: { v: 10 },
      top: { v: 5 },
      bottom: { v: 5 },
    },
    ...(cell.rowSpan !== undefined ? { rowSpan: cell.rowSpan } : {}),
    ...(cell.columnSpan !== undefined ? { columnSpan: cell.columnSpan } : {}),
  };
}

function documentTableSource(table: DocumentTable): ITable {
  const columnCount = Math.max(1, table.columnWidths?.length ?? 0, ...table.rows.map((row) => row.cells.length));
  const widths = table.columnWidths?.length === columnCount
    ? table.columnWidths
    : Array.from({ length: columnCount }, () => 648 / columnCount);
  return {
    tableId: table.id,
    tableRows: table.rows.map((row) => ({
      tableCells: row.cells.map(tableCellSource),
      trHeight: { val: { v: 30 }, hRule: 0 },
    })),
    tableColumns: widths.map((width) => ({ size: { type: 1, width: { v: width } } })),
    align: 0,
    indent: { v: 0 },
    textWrap: 0,
    position: {
      positionH: { relativeFrom: 5, posOffset: 0 },
      positionV: { relativeFrom: 3, posOffset: 0 },
    },
    dist: { distB: 0, distL: 0, distR: 0, distT: 0 },
    cellMargin: {
      start: { v: 10 },
      end: { v: 10 },
      top: { v: 5 },
      bottom: { v: 5 },
    },
    size: { type: 0, width: { v: widths.reduce((sum, width) => sum + width, 0) } },
  };
}

function blankDocumentTable(rowCount: number, columnCount: number): DocumentTable {
  const safeRows = Math.max(1, Math.min(50, Math.floor(rowCount)));
  const safeColumns = Math.max(1, Math.min(20, Math.floor(columnCount)));
  return {
    id: `rotli-${crypto.randomUUID()}`,
    rows: Array.from({ length: safeRows }, () => ({
      cells: Array.from({ length: safeColumns }, () => ({
        paragraphs: [{ runs: [{ text: "" }] }],
      })),
    })),
  };
}

function insertTableAfterSelection(
  snapshot: IDocumentData,
  fallback: EditableDocument,
  insertionOffset: number,
  rowCount: number,
  columnCount: number,
) {
  const document = snapshotToDocument(snapshot, fallback);
  const paragraphMarks = [...(snapshot.body?.paragraphs ?? [])]
    .sort((left, right) => left.startIndex - right.startIndex);
  let selectedParagraph = paragraphMarks.findIndex((mark) => mark.startIndex >= insertionOffset);
  if (selectedParagraph < 0) selectedParagraph = Math.max(0, paragraphMarks.length - 1);

  let paragraphIndex = 0;
  let insertionIndex = document.content.length;
  for (let index = 0; index < document.content.length; index += 1) {
    const content = document.content[index];
    if (!content || content.kind !== "paragraph") continue;
    if (paragraphIndex === selectedParagraph) {
      insertionIndex = index + 1;
      break;
    }
    paragraphIndex += 1;
  }

  const table = blankDocumentTable(rowCount, columnCount);
  document.content.splice(insertionIndex, 0, { kind: "table", table });
  if (document.content.at(-1)?.kind === "table") {
    document.content.push({ kind: "paragraph", paragraph: { runs: [{ text: "" }] } });
  }
  return { snapshot: documentToSnapshot(document), tableId: table.id };
}

function paragraphRuns(snapshot: IDocumentData, start: number, end: number) {
  const body = snapshot.body;
  const stream = body?.dataStream ?? "";
  const runs = (body?.textRuns ?? [])
    .filter((run) => run.ed > start && run.st < end)
    .sort((a, b) => a.st - b.st);
  const result: DocumentParagraph["runs"] = [];
  let cursor = start;
  for (const run of runs) {
    const runStart = Math.max(start, run.st);
    const runEnd = Math.min(end, run.ed);
    if (runStart > cursor) result.push({ text: stream.slice(cursor, runStart) });
    if (runEnd > runStart) {
      const style = fromTextStyle(run.ts);
      result.push({ text: stream.slice(runStart, runEnd), ...(style ? { style } : {}) });
    }
    cursor = Math.max(cursor, runEnd);
  }
  if (cursor < end) result.push({ text: stream.slice(cursor, end) });
  return result.length ? result : [{ text: "" }];
}

export function snapshotToDocument(snapshot: IDocumentData, fallback: EditableDocument): EditableDocument {
  const stream = snapshot.body?.dataStream ?? "";
  const tableRanges = documentTableRanges(
    stream,
    snapshot.body?.tables,
    Object.keys(snapshot.tableSource ?? {}),
  );
  const content: DocumentContent[] = [];
  let cursor = 0;
  const documentEnd = stream.endsWith("\n") ? stream.length - 1 : stream.length;
  for (const range of tableRanges) {
    for (const paragraph of paragraphsInRange(snapshot, cursor, range.startIndex)) {
      content.push({ kind: "paragraph", paragraph });
    }
    content.push({ kind: "table", table: tableInRange(snapshot, range) });
    cursor = range.endIndex;
  }
  for (const paragraph of paragraphsInRange(snapshot, cursor, documentEnd)) {
    content.push({ kind: "paragraph", paragraph });
  }
  return {
    id: fallback.id,
    title: snapshot.title ?? fallback.title,
    content: content.length
      ? content
      : [{ kind: "paragraph", paragraph: { runs: [{ text: "" }] } }],
  };
}

function paragraphsInRange(snapshot: IDocumentData, start: number, end: number): DocumentParagraph[] {
  const marks = [...(snapshot.body?.paragraphs ?? [])]
    .filter((mark) => mark.startIndex >= start && mark.startIndex < end)
    .sort((left, right) => left.startIndex - right.startIndex);
  const paragraphs: DocumentParagraph[] = [];
  let cursor = start;
  for (const mark of marks) {
    const paragraphEnd = Math.max(cursor, Math.min(mark.startIndex, end));
    const named = fromNamedStyle(mark.paragraphStyle?.namedStyleType);
    const align = fromHorizontalAlign(mark.paragraphStyle?.horizontalAlign);
    paragraphs.push({
      runs: paragraphRuns(snapshot, cursor, paragraphEnd),
      ...(named ? { namedStyle: named } : {}),
      ...(align ? { alignment: align } : {}),
      ...(mark.bullet
        ? { list: mark.bullet.listType.toLowerCase().includes("decimal") ? "number" : "bullet" }
        : {}),
    });
    cursor = paragraphEnd + 1;
  }
  return paragraphs;
}

function tableInRange(snapshot: IDocumentData, range: ICustomTable): DocumentTable {
  const stream = snapshot.body?.dataStream ?? "";
  const source = snapshot.tableSource?.[range.tableId];
  const rows: DocumentTable["rows"] = [];
  let cursor = Math.max(range.startIndex + 1, 0);
  let rowIndex = 0;
  while (cursor < range.endIndex) {
    const rowStart = stream.indexOf("\x1b", cursor);
    if (rowStart < 0 || rowStart >= range.endIndex) break;
    const rowEnd = stream.indexOf("\x0e", rowStart + 1);
    if (rowEnd < 0 || rowEnd > range.endIndex) break;
    const cells: DocumentTableCell[] = [];
    let cellCursor = rowStart + 1;
    let cellIndex = 0;
    while (cellCursor < rowEnd) {
      const cellStart = stream.indexOf("\x1c", cellCursor);
      if (cellStart < 0 || cellStart >= rowEnd) break;
      const cellEnd = stream.indexOf("\x1d", cellStart + 1);
      if (cellEnd < 0 || cellEnd > rowEnd) break;
      const sourceCell = source?.tableRows[rowIndex]?.tableCells[cellIndex];
      const paragraphs = paragraphsInRange(snapshot, cellStart + 1, cellEnd);
      cells.push({
        paragraphs: paragraphs.length ? paragraphs : [{ runs: [{ text: "" }] }],
        ...(sourceCell?.rowSpan !== undefined ? { rowSpan: sourceCell.rowSpan } : {}),
        ...(sourceCell?.columnSpan !== undefined ? { columnSpan: sourceCell.columnSpan } : {}),
      });
      cellCursor = cellEnd + 1;
      cellIndex += 1;
    }
    rows.push({ cells });
    cursor = rowEnd + 1;
    rowIndex += 1;
  }
  const columnWidths = source?.tableColumns
    .map((column) => column.size.width.v)
    .filter((width) => Number.isFinite(width) && width > 0);
  return {
    id: range.tableId,
    rows,
    ...(columnWidths?.length ? { columnWidths } : {}),
  };
}

export function mountDocumentEditor(host: HTMLElement, model: EditableDocument): DocumentEngineHandle {
  const snapshot = documentToSnapshot(model);
  snapshot.settings = {
    ...snapshot.settings,
    zoomRatio: documentFitZoom(host.clientWidth, host.clientHeight),
  };
  const { univer, univerAPI } = createUniver({
    locale: LocaleType.EN_US,
    locales: { [LocaleType.EN_US]: merge({}, UniverPresetDocsCoreEnUS) },
    theme: documentUniverTheme(),
    darkMode: false,
    presets: [
      UniverDocsCorePreset({
        container: host,
        header: true,
        toolbar: true,
        ribbonType: "simple",
        footer: false,
      }),
    ],
  });
  const api = univerAPI as unknown as UniverApiLike;
  const editor = api.createUniverDoc(snapshot);
  const injector = univer.__getInjector();
  const commandService = injector.get(ICommandService);
  const selectionManager = injector.get(DocSelectionManagerService);
  const contentInsertService = injector.get(DocContentInsertService);
  const renderManager = injector.get(IRenderManagerService);
  let disposed = false;
  const structureChangeCallbacks = new Set<() => void>();

  const styleCanvas = () => {
    if (disposed) return;
    const renderer = renderManager.getRenderById(model.id);
    const canvas = renderer?.engine.getCanvas().getCanvasEle();
    if (canvas) canvas.style.backgroundColor = DOCUMENT_CANVAS_COLORS.workspace;
    const background = renderer?.components.get(DOCS_VIEW_KEY.BACKGROUND) as DocBackground | undefined;
    background?.setFillColors(
      DOCUMENT_CANVAS_COLORS.workspace,
      DOCUMENT_CANVAS_COLORS.paper,
      DOCUMENT_CANVAS_COLORS.border,
      "transparent",
    );
  };

  const currentInsertionRange = () => {
    const streamLength = editor.getSnapshot().body?.dataStream.length ?? 0;
    const lastContentOffset = Math.max(0, streamLength - 2);
    const range = documentInsertionRange(model.id, selectionManager.getActiveTextRange());
    if (!range) {
      return {
        unitId: model.id,
        startOffset: lastContentOffset,
        endOffset: lastContentOffset,
      };
    }
    return {
      ...range,
      startOffset: Math.min(lastContentOffset, Math.max(0, range.startOffset)),
      endOffset: Math.min(lastContentOffset, Math.max(0, range.endOffset)),
    };
  };
  let lastInsertionRange = currentInsertionRange();
  const captureInsertionRange = () => {
    if (!documentInsertionRange(model.id, selectionManager.getActiveTextRange())) return;
    lastInsertionRange = currentInsertionRange();
  };
  const rememberSelection = selectionManager.textSelection$.subscribe(() => {
    captureInsertionRange();
  });
  // Toolbar popovers clear Univer's active selection before their command runs.
  // Capture on pointer-down, before focus moves into the table menu or dialog.
  let pendingTableInsertion: {
    beforeSnapshot: IDocumentData;
    beforeCount: number;
    insertionOffset: number;
    rowCount: number;
    columnCount: number;
  } | null = null;

  const rememberPendingTable = (rowCount: number, columnCount: number) => {
    const beforeSnapshot = structuredClone(editor.getSnapshot());
    pendingTableInsertion = {
      beforeSnapshot,
      beforeCount: documentTableRanges(
        beforeSnapshot.body?.dataStream ?? "",
        beforeSnapshot.body?.tables,
        Object.keys(beforeSnapshot.tableSource ?? {}),
      ).length,
      insertionOffset: lastInsertionRange.startOffset,
      rowCount,
      columnCount,
    };
  };

  const recoverPendingTable = () => {
    if (!pendingTableInsertion) return;
    const pending = pendingTableInsertion;
    pendingTableInsertion = null;
    const currentSnapshot = editor.getSnapshot();
    const currentCount = documentTableRanges(
      currentSnapshot.body?.dataStream ?? "",
      currentSnapshot.body?.tables,
      Object.keys(currentSnapshot.tableSource ?? {}),
    ).length;
    if (currentCount > pending.beforeCount) {
      structureChangeCallbacks.forEach((callback) => callback());
      return;
    }

    const recovered = insertTableAfterSelection(
      pending.beforeSnapshot,
      model,
      pending.insertionOffset,
      pending.rowCount,
      pending.columnCount,
    );
    const tableRange = recovered.snapshot.body?.tables?.find((range) => range.tableId === recovered.tableId);
    const cursor = tableRange ? tableRange.startIndex + 4 : pending.insertionOffset;
    commandService.syncExecuteCommand(ReplaceSnapshotCommand.id, {
      unitId: model.id,
      snapshot: recovered.snapshot,
      textRanges: [{ startOffset: cursor, endOffset: cursor, collapsed: true }],
      options: {},
    });
    structureChangeCallbacks.forEach((callback) => callback());
  };

  let tableConfirmTimer = 0;
  host.ownerDocument.addEventListener("pointerdown", captureInsertionRange, true);

  const rememberTableInsertion = commandService.beforeCommandExecuted((command) => {
    if (command.id !== DocCreateTableOperation.id && command.id !== CreateDocTableCommand.id) return;
    const activeInsertionRange = documentInsertionRange(model.id, selectionManager.getActiveTextRange());
    const insertionRange = activeInsertionRange ? currentInsertionRange() : lastInsertionRange;
    if (insertionRange) {
      contentInsertService.setInsertRange(insertionRange);
      if (command.id === CreateDocTableCommand.id) {
        const tableParams = command.params as { rowCount?: number; colCount?: number } | undefined;
        rememberPendingTable(tableParams?.rowCount ?? 3, tableParams?.colCount ?? 5);
        pendingTableInsertion!.insertionOffset = insertionRange.startOffset;
        // The preset dispatches this command without awaiting it from the
        // confirm callback. If Univer rejects after losing its canvas focus,
        // onCommandExecuted is never reached, so retain a guarded recovery.
        // A successful command always wins because the table-count check below
        // observes its mutation before this timer fires.
        window.clearTimeout(tableConfirmTimer);
        tableConfirmTimer = window.setTimeout(recoverPendingTable, 300);
        selectionManager.replaceDocRanges(
          [{
            startOffset: insertionRange.startOffset,
            endOffset: insertionRange.endOffset,
          }],
          { unitId: model.id, subUnitId: model.id },
          true,
        );
      }
    }
  });

  const recoverDroppedTable = commandService.onCommandExecuted((command) => {
    if (command.id !== CreateDocTableCommand.id || !pendingTableInsertion) return;
    const pending = pendingTableInsertion;
    pendingTableInsertion = null;
    queueMicrotask(() => {
      if (disposed) return;
      pendingTableInsertion = pending;
      recoverPendingTable();
    });
  });

  let mutationFrame = 0;
  const keepCanvasConventional = commandService.onCommandExecuted((command) => {
    if (!isDocumentContentMutation(command)) return;
    queueMicrotask(() => {
      if (disposed) return;
      styleCanvas();
      const engine = renderManager.getRenderById(model.id)?.engine;
      engine?.resizeBySize(
        Math.max(1, host.clientWidth - 1),
        Math.max(1, host.clientHeight - 1),
      );
      cancelAnimationFrame(mutationFrame);
      mutationFrame = requestAnimationFrame(() => {
        if (disposed) return;
        engine?.resizeBySize(Math.max(1, host.clientWidth), Math.max(1, host.clientHeight));
        styleCanvas();
      });
    });
  });

  let lastZoom = snapshot.settings.zoomRatio ?? 1;
  const fitPage = (force = false) => {
    const zoomRatio = documentFitZoom(host.clientWidth, host.clientHeight);
    if (!force && Math.abs(zoomRatio - lastZoom) < 0.01) return;
    lastZoom = zoomRatio;
    void api.executeCommand?.(SetDocZoomRatioOperation.id, {
      unitId: model.id,
      zoomRatio,
    });
  };
  const resetViewport = () => {
    const viewport = renderManager.getRenderById(model.id)?.scene.getViewport(VIEWPORT_KEY.VIEW_MAIN);
    viewport?.scrollToViewportPos({ viewportScrollX: 0, viewportScrollY: 0 });
  };
  const resizeObserver = new ResizeObserver(() => fitPage());
  resizeObserver.observe(host);

  let firstFrame = 0;
  let secondFrame = 0;
  let readyTimer = 0;
  let lateLayoutTimer = 0;
  let readySettled = false;
  let resolveReady = () => {};
  let skeletonReadySubscription: { unsubscribe(): void } | undefined;
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve;
    const settleAfterLayout = () => {
      if (readySettled || disposed) return;
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
      cancelAnimationFrame(mutationFrame);
      firstFrame = requestAnimationFrame(() => {
        // Univer's engine can mount while its host reports the pre-flex size and
        // then cache that first measurement. A same-size resize is a no-op, so
        // jolt its private canvas by one pixel before restoring the settled host
        // dimensions. This reproduces the real window-resize path that recovers
        // a page from the off-canvas sentinel without visibly moving the UI.
        const engine = renderManager.getRenderById(model.id)?.engine;
        engine?.resizeBySize(
          Math.max(1, host.clientWidth - 1),
          Math.max(1, host.clientHeight - 1),
        );
        secondFrame = requestAnimationFrame(() => {
          if (readySettled || disposed) return;
          engine?.resizeBySize(
            Math.max(1, host.clientWidth),
            Math.max(1, host.clientHeight),
          );
          // Univer can create its canvas before its document skeleton has a page.
          // Force the zoom operation after skeleton layout so the page-position
          // service reruns even when the desired ratio matches an earlier,
          // pre-layout attempt. A real window resize used to be the only thing
          // that recovered the page from its off-canvas sentinel position.
          fitPage(true);
          styleCanvas();
          resetViewport();
          readySettled = true;
          resolve();
          // Tauri can finish its tab/chrome flex transition after Univer's
          // skeleton reports ready. Repeat the same harmless size jolt once
          // after that transition so rapid New → Document flows never retain
          // the off-canvas first measurement until a human resizes the window.
          lateLayoutTimer = window.setTimeout(() => {
            if (disposed) return;
            const settledEngine = renderManager.getRenderById(model.id)?.engine;
            settledEngine?.resizeBySize(
              Math.max(1, host.clientWidth - 1),
              Math.max(1, host.clientHeight - 1),
            );
            requestAnimationFrame(() => {
              if (disposed) return;
              settledEngine?.resizeBySize(Math.max(1, host.clientWidth), Math.max(1, host.clientHeight));
              fitPage(true);
              styleCanvas();
              resetViewport();
            });
          }, 500);
        });
      });
    };
    const renderer = renderManager.getRenderById(model.id);
    const skeletonManager = renderer?.with(DocSkeletonManagerService);
    skeletonReadySubscription = skeletonManager?.currentSkeleton$.subscribe((skeleton) => {
      if (skeleton) settleAfterLayout();
    });
    // Defensive fallback for a renderer implementation that does not replay its
    // current skeleton to late subscribers. The forced operation is harmless.
    readyTimer = window.setTimeout(settleAfterLayout, 250);
    if (!skeletonManager) settleAfterLayout();
  });

  return {
    ready,
    save: () => snapshotToDocument(editor.getSnapshot(), model),
    onDirty: (callback) =>
      api.onCommandExecuted?.((command) => {
        if (isDocumentContentMutation(command)) callback();
      }),
    onStructureChange: (callback) => {
      structureChangeCallbacks.add(callback);
      return { dispose: () => structureChangeCallbacks.delete(callback) };
    },
    dispose: () => {
      disposed = true;
      readySettled = true;
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
      window.clearTimeout(readyTimer);
      window.clearTimeout(lateLayoutTimer);
      window.clearTimeout(tableConfirmTimer);
      resolveReady();
      resizeObserver.disconnect();
      skeletonReadySubscription?.unsubscribe();
      host.ownerDocument.removeEventListener("pointerdown", captureInsertionRange, true);
      rememberSelection.unsubscribe();
      rememberTableInsertion.dispose();
      recoverDroppedTable.dispose();
      keepCanvasConventional.dispose();
      structureChangeCallbacks.clear();
      univer.dispose();
    },
  };
}
