// React mount helpers for live embed widgets inside CodeMirror block decorations.
// Excalidraw + Univer load only when a ```board / ```sheet fence mounts — not on
// every note-editor open (CanvasSurface / SheetEditor already lazy-split the panes).

import { createRoot } from "react-dom/client";

export async function mountBoardEmbed(host: HTMLElement, boardId: string): Promise<() => void> {
  const { BoardEmbed } = await import("./embedBoard");
  const root = createRoot(host);
  root.render(<BoardEmbed boardId={boardId} />);
  return () => root.unmount();
}

export async function mountSheetEmbed(host: HTMLElement, fileId: string): Promise<() => void> {
  const { SheetEmbed } = await import("./embedSheet");
  const root = createRoot(host);
  root.render(<SheetEmbed fileId={fileId} />);
  return () => root.unmount();
}
