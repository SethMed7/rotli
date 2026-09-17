// The System browser's folder row (Library, Assets, Archive, Trash) and the
// folders a search turns up above its note hits — composed by systemSurface.

import { longDateLabel } from "../../lib/dateLabels";
import type { FolderEntry } from "../../services/systemBrowser";
import { ChevronRight, FolderGlyph } from "../glyphs";

export function FolderListRow({
  entry,
  depth,
  open,
  selected,
  onToggle,
  onSelect,
  onEnter,
}: {
  entry: FolderEntry;
  depth: number;
  open: boolean;
  selected: boolean;
  onToggle: () => void;
  onSelect: (e: { metaKey: boolean; shiftKey: boolean }) => void;
  onEnter: () => void;
}) {
  return (
    <button
      type="button"
      data-folder-path={entry.path}
      className={selected ? "fdr-row folder sel" : "fdr-row folder"}
      style={{ paddingLeft: 12 + depth * 18 }}
      title="Open folder"
      onClick={onSelect}
      onDoubleClick={onEnter}
    >
      <span className="fdr-name">
        {/* the disclosure triangle — pointer affordance; the row itself stays
            the accessible control (double-click enters, single selects) */}
        <span
          className={`fchev${open ? " open" : ""}`}
          aria-hidden="true"
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <ChevronRight size={10} />
        </span>
        <FolderGlyph size={14} className="fdr-row-icon folder" />
        {entry.name}
      </span>
      <span className="fdr-date">{entry.updatedAt === null ? "—" : longDateLabel(entry.updatedAt)}</span>
      <span className="fdr-kind">Folder</span>
    </button>
  );
}

/** The Library search, for folders: every folder under the root whose name
 * matches, listed above the note hits; a click opens the folder. */
export function SearchFolderHits({
  folders,
  onOpen,
}: {
  folders: FolderEntry[];
  onOpen: (path: string) => void;
}) {
  if (folders.length === 0) return null;
  return (
    <div className="fdr-list fdr-search-folders">
      {folders.map((f) => (
        <FolderListRow
          key={f.path}
          entry={f}
          depth={0}
          open={false}
          selected={false}
          onToggle={() => {}}
          onSelect={() => onOpen(f.path)}
          onEnter={() => onOpen(f.path)}
        />
      ))}
    </div>
  );
}
