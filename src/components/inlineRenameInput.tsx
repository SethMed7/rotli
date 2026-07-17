// The ONE inline-rename input grammar (remediation Batch 3, F12) — five surfaces
// (board/chat tab, sidebar board row, Main folder row, sidebar chat row) each
// retyped it and drifted. Canonical behavior = the drifted-forward sidebar chat
// row: autofocus + select-all, Enter commits, Esc cancels, blur cancels, and NO
// event escapes — hosts sit inside draggable tabs and roving-focus rows, so a
// leaked pointerdown starts a drag and a leaked keydown fires an app chord.

export function InlineRenameInput({
  defaultValue,
  ariaLabel,
  className,
  placeholder,
  onCommit,
  onCancel,
}: {
  defaultValue: string;
  ariaLabel: string;
  className?: string;
  placeholder?: string;
  /** May be async — commit failures are the committer's to swallow (both rename
   * hooks already catch and leave the old name standing). */
  onCommit: (value: string) => void | Promise<void>;
  onCancel: () => void;
}) {
  return (
    <input
      type="text"
      className={className}
      autoFocus
      defaultValue={defaultValue}
      placeholder={placeholder}
      aria-label={ariaLabel}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onFocus={(e) => e.currentTarget.select()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") void onCommit(e.currentTarget.value);
        else if (e.key === "Escape") onCancel();
      }}
      onBlur={() => onCancel()}
    />
  );
}
