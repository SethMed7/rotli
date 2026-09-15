import { useEffect, useRef, useState } from "react";

import { createManagedItem } from "../newItems/composition";
import type { NameFirstKind } from "../newItems/model";
import { useUiStore } from "../state/ui";
import { NameFieldDialog } from "./nameFieldDialog";

const COPY: Record<NameFirstKind, { title: string; field: string; create: string; noun: string }> = {
  board: { title: "Name Excalidraw board", field: "Board name", create: "Create board", noun: "board" },
  document: { title: "Name document", field: "Document name", create: "Create document", noun: "document" },
};

/** Name-first entry for ordinary board and document creation. The request
 * exists before the file does, so cancelling this dialog cannot leave an
 * untitled board or document behind. */
export function BoardNameDialog() {
  const request = useUiStore((state) => state.nameFirstRequest);
  const setRequest = useUiStore((state) => state.setNameFirstRequest);
  const [value, setValue] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!request) return;
    setValue("");
    setCreating(false);
    setError("");
    queueMicrotask(() => inputRef.current?.focus());
  }, [request]);

  if (!request) return null;
  const name = value.trim();
  const copy = COPY[request.kind];

  const cancel = () => {
    if (!creating) setRequest(null);
  };
  const create = async () => {
    if (!name || creating) return;
    setCreating(true);
    setError("");
    try {
      await createManagedItem(request.kind, { name, newTab: request.newTab });
      setRequest(null);
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause);
      setError(`Couldn’t create the ${copy.noun} — ${reason}`);
      setCreating(false);
      queueMicrotask(() => inputRef.current?.focus());
    }
  };

  return (
    <NameFieldDialog
      id="board-name"
      title={copy.title}
      fieldLabel={copy.field}
      inputRef={inputRef}
      value={value}
      onChange={setValue}
      onSubmit={() => void create()}
      onCancel={cancel}
      busy={creating}
      error={error}
      submitLabel={creating ? "Creating…" : copy.create}
      submitDisabled={!name}
    />
  );
}
