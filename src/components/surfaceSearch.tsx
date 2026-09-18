// A surface's own search field (Tasks, Captures): our magnifier, the words, and
// a clear button. A TEXT input with the searchbox role — `type="search"` draws
// the browser's own magnifier and clear button beside ours (the owner's
// screenshot, 2026-09-18). ⌘F reaches it through keys/surfaceFind.

import { useEffect, useRef } from "react";

import { registerSurfaceFind } from "../keys/surfaceFind";
import { SearchGlyph } from "./glyphs";

export function SurfaceSearch({
  value,
  onChange,
  label,
  clearLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  /** The accessible name, also shown as the placeholder with an ellipsis. */
  label: string;
  clearLabel: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(
    () =>
      registerSurfaceFind(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }),
    [],
  );
  return (
    <label className="surface-search">
      <SearchGlyph size={14} />
      <input
        ref={inputRef}
        type="text"
        role="searchbox"
        value={value}
        placeholder={`${label}…`}
        aria-label={label}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
      {value && (
        <button type="button" aria-label={clearLabel} onClick={() => onChange("")}>
          ×
        </button>
      )}
    </label>
  );
}
