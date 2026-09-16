// Copy a piece of text to the clipboard and say so for a moment. Shared by
// the Claude Docs instruction and the connector walkthrough's commands.

import { useEffect, useRef, useState } from "react";

export type CopyState = "idle" | "copied" | "failed";

export function useCopyState(): { copyState: CopyState; copy: (text: string) => Promise<void> } {
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const copyReset = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (copyReset.current !== null) window.clearTimeout(copyReset.current);
    },
    [],
  );
  const copy = async (text: string) => {
    if (copyReset.current !== null) window.clearTimeout(copyReset.current);
    try {
      if (!navigator.clipboard) throw new Error("Clipboard access is unavailable");
      await navigator.clipboard.writeText(text);
      setCopyState("copied");
      copyReset.current = window.setTimeout(() => setCopyState("idle"), 1800);
    } catch {
      setCopyState("failed");
    }
  };
  return { copyState, copy };
}
