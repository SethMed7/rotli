// The one way out of a full-content view (Captures, Library, Assets,
// Archive, Trash) back to the panes. Shared so every surface says it the
// same way; the chevron is the app's back glyph, not a browser arrow.

export function BackToNotes({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="board-back" onClick={onClick}>
      <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
        <path
          d="M15 18l-6-6 6-6"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span>Back to notes</span>
    </button>
  );
}
