interface TextRangeLike {
  startOffset?: number;
  endOffset?: number;
  segmentId?: string;
}

interface CommandLike {
  id: string;
  type?: number;
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

export function isDocumentContentMutation(command: CommandLike): boolean {
  return command.type === UNIVER_MUTATION_COMMAND_TYPE;
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
