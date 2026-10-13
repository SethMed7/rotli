// The frame every window beside main shares (the Chat window, a folder opened
// from Finder): a title strip you drag by and double-click to zoom, a rail
// with its notice line, and the panes — or an empty stage while none is open.
// Each window brings its own title, actions, rail, and empty stage.

import type { CSSProperties, ReactNode } from "react";

import { useUiStore } from "../state/ui";
import { ContextMenu } from "./contextMenu";
import { FileNotice } from "./fileNotice";
import { PaneTree } from "./paneTree";

export function SideWindowFrame({
  className,
  drag,
  zoom,
  lead,
  title,
  actions,
  rail,
  railLabel,
  railClassName,
  empty,
  children,
}: {
  className: string;
  drag: () => void;
  zoom: () => void;
  lead?: ReactNode;
  title: ReactNode;
  actions: ReactNode;
  /** null hides the rail (the window's sidebar toggle) */
  rail: ReactNode | null;
  railLabel: string;
  railClassName: string;
  /** the empty stage while no tab is open; null shows the panes */
  empty: { title: string; body: string; action?: ReactNode } | null;
  children?: ReactNode;
}) {
  const rowActionError = useUiStore((state) => state.rowActionError);
  const setRowActionError = useUiStore((state) => state.setRowActionError);
  const sidebarWidth = useUiStore((state) => state.sidebarWidth);
  const railStyle = { "--sidebar-w": `${sidebarWidth}px` } as CSSProperties;
  const dragFrom = (event: React.MouseEvent) => {
    if (event.button === 0 && event.detail <= 1) drag();
  };
  return (
    <div className={`app-window ${className}`}>
      <header className="titlebar">
        <div className="tb-inset" onMouseDown={dragFrom} onDoubleClick={zoom} />
        {lead}
        <div className="tb-mid chat-window-title" onMouseDown={dragFrom} onDoubleClick={zoom}>
          {title}
        </div>
        <div className="tb-actions">{actions}</div>
      </header>
      <main className="app-content">
        <div className="threepane" style={railStyle} data-sidebar-side="left">
          {rail !== null && (
            <div className="rail-wrap">
              <aside className={`sidebar ${railClassName}`} aria-label={railLabel}>
                {rowActionError && (
                  <div className="sb-error" role="alert">
                    <span className="sb-error-text">⚠ {rowActionError}</span>
                    <button
                      type="button"
                      className="sb-error-x"
                      aria-label="Dismiss"
                      onClick={() => setRowActionError(null)}
                    >
                      ×
                    </button>
                  </div>
                )}
                {rail}
              </aside>
            </div>
          )}
          {empty ? (
            <div className="list-empty empty-stage">
              <div className="et">{empty.title}</div>
              <div className="es">{empty.body}</div>
              {empty.action}
            </div>
          ) : (
            <PaneTree />
          )}
        </div>
      </main>
      <FileNotice />
      <ContextMenu />
      {children}
    </div>
  );
}
