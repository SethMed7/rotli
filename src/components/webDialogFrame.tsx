// The frame Rotli Web's explanatory dialogs share: the small modal grammar
// (.rename-overlay / .rename-card), a heading, Escape and a click outside
// close it, actions along the bottom. The connect-a-folder and chat-on-the-web
// dialogs are two instances; the frame is told once.

import type { ReactNode } from "react";

export function WebDialogFrame({
  id,
  title,
  busy = false,
  className,
  onClose,
  children,
  actions,
}: {
  id: string;
  title: string;
  busy?: boolean;
  className?: string | undefined;
  onClose: () => void;
  children: ReactNode;
  actions: ReactNode;
}) {
  return (
    <div className="rename-overlay" onMouseDown={busy ? undefined : onClose}>
      <div
        className={className ? `rename-card web-connect-card ${className}` : "rename-card web-connect-card"}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-busy={busy}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }}
      >
        <h2 id={`${id}-title`} className="rename-label">
          {title}
        </h2>
        {children}
        <div className="rename-actions">{actions}</div>
      </div>
    </div>
  );
}
