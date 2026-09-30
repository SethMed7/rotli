// While the Vault view is on, tell the Librarian which notes are on screen in
// the sidebar (services/vaultVisibility.ts), so a note is never filed away
// under the person's eyes. A row counts while any of it shows in the sidebar's
// scroll area and the window is visible; everything else may move.

import { useEffect } from "react";

import { setLibrarianVisible } from "../../services/vaultVisibility";

const SETTLE_MS = 300;

export function useVaultVisibility(on: boolean): void {
  useEffect(() => {
    if (!on) return;
    const tree = document.querySelector(".main-tree");
    const visible = new Set<string>();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const send = () => {
      timer = null;
      setLibrarianVisible(document.hidden ? [] : [...visible]);
    };
    const schedule = () => {
      timer ??= setTimeout(send, SETTLE_MS);
    };
    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const id = (entry.target as HTMLElement).dataset.noteId;
        if (!id) continue;
        if (entry.isIntersecting) visible.add(id);
        else visible.delete(id);
      }
      schedule();
    });
    const observeRows = () => {
      io.disconnect();
      visible.clear();
      tree?.querySelectorAll("[data-note-id]").forEach((row) => io.observe(row));
      schedule();
    };
    const rows = new MutationObserver(observeRows);
    if (tree) rows.observe(tree, { childList: true, subtree: true });
    observeRows();
    document.addEventListener("visibilitychange", schedule);
    return () => {
      io.disconnect();
      rows.disconnect();
      document.removeEventListener("visibilitychange", schedule);
      if (timer) clearTimeout(timer);
      setLibrarianVisible([]);
    };
  }, [on]);
}
