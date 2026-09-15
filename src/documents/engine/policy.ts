interface TextRangeLike {
  startOffset?: number;
  endOffset?: number;
  segmentId?: string;
}

interface CommandLike {
  id: string;
  type?: number;
  params?: unknown;
}

interface TableRangeLike {
  startIndex: number;
  endIndex: number;
  tableId: string;
}

/** Univer's stable public CommandType.MUTATION enum value. Kept here so the
 * policy can be tested without importing the DOM-heavy editor runtime. */
const UNIVER_MUTATION_COMMAND_TYPE = 2;

export function documentInsertionRange(unitId: string, range: TextRangeLike | null | undefined | void) {
  if (!range || !Number.isFinite(range.startOffset) || !Number.isFinite(range.endOffset)) return null;
  return {
    unitId,
    startOffset: range.startOffset as number,
    endOffset: range.endOffset as number,
    ...(range.segmentId ? { segmentId: range.segmentId } : {}),
  };
}

/** A mutation is content only when it changes the document. Univer arms a
 * collapsed caret's pending style (toolbar Bold, text color, highlight) and
 * still dispatches a rich-text mutation whose `actions` is null. Treating that
 * as content marked the file dirty and re-laid the canvas, and the relayout's
 * selection refresh cleared the pending style before the next keystroke. A
 * mutation without an `actions` key keeps the conservative content default. */
export function isDocumentContentMutation(command: CommandLike): boolean {
  if (command.type !== UNIVER_MUTATION_COMMAND_TYPE) return false;
  const params = command.params;
  if (!params || typeof params !== "object" || !("actions" in params)) return true;
  const actions = (params as { actions?: unknown }).actions;
  return Array.isArray(actions) ? actions.length > 0 : actions != null;
}

/** Univer's create-table mutation can emit the control stream and tableSource
 * without updating body.tables. Recover those ranges so the DOCX codec does not
 * serialize control characters as ordinary text. */
export function documentTableRanges(
  stream: string,
  explicit: readonly TableRangeLike[] | null | undefined,
  tableIds: readonly string[],
): TableRangeLike[] {
  if (explicit?.length) return [...explicit].sort((a, b) => a.startIndex - b.startIndex);
  const ranges: TableRangeLike[] = [];
  let cursor = 0;
  while (cursor < stream.length) {
    const startIndex = stream.indexOf("\x1a", cursor);
    if (startIndex < 0) break;
    const legacyEnd = stream.indexOf("\x0f", startIndex + 1);
    const documentedEnd = stream.indexOf("\x1f", startIndex + 1);
    const candidates = [legacyEnd, documentedEnd].filter((value) => value >= 0);
    if (!candidates.length) break;
    const endIndex = Math.min(...candidates) + 1;
    ranges.push({
      startIndex,
      endIndex,
      tableId: tableIds[ranges.length] ?? `rotli-table-${startIndex}`,
    });
    cursor = endIndex;
  }
  return ranges;
}

interface StructureLike {
  body?: { tables?: readonly unknown[]; customBlocks?: readonly unknown[] } | null;
  tableSource?: Record<string, unknown> | null;
  drawingsOrder?: readonly unknown[] | null;
}

/** The parts of a snapshot whose change needs the canvas re-measured: tables,
 * inline blocks, and drawings. Ordinary typing leaves it unchanged, so it never
 * pays the one-pixel resize (which repainted the page on every keystroke). */
export function documentStructureSignature(snapshot: StructureLike): string {
  return [
    snapshot.body?.tables?.length ?? 0,
    Object.keys(snapshot.tableSource ?? {}).length,
    snapshot.body?.customBlocks?.length ?? 0,
    snapshot.drawingsOrder?.length ?? 0,
  ].join(":");
}

interface ChordLike {
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/** ⌘A on a Mac, Ctrl+A elsewhere — the platform's plain Select All chord. */
export function isSelectAllChord(event: ChordLike, isMac: boolean): boolean {
  if (event.code !== "KeyA" || event.shiftKey || event.altKey) return false;
  return isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
}
