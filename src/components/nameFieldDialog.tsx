import type { RefObject } from "react";

/** The one small "type a name" modal shared by name-first creation and Rename…:
 * Enter submits, Escape or a click away cancels, a refusal stays visible. */
export function NameFieldDialog({
  id,
  title,
  fieldLabel,
  inputRef,
  value,
  onChange,
  onSubmit,
  onCancel,
  busy,
  error,
  submitLabel,
  submitDisabled,
}: {
  id: string;
  title: string;
  fieldLabel?: string | undefined;
  inputRef: RefObject<HTMLInputElement | null>;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  busy: boolean;
  error: string;
  submitLabel: string;
  submitDisabled: boolean;
}) {
  return (
    <div className="rename-overlay" onMouseDown={onCancel}>
      <div
        className="rename-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={error ? `${id}-error` : undefined}
        aria-busy={busy}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          event.stopPropagation();
          onCancel();
        }}
      >
        <label id={`${id}-title`} className="rename-label" htmlFor={`${id}-input`}>
          {title}
        </label>
        <input
          id={`${id}-input`}
          ref={inputRef}
          className="rename-input"
          aria-label={fieldLabel}
          value={value}
          disabled={busy}
          autoComplete="off"
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") return; // the card cancels
            event.stopPropagation();
            if (event.key === "Enter") onSubmit();
          }}
        />
        {error && (
          <p id={`${id}-error`} role="alert" className="rename-error">
            {error}
          </p>
        )}
        <div className="rename-actions">
          <button type="button" className="rename-btn" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="rename-btn primary"
            disabled={submitDisabled || busy}
            onClick={onSubmit}
          >
            {submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
