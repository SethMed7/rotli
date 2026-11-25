// All notes' tag filter (2026-11-24): the vault's tags, most used first, as
// toggle chips. Picking one narrows the list to the notes that carry it;
// picking it again, or "All", clears it. Presentation only: the list comes
// from services/noteTags.ts.

import type { TagCount } from "../lib/corpusTags";

/** The filter after a chip is clicked: the clicked tag, or none when it was
 * the one already picked. */
export function toggledTag(selected: string | null, clicked: string): string | null {
  return selected === clicked ? null : clicked;
}

export function TagFilter({
  tags,
  selected,
  onSelect,
}: {
  tags: readonly TagCount[];
  selected: string | null;
  onSelect: (tag: string | null) => void;
}) {
  if (tags.length === 0) return null;
  return (
    <div className="tag-filter" role="group" aria-label="Filter by tag">
      <button
        type="button"
        className="tag-filter-chip"
        aria-pressed={selected === null}
        onClick={() => onSelect(null)}
      >
        All
      </button>
      {tags.map(({ tag, count }) => (
        <button
          key={tag}
          type="button"
          className="tag-filter-chip"
          aria-pressed={selected === tag}
          aria-label={`#${tag}, ${count} ${count === 1 ? "note" : "notes"}`}
          onClick={() => onSelect(toggledTag(selected, tag))}
        >
          #{tag}
          <span className="tag-filter-count" aria-hidden="true">
            {count}
          </span>
        </button>
      ))}
    </div>
  );
}
