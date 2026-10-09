// The ONE inline-rename input grammar (remediation Batch 3, F12) — five surfaces
// (board/chat tab, sidebar board row, Main folder row, sidebar chat row) each
// retyped it and drifted. Canonical behavior = the drifted-forward sidebar chat
// row: autofocus + select-all, Enter commits, Esc cancels, blur cancels, and NO
// event escapes. A new-folder field passes `blur="commit"` (click-away keeps a
// typed name — the corpus new-folder law); Enter's or Esc's trailing blur never
// acts a second time — hosts sit inside draggable tabs and roving-focus rows, so a
// leaked pointerdown starts a drag and a leaked keydown fires an app chord.

import { useRef } from "react";

export function InlineRenameInput({
  defaultValue,
  ariaLabel,
  className,
  placeholder,
  onCommit,
  onCancel,
  blur = "cancel",
}: {
  defaultValue: string;
  ariaLabel: string;
  className?: string;
  placeholder?: string;
  /** May be async — commit failures are the committer's to swallow (both rename
   * hooks already catch and leave the old name standing). */
  onCommit: (value: string) => void | Promise<void>;
  onCancel: () => void;
  blur?: "cancel" | "commit" | undefined;
}) {
  const settled = useRef(false);
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
        if (e.key === "Enter") {
          // a host that refuses the name keeps the field open: once this
          // keystroke's own blur (if any) has passed, click-away works again
          settled.current = true;
          void Promise.resolve(onCommit(e.currentTarget.value)).finally(() =>
            setTimeout(() => {
              settled.current = false;
            }, 0),
          );
        } else if (e.key === "Escape") {
          settled.current = true;
          onCancel();
        }
      }}
      onBlur={(e) => {
        if (settled.current) return;
        settled.current = true;
        if (blur === "commit") void onCommit(e.currentTarget.value);
        else onCancel();
      }}
    />
  );
}
