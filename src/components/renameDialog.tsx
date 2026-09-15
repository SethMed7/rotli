// Rename dialog — a small centered modal opened from the right-click menu's
// "Rename…". Seeds with the item's current name; Enter saves, Esc / click-away
// cancels. A note renames via useRenameNote (rewrites its H1); a board,
// document, or sheet renames its file (extension kept) and stays open to say
// why a name was refused.

import { useEffect, useRef, useState } from "react";

import { extOf } from "../lib/fileKind";
import { renameBoardItem } from "../services/boardRename";
import { useRenameNote } from "../services/hooks";
import { renameManagedFile } from "../services/itemRenameComposition";
import { useUiStore } from "../state/ui";
import { NameFieldDialog } from "./nameFieldDialog";

export function RenameDialog() {
  const target = useUiStore((s) => s.renameTarget);
  const setTarget = useUiStore((s) => s.setRenameTarget);
  const rename = useRenameNote();
  const [draft, setDraft] = useState({ value: "", error: "", busy: false });
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (target) {
      setDraft({ value: target.current, error: "", busy: false });
      // focus + select on open
      queueMicrotask(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [target]);

  if (!target) return null;
  const lane = target.lane ?? "title";
  const file = lane !== "title";
  const noun =
    lane === "title"
      ? "note"
      : lane === "board"
        ? "board"
        : extOf(target.id) === "xlsx"
          ? "sheet"
          : "document";
  const close = () => {
    if (!draft.busy) setTarget(null);
  };

  const commit = async () => {
    const t = draft.value.trim();
    if (!file) {
      if (t && t !== target.current) rename.mutate({ id: target.id, title: t });
      setTarget(null);
      return;
    }
    if (draft.busy) return;
    setDraft({ ...draft, error: "", busy: true });
    try {
      if (lane === "board") await renameBoardItem(target.id, t);
      else await renameManagedFile(target.id, t);
      setTarget(null);
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause);
      setDraft({ value: t, busy: false, error: `Couldn’t rename the ${noun} — ${reason}` });
      queueMicrotask(() => inputRef.current?.focus());
    }
  };

  return (
    <NameFieldDialog
      id="rename"
      title={`Rename ${noun}`}
      fieldLabel={file ? `${noun[0]!.toUpperCase()}${noun.slice(1)} name` : undefined}
      inputRef={inputRef}
      value={draft.value}
      onChange={(value) => setDraft({ ...draft, value, error: "" })}
      onSubmit={() => void commit()}
      onCancel={close}
      busy={draft.busy}
      error={draft.error}
      submitLabel="Rename"
      submitDisabled={false}
    />
  );
}
