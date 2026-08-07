import { useEffect, useRef, useState } from "react";

import { createManagedItem } from "../newItems/composition";
import { useUiStore } from "../state/ui";

/** Name-first entry for ordinary board creation. The request exists before the
 * file does, so cancelling this dialog cannot leave an untitled board behind. */
export function BoardNameDialog() {
  const request = useUiStore((state) => state.boardCreationRequest);
  const setRequest = useUiStore((state) => state.setBoardCreationRequest);
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

  const cancel = () => {
    if (!creating) setRequest(null);
  };
  const create = async () => {
    if (!name || creating) return;
    setCreating(true);
    setError("");
    try {
      await createManagedItem("board", { boardName: name, newTab: request.newTab });
      setRequest(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setCreating(false);
      queueMicrotask(() => inputRef.current?.focus());
    }
  };

  return (
    <div className="rename-overlay" onMouseDown={cancel}>
      <div
        className="rename-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="board-name-title"
        aria-describedby={error ? "board-name-error" : undefined}
        aria-busy={creating}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          event.stopPropagation();
          cancel();
        }}
      >
        <label id="board-name-title" className="rename-label" htmlFor="board-name-input">
          Name Excalidraw board
        </label>
        <input
          id="board-name-input"
          ref={inputRef}
          className="rename-input"
          aria-label="Board name"
          value={value}
          disabled={creating}
          autoComplete="off"
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Enter") void create();
          }}
        />
        {error && (
          <p id="board-name-error" role="alert" className="rename-error">
            Couldn’t create the board — {error}
          </p>
        )}
        <div className="rename-actions">
          <button type="button" className="rename-btn" disabled={creating} onClick={cancel}>
            Cancel
          </button>
          <button
            type="button"
            className="rename-btn primary"
            disabled={!name || creating}
            onClick={() => void create()}
          >
            {creating ? "Creating…" : "Create board"}
          </button>
        </div>
      </div>
    </div>
  );
}
