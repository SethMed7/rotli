// The host relays a Finder drag while it hovers a Rotli window (Tauri owns
// the OS drag session; the webview never sees DataTransfer paths). Positions
// are physical pixels as Tauri reports them; the caller converts.
import { listen } from "@tauri-apps/api/event";

import { isTauri } from "./tauri";

export interface NativeDrag {
  phase: "over" | "leave";
  x: number;
  y: number;
  count: number;
}

export function onNativeDrag(cb: (drag: NativeDrag) => void): () => void {
  if (!isTauri()) return () => {};
  const unlisten = listen<NativeDrag>("rotli:native-drag", (event) => cb(event.payload));
  return () => void unlisten.then((fn) => fn());
}
