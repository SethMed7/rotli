// The pieces a short editable list in Settings shares (Librarian rules, YouTube
// stations): its rows, each with a remove button, and the line that says why
// an entry can't be added.

import type { InputHTMLAttributes, ReactNode } from "react";

/** The list's rows; `title` shows on hover (a station's address). */
export function RemovableRows({
  label,
  rows,
  chips = false,
  onRemove,
}: {
  label: string;
  rows: readonly { key: string; text: string; title?: string }[];
  chips?: boolean;
  onRemove: (key: string) => void;
}) {
  if (rows.length === 0) return null;
  return (
    <ul className={chips ? "rules-chips" : "rules-rows"} aria-label={label}>
      {rows.map((row) => (
        <li key={row.key}>
          <span title={row.title}>{row.text}</span>
          <button
            type="button"
            className="rules-remove"
            aria-label={`Remove “${row.text}”`}
            onClick={() => onRemove(row.key)}
          >
            ×
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Why the last entry wasn't added, read out as it appears. */
export function EntryProblem({ problem }: { problem: string | null }) {
  if (!problem) return null;
  return (
    <p className="setnote err" role="alert">
      {problem}
    </p>
  );
}

/** The row that adds an entry: its fields, then Add. */
export function AddRow({
  disabled,
  onAdd,
  children,
}: {
  disabled: boolean;
  onAdd: () => void;
  children: ReactNode;
}) {
  return (
    <form
      className="rules-add"
      onSubmit={(event) => {
        event.preventDefault();
        onAdd();
      }}
    >
      {children}
      <button type="submit" className="ghostbtn" disabled={disabled}>
        Add
      </button>
    </form>
  );
}

/** A field in that row. */
export function AddField({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={className ? `rules-input ${className}` : "rules-input"} {...props} />;
}

/** The row's optional name, beside its address. */
export function NameField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <AddField
      className="rules-input-name"
      aria-label={label}
      placeholder="Name (optional)"
      value={value}
      onChange={(event) => onChange(event.currentTarget.value)}
    />
  );
}
