// A refresh that waits for its window to be seen. A hidden shell re-read the
// vault's chats and folders on every disk change (an agent writing notes from a
// terminal made that hundreds of refetches nobody could see — audit
// 2026-10-12); hidden, a change is only remembered, and one refresh runs when
// the window is shown again.

type VisibilityDocument = Pick<Document, "hidden"> & {
  addEventListener(type: "visibilitychange", listener: () => void): void;
  removeEventListener(type: "visibilitychange", listener: () => void): void;
};

export function refreshWhenVisible(
  refresh: () => void,
  doc: VisibilityDocument = document,
): { run: () => void; stop: () => void } {
  let pending = false;
  const onVisibility = () => {
    if (doc.hidden || !pending) return;
    pending = false;
    refresh();
  };
  doc.addEventListener("visibilitychange", onVisibility);
  return {
    run: () => {
      if (doc.hidden) pending = true;
      else refresh();
    },
    stop: () => doc.removeEventListener("visibilitychange", onVisibility),
  };
}
