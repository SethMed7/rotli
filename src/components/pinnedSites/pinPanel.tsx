// A pinned site's panel (docs/decisions/2026-10-01-pinned-sites.md): under
// the title bar, not a tab. The site's own page (a native view with its own
// signed-in store) sits over the panel's body; closing hides it and keeps it
// alive for a quick return. A native view draws over everything, so ⌘K,
// Settings, and menus close the panel first.

import { useEffect, useRef, useState } from "react";

import { pinMark } from "../../lib/pinnedSites";
import { closePinPanel, hidePin, movePin, pinsAreNative, showPin } from "../../services/pinnedSites";
import { useContextMenu } from "../../state/contextMenu";
import { usePinnedSites } from "../../state/pinnedSites";
import { useUiStore } from "../../state/ui";

export function PinPanel() {
  const open = usePinnedSites((s) => s.open);
  const sites = usePinnedSites((s) => s.sites);
  const site = sites.find((candidate) => candidate.id === open) ?? null;
  const paletteOpen = useUiStore((s) => s.paletteOpen);
  const settingsOpen = useUiStore((s) => s.settingsOpen);
  const menu = useContextMenu((s) => s.menu);
  const body = useRef<HTMLDivElement>(null);
  const [problem, setProblem] = useState<{ id: string; text: string } | null>(null);

  useEffect(() => {
    if (open && (paletteOpen || settingsOpen || menu)) closePinPanel();
  }, [open, paletteOpen, settingsOpen, menu]);

  useEffect(() => {
    const node = body.current;
    if (!site || !node) return;
    const bounds = () => {
      const rect = node.getBoundingClientRect();
      return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
    };
    showPin(site, bounds()).catch((error: unknown) =>
      setProblem({ id: site.id, text: error instanceof Error ? error.message : String(error) }),
    );
    const move = () => void movePin(site, bounds());
    const resize = new ResizeObserver(move);
    resize.observe(node);
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closePinPanel();
    };
    window.addEventListener("keydown", escape);
    return () => {
      resize.disconnect();
      window.removeEventListener("keydown", escape);
      hidePin(site);
    };
  }, [site]);

  if (!site) return null;
  return (
    <div className="pin-scrim" onClick={closePinPanel}>
      <section className="pin-panel" aria-label={site.label} onClick={(event) => event.stopPropagation()}>
        <header className="pin-head">
          <span className="pin-mark" aria-hidden="true">
            {pinMark(site.label)}
          </span>
          <span className="pin-title">{site.label}</span>
          <span className="pin-host">{new URL(site.url).hostname}</span>
          <button
            type="button"
            className="pin-close"
            aria-label={`Close ${site.label}`}
            onClick={closePinPanel}
          >
            ×
          </button>
        </header>
        <div className="pin-body" ref={body}>
          {!pinsAreNative() && (
            <p className="pin-note">{site.label} opens here in the Mac app, and stays signed in.</p>
          )}
          {problem?.id === site.id && (
            <p className="pin-note err" role="alert">
              {problem.text}
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
