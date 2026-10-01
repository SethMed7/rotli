// Runs and links between the document model and Univer's snapshot. A Univer
// hyperlink is a `customRanges` entry over the text (inclusive end, the url in
// its properties), apart from the style runs; a model run carries both.

import { CustomRangeType, type ICustomRange, type IDocumentData } from "@univerjs/presets";

import { type DocumentParagraph, type DocumentRun, safeLinkUrl } from "../model";
import { fromTextStyle } from "./textStyle";

/** Hyperlink ranges for linked runs: one per stretch of runs sharing a link. */
export function linkRange(ranges: ICustomRange[], run: DocumentRun, start: number, end: number): void {
  if (!run.link || end <= start) return;
  const last = ranges.at(-1);
  // adjacent text only: a paragraph mark always sits between two paragraphs
  if (last && last.endIndex === start - 1 && last.properties?.url === run.link) {
    last.endIndex = end - 1;
    return;
  }
  ranges.push({
    rangeId: `rotli-link-${ranges.length + 1}`,
    rangeType: CustomRangeType.HYPERLINK,
    startIndex: start,
    endIndex: end - 1,
    properties: { url: run.link },
  });
}

/** A paragraph's runs from `start` to `end`: split at style runs, then at
 * link edges. A link Rotli can't open (`safeLinkUrl`) is dropped, its text kept. */
export function paragraphRuns(
  snapshot: IDocumentData,
  start: number,
  end: number,
): DocumentParagraph["runs"] {
  const body = snapshot.body;
  const stream = body?.dataStream ?? "";
  const runs = (body?.textRuns ?? [])
    .filter((run) => run.ed > start && run.st < end)
    .sort((a, b) => a.st - b.st);
  const links = (body?.customRanges ?? []).filter(
    (range) =>
      range.rangeType === CustomRangeType.HYPERLINK && range.endIndex >= start && range.startIndex < end,
  );
  const result: DocumentParagraph["runs"] = [];
  const push = (from: number, to: number, style?: DocumentRun["style"]) => {
    const cuts = new Set([from, to]);
    for (const range of links) {
      if (range.startIndex > from && range.startIndex < to) cuts.add(range.startIndex);
      if (range.endIndex + 1 > from && range.endIndex + 1 < to) cuts.add(range.endIndex + 1);
    }
    const edges = [...cuts].sort((a, b) => a - b);
    for (let i = 0; i + 1 < edges.length; i++) {
      const at = edges[i]!;
      const range = links.find((candidate) => candidate.startIndex <= at && at <= candidate.endIndex);
      const link = safeLinkUrl(range?.properties?.url);
      result.push({
        text: stream.slice(at, edges[i + 1]),
        ...(style ? { style } : {}),
        ...(link ? { link } : {}),
      });
    }
  };
  let cursor = start;
  for (const run of runs) {
    const runStart = Math.max(start, run.st);
    const runEnd = Math.min(end, run.ed);
    if (runStart > cursor) push(cursor, runStart);
    if (runEnd > runStart) push(runStart, runEnd, fromTextStyle(run.ts));
    cursor = Math.max(cursor, runEnd);
  }
  if (cursor < end) push(cursor, end);
  return result.length ? result : [{ text: "" }];
}

let routed = 0;
let nativeOpen: typeof window.open | null = null;
let opening = false;

/** While a document editor is mounted, the link plugin's `window.open` goes
 * through Rotli's guarded opener (the system browser or mail app). Returns
 * the release; the last release restores `window.open`. */
export function routeLinkOpens(openLink: (url: string) => void): () => void {
  if (routed++ === 0) {
    const original = window.open;
    nativeOpen = original;
    window.open = ((url?: string | URL, target?: string, features?: string) => {
      // the opener's own browser fallback calls window.open: let it through
      if (opening) return original.call(window, url, target, features);
      const safe = safeLinkUrl(String(url ?? ""));
      if (!safe) return null;
      opening = true;
      try {
        openLink(safe);
      } finally {
        opening = false;
      }
      return null;
    }) as typeof window.open;
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--routed === 0 && nativeOpen) {
      window.open = nativeOpen;
      nativeOpen = null;
    }
  };
}

/** Whether a link opens on the press that led to it: a plain click in the
 * text only places the caret; ⌘/Ctrl-click, or a press on the link's card
 * (anything but the canvas), opens it. */
export function opensOnPress(press: Pick<MouseEvent, "metaKey" | "ctrlKey" | "target"> | null): boolean {
  if (!press) return false;
  return press.metaKey || press.ctrlKey || (press.target as Element | null)?.tagName !== "CANVAS";
}

/** An editor's links open through `openLink` when opened on purpose
 * (`opensOnPress`). Returns the release. */
export function routeDocumentLinks(host: HTMLElement, openLink: (url: string) => void): () => void {
  let press: PointerEvent | null = null;
  const remember = (event: PointerEvent) => {
    press = event;
  };
  host.ownerDocument.addEventListener("pointerdown", remember, true);
  const release = routeLinkOpens((url) => {
    if (opensOnPress(press)) openLink(url);
  });
  return () => {
    host.ownerDocument.removeEventListener("pointerdown", remember, true);
    release();
  };
}
