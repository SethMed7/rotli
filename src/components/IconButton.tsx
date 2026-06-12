// 28px icon button with a hover label — the quokka rule: every icon labeled.

import type { ReactNode } from "react";

interface IconButtonProps {
  label: string;
  onClick?: () => void;
  /** Rail-toggle on state (r4 gate `.railon`). */
  pressed?: boolean;
  children: ReactNode;
}

export function IconButton({ label, onClick, pressed, children }: IconButtonProps) {
  return (
    <button
      type="button"
      className={pressed ? "icobtn railon" : "icobtn"}
      aria-label={label}
      aria-pressed={pressed}
      onClick={onClick}
    >
      {children}
      <span className="tip" aria-hidden="true">
        {label}
      </span>
    </button>
  );
}
