import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { promptMenuOffset, promptPreview, type PromptLocation } from "./chatPromptNavigatorModel";

export function ChatPromptNavigator({
  prompts,
  activeMessageIndex,
  onJump,
}: {
  prompts: readonly PromptLocation[];
  activeMessageIndex: number | null;
  onJump: (messageIndex: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [previewMessageIndex, setPreviewMessageIndex] = useState<number | null>(null);
  const rootRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<number | null>(null);

  const cancelScheduledClose = () => {
    if (closeTimerRef.current === null) return;
    window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  };
  const openMenu = () => {
    cancelScheduledClose();
    setOpen(true);
  };
  const closeMenu = () => {
    cancelScheduledClose();
    setPreviewMessageIndex(null);
    setOpen(false);
  };
  const scheduleClose = () => {
    cancelScheduledClose();
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      setOpen(false);
    }, 180);
  };

  useEffect(
    () => () => {
      if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    if (!open) return;
    const closeOnPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) closeMenu();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMenu();
    };
    document.addEventListener("pointerdown", closeOnPointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const menu = menuRef.current;
    const boundary = rootRef.current?.closest<HTMLElement>(".chat-conversation");
    if (!trigger || !menu || !boundary) return;

    const positionMenu = () => {
      const triggerRect = trigger.getBoundingClientRect();
      const boundaryRect = boundary.getBoundingClientRect();
      menu.style.setProperty(
        "--chat-prompt-menu-max-height",
        `${Math.max(0, Math.floor(boundaryRect.height - 24))}px`,
      );
      const menuRect = menu.getBoundingClientRect();
      menu.style.setProperty(
        "--chat-prompt-menu-offset",
        `${promptMenuOffset({
          triggerTop: triggerRect.top,
          menuHeight: menuRect.height,
          boundaryTop: boundaryRect.top,
          boundaryBottom: boundaryRect.bottom,
        })}px`,
      );
    };

    positionMenu();
    const observer = new ResizeObserver(positionMenu);
    observer.observe(boundary);
    observer.observe(menu);
    window.addEventListener("resize", positionMenu);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", positionMenu);
    };
  }, [open, prompts.length]);

  if (prompts.length < 3) return null;

  return (
    <nav
      className="chat-prompt-nav"
      aria-label="Conversation prompts"
      ref={rootRef}
      onPointerEnter={openMenu}
      onPointerLeave={scheduleClose}
      onFocusCapture={openMenu}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) scheduleClose();
      }}
    >
      <button
        type="button"
        ref={triggerRef}
        className={open ? "chat-prompt-trigger open" : "chat-prompt-trigger"}
        aria-label="Jump to an earlier prompt"
        aria-expanded={open}
        onClick={() => {
          cancelScheduledClose();
          setOpen((value) => !value);
        }}
      >
        {prompts.slice(-7).map((prompt) => (
          <span
            key={prompt.messageIndex}
            className={[
              prompt.messageIndex === activeMessageIndex ? "active" : "",
              prompt.messageIndex === previewMessageIndex ? "preview" : "",
            ]
              .filter(Boolean)
              .join(" ")}
          />
        ))}
      </button>
      {open && (
        <div className="chat-prompt-menu" ref={menuRef} aria-label="Jump to prompt">
          <div className="chat-prompt-list">
            {prompts.map((prompt) => (
              <button
                type="button"
                key={prompt.messageIndex}
                className={prompt.messageIndex === activeMessageIndex ? "active" : undefined}
                title={prompt.text}
                onPointerEnter={() => setPreviewMessageIndex(prompt.messageIndex)}
                onPointerLeave={() => setPreviewMessageIndex(null)}
                onFocus={() => setPreviewMessageIndex(prompt.messageIndex)}
                onBlur={() => setPreviewMessageIndex(null)}
                onClick={() => {
                  onJump(prompt.messageIndex);
                  closeMenu();
                }}
              >
                {promptPreview(prompt.text)}
              </button>
            ))}
          </div>
        </div>
      )}
    </nav>
  );
}
