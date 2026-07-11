// THE DOCUMENT-EDITOR SWAP BOUNDARY. Only this adapter imports Univer. The
// application and OOXML codec exchange the framework-free EditableDocument.

import {
  HorizontalAlign,
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
import { UniverDocsCorePreset } from "@univerjs/preset-docs-core";
import UniverPresetDocsCoreEnUS from "@univerjs/preset-docs-core/locales/en-US";
import "@univerjs/preset-docs-core/lib/index.css";
import { rotliUniverTheme, univerNeutralForTheme } from "../../brand/univerTheme";
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
  type?: number;
}

interface UniverApiLike {
  createUniverDoc(data: Partial<IDocumentData>): FDocumentLike;
  onCommandExecuted?(callback: (command: CommandLike) => void): { dispose?: () => void } | void;
}

export interface DocumentEngineHandle {
  save(): EditableDocument;
  onDirty(callback: () => void): { dispose?: () => void } | void;
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
      pageSize: { width: 816, height: 1056 },
      marginTop: 72,
      marginRight: 84,
      marginBottom: 72,
      marginLeft: 84,
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
  const tableRanges = [...(snapshot.body?.tables ?? [])].sort((a, b) => a.startIndex - b.startIndex);
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

function isDarkTheme(): boolean {
  const theme = document.documentElement.dataset.theme;
  return theme === "dark" || theme === "charcoal";
}

export function mountDocumentEditor(host: HTMLElement, model: EditableDocument): DocumentEngineHandle {
  const themeName = document.documentElement.dataset.theme;
  const { univer, univerAPI } = createUniver({
    locale: LocaleType.EN_US,
    locales: { [LocaleType.EN_US]: merge({}, UniverPresetDocsCoreEnUS) },
    theme: rotliUniverTheme(univerNeutralForTheme(themeName)),
    darkMode: isDarkTheme(),
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
  const editor = api.createUniverDoc(documentToSnapshot(model));
  return {
    save: () => snapshotToDocument(editor.getSnapshot(), model),
    onDirty: (callback) =>
      api.onCommandExecuted?.((command) => {
        if (command.type === 1) callback();
      }),
    dispose: () => univer.dispose(),
  };
}
