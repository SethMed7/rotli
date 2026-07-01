// The context-menu host — one instance mounted at the app root. Reads the open
// menu from the store, renders it as a fixed popover clamped to the viewport,
// and closes on outside-click / Esc (useTransientPopover) or after an action.
// "drill" items swap the visible list for a sub-list with a ‹ Back header, so we
// avoid floating-submenu positioning entirely (Seth, 2026-07-01).

import { useLayoutEffect, useRef, useState } from "react";
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

  // clamp inside the viewport once we know the menu's size
  useLayoutEffect(() => {
    if (!menu || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const pad = 8;
    let left = menu.x;
    let top = menu.y;
    if (left + r.width + pad > window.innerWidth) left = Math.max(pad, window.innerWidth - r.width - pad);
    if (top + r.height + pad > window.innerHeight) top = Math.max(pad, window.innerHeight - r.height - pad);
    setPos({ left, top });
  }, [menu, stack.length]);

  if (!menu) return null;
  const top = stack.length > 0 ? stack[stack.length - 1] : null;
  const items = top ? top.items : menu.items;

  return (
    <div
      ref={ref}
      className="ctxmenu"
      style={{ left: pos?.left ?? menu.x, top: pos?.top ?? menu.y }}
      role="menu"
    >
      {top && (
        <button type="button" className="ctxmenu-back" onClick={() => setStack((s) => s.slice(0, -1))}>
          <span className="ctxmenu-back-chev" aria-hidden="true">‹</span>
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
            <span className="ctxmenu-check" aria-hidden="true">{item.checked ? "★" : ""}</span>
            <span className="ctxmenu-label">{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}
