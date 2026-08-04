// 28px icon button with a hover label — the quokka rule: every icon labeled.

import type { MouseEventHandler, ReactNode } from "react";

interface IconButtonProps {
  label: string;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  /** Rail-toggle on state (r4 gate `.railon`). */
  pressed?: boolean;
  /** Extra class (e.g. an edge-tooltip modifier so the label never clips off the
   * window). */
  className?: string;
  disabled?: boolean;
  /** The registry action this button mirrors — hold ⌘ badges its chord onto the
   * button itself (Seth, 2026-08-04). Omit for buttons no chord drives. */
  hotkey?: string;
  children: ReactNode;
}

export function IconButton({
  label,
  onClick,
  pressed,
  className,
  disabled,
  hotkey,
  children,
}: IconButtonProps) {
  const cls = ["icobtn", pressed && "railon", className].filter(Boolean).join(" ");
  return (
    <button
      type="button"
      className={cls}
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      data-hotkey={hotkey}
      onClick={onClick}
    >
      {children}
      <span className="tip" aria-hidden="true">
        {label}
      </span>
    </button>
  );
}
