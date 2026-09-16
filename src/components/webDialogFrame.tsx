// The frame Rotli Web's explanatory dialogs share: the small modal grammar
// (.rename-overlay / .rename-card), a heading, Escape and a click outside
// close it, actions along the bottom. The connect-a-folder and chat-on-the-web
// dialogs are two instances; the frame is told once.

import { type ReactNode, useEffect, useRef } from "react";

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
  // Focus moves into the card on opening so Escape reaches its handler, and
  // returns to whatever opened it when the card goes away.
  const card = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    card.current?.focus();
    return () => opener?.focus();
  }, []);
  return (
    <div className="rename-overlay" onMouseDown={busy ? undefined : onClose}>
      <div
        ref={card}
        tabIndex={-1}
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
        <div className="web-dialog-head">
          <h2 id={`${id}-title`} className="rename-label">
            {title}
          </h2>
          <button
            type="button"
            className="web-dialog-dismiss"
            aria-label="Dismiss"
            title="Dismiss"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <div className="web-dialog-body">{children}</div>
        <div className="rename-actions">{actions}</div>
      </div>
    </div>
  );
}
