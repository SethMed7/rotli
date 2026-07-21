// The context-menu host — one instance mounted at the app root. Reads the open
// menu from the store, renders it as a fixed popover clamped to the viewport,
// and closes on outside-click / Esc (useTransientPopover) or after an action.
// "drill" items swap the visible list for a sub-list with a ‹ Back header, so we
// avoid floating-submenu positioning entirely (Seth, 2026-07-01).
//
// Keyboard-first too (the sidebar's "m" key opens this same menu since the
// RowMenu unification): the first item autofocuses, ArrowUp/Down move focus,
// Enter runs the focused item, and the store's returnFocus hands the cursor
// back to the opener on close.

import { type KeyboardEvent, useLayoutEffect, useRef, useState } from "react";
import { useTransientPopover } from "../lib/popover";
import { type MenuSpec, useContextMenu } from "../state/contextMenu";
import { ChevronRight } from "./glyphs";

export function ContextMenu() {
  const menu = useContextMenu((s) => s.menu);
  const close = useContextMenu((s) => s.close);
  const ref = useRef<HTMLDivElement | null>(null);
  // the drill stack: [] = the root list; each push is a sub-list (a "drill").
  const [stack, setStack] = useState<{ label: string; items: MenuSpec[] }[]>([]);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useTransientPopover([ref], !!menu, close);

  // reset the drill stack + provisional position whenever a new menu opens
  const key = menu ? `${menu.x},${menu.y},${menu.items.length}` : null;
  useLayoutEffect(() => {
    setStack([]);
    setPos(menu ? { left: menu.x, top: menu.y } : null);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  // clamp inside the viewport once we know the menu's size, then focus the
  // first enabled item so Arrow/Enter work immediately (mouse users are
  // unaffected — hover still runs items on click)
  useLayoutEffect(() => {
    if (!menu || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const pad = 8;
    let left = menu.x;
    let top = menu.y;
    if (left + r.width + pad > window.innerWidth) left = Math.max(pad, window.innerWidth - r.width - pad);
    if (top + r.height + pad > window.innerHeight) top = Math.max(pad, window.innerHeight - r.height - pad);
    setPos({ left, top });
    ref.current.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }, [menu, stack.length]);

  // ArrowUp/Down walk the visible items (drill Back button included)
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    event.stopPropagation();
    const buttons = Array.from(
      ref.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [],
    );
    const index = buttons.findIndex((b) => b === document.activeElement);
    const next = event.key === "ArrowDown" ? Math.min(index + 1, buttons.length - 1) : Math.max(index - 1, 0);
    buttons[next]?.focus();
  };

  if (!menu) return null;
  const top = stack.length > 0 ? stack[stack.length - 1] : null;
  const items = top ? top.items : menu.items;

  return (
    <div
      ref={ref}
      className="ctxmenu"
      style={{ left: pos?.left ?? menu.x, top: pos?.top ?? menu.y }}
      role="menu"
      onKeyDown={onKeyDown}
    >
      {top && (
        <button type="button" className="ctxmenu-back" onClick={() => setStack((s) => s.slice(0, -1))}>
          <span className="ctxmenu-back-chev" aria-hidden="true">
            ‹
          </span>
          {top.label}
        </button>
      )}
      {items.map((item, i) => {
        if (item.kind === "sep") return <div key={i} className="ctxmenu-sep" role="separator" />;
        if (item.kind === "drill") {
          return (
            <button
              key={i}
              type="button"
              className="ctxmenu-item"
              disabled={item.disabled}
              onClick={() => setStack((s) => [...s, { label: item.label, items: item.items }])}
            >
              <span className="ctxmenu-label">{item.label}</span>
              <ChevronRight size={11} />
            </button>
          );
        }
        return (
          <button
            key={i}
            type="button"
            className={`ctxmenu-item${item.danger ? " danger" : ""}`}
            disabled={item.disabled}
            onClick={() => {
              item.onClick();
              close();
            }}
          >
            <span className="ctxmenu-check" aria-hidden="true">
              {item.checked ? (item.checkedMark === "check" ? "✓" : "★") : ""}
            </span>
            <span className="ctxmenu-label">{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}
