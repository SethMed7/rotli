import { useEffect, useLayoutEffect, useReducer, useRef } from "react";

import { useUiStore } from "../../state/ui";
import {
  promptMenuOffset,
  promptNavigatorTransition,
  promptPreview,
  promptStateClassName,
  type PromptLocation,
} from "./chatPromptNavigatorModel";

export function ChatPromptNavigator({
  prompts,
  activeMessageIndex,
  onJump,
}: {
  prompts: readonly PromptLocation[];
  activeMessageIndex: number | null;
  onJump: (messageIndex: number) => void;
}) {
  const navigatorStyle = useUiStore((s) => s.chatNavigatorStyle);
  const [{ open, previewMessageIndex }, dispatch] = useReducer(promptNavigatorTransition, {
    open: false,
    previewMessageIndex: null,
  });
  const rootRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<number | null>(null);

  const cancelScheduledClose = () => {
    if (closeTimerRef.current === null) return;
    window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  };
  const openMenu = () => {
    cancelScheduledClose();
    dispatch({ type: "open" });
  };
  const previewPrompt = (messageIndex: number) => {
    cancelScheduledClose();
    dispatch({ type: "preview", messageIndex });
  };
  const closeMenu = () => {
    cancelScheduledClose();
    dispatch({ type: "close" });
  };
  const scheduleClose = () => {
    cancelScheduledClose();
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      dispatch({ type: "close" });
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
      <div ref={triggerRef} className={`chat-prompt-trigger ${navigatorStyle}${open ? " open" : ""}`}>
        {prompts.slice(-7).map((prompt) => (
          <button
            type="button"
            key={prompt.messageIndex}
            className={`chat-prompt-marker ${
              promptStateClassName(prompt.messageIndex, activeMessageIndex, previewMessageIndex) ?? ""
            }`.trimEnd()}
            aria-label={`Preview prompt: ${promptPreview(prompt.text, 48)}`}
            aria-current={prompt.messageIndex === activeMessageIndex ? "location" : undefined}
            aria-expanded={open}
            aria-haspopup="true"
            onPointerEnter={() => previewPrompt(prompt.messageIndex)}
            onFocus={() => previewPrompt(prompt.messageIndex)}
            onClick={() => previewPrompt(prompt.messageIndex)}
          >
            <span aria-hidden="true">
              {navigatorStyle === "paws" && (
                <>
                  <i />
                  <i />
                  <i />
                </>
              )}
            </span>
          </button>
        ))}
      </div>
      {open && (
        <div className="chat-prompt-menu" ref={menuRef} aria-label="Jump to prompt">
          <div className="chat-prompt-list">
            {prompts.map((prompt) => (
              <button
                type="button"
                key={prompt.messageIndex}
                className={promptStateClassName(prompt.messageIndex, activeMessageIndex, previewMessageIndex)}
                aria-current={prompt.messageIndex === activeMessageIndex ? "location" : undefined}
                onPointerEnter={() => previewPrompt(prompt.messageIndex)}
                onPointerLeave={() => dispatch({ type: "clear-preview" })}
                onFocus={() => previewPrompt(prompt.messageIndex)}
                onBlur={() => dispatch({ type: "clear-preview" })}
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
