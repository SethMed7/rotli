// THE DOCUMENT-EDITOR SWAP BOUNDARY. Only this adapter imports Univer. The
// application and OOXML codec exchange the framework-free EditableDocument.

import {
  HorizontalAlign,
  LocaleType,
  NamedStyleType,
  createUniver,
  merge,
  type IDocumentData,
  type IParagraph,
  type ITextRun,
  type ITextStyle,
} from "@univerjs/presets";
import { UniverDocsCorePreset } from "@univerjs/preset-docs-core";
import UniverPresetDocsCoreEnUS from "@univerjs/preset-docs-core/locales/en-US";
import "@univerjs/preset-docs-core/lib/index.css";
import { rotliUniverTheme, univerNeutralForTheme } from "../../brand/univerTheme";
import type {
  DocumentAlignment,
  DocumentNamedStyle,
  DocumentParagraph,
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
  for (const paragraph of document.paragraphs) {
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
  }
  if (!paragraphs.length) {
    dataStream = "\r";
    paragraphs.push({ startIndex: 0 });
  }
  dataStream += "\n";
  return {
    id: document.id,
    title: document.title,
    locale: LocaleType.EN_US,
    body: {
      dataStream,
      textRuns,
      paragraphs,
      sectionBreaks: [{ startIndex: dataStream.length - 1 }],
    },
    documentStyle: {
      pageSize: { width: 816, height: 1056 },
      marginTop: 72,
      marginRight: 84,
      marginBottom: 72,
      marginLeft: 84,
    },
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
  const marks = [...(snapshot.body?.paragraphs ?? [])].sort((a, b) => a.startIndex - b.startIndex);
  const paragraphs: DocumentParagraph[] = [];
  let start = 0;
  for (const mark of marks) {
    const end = Math.max(start, Math.min(mark.startIndex, stream.length));
    const named = fromNamedStyle(mark.paragraphStyle?.namedStyleType);
    const align = fromHorizontalAlign(mark.paragraphStyle?.horizontalAlign);
    paragraphs.push({
      runs: paragraphRuns(snapshot, start, end),
      ...(named ? { namedStyle: named } : {}),
      ...(align ? { alignment: align } : {}),
      ...(mark.bullet
        ? { list: mark.bullet.listType.toLowerCase().includes("decimal") ? "number" : "bullet" }
        : {}),
    });
    start = end + 1;
  }
  return {
    id: fallback.id,
    title: snapshot.title ?? fallback.title,
    paragraphs: paragraphs.length ? paragraphs : [{ runs: [{ text: "" }] }],
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
