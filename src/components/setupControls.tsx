import type { KeyboardEvent, ReactNode } from "react";

import { formatChord } from "../keys/chords";
import { currentChord } from "../keys/registry";

export interface SetupOption<T extends string> {
  value: T;
  title: string;
  description: string;
  detail?: ReactNode;
}

export function setupChoiceIndex(
  key: string,
  active: number,
  length: number,
  modified = false,
): number | null {
  const digit = modified ? Number.NaN : Number(key);
  if (digit >= 1 && digit <= length) return digit - 1;
  if (key === "Home") return 0;
  if (key === "End") return length - 1;
  if (key === "ArrowRight" || key === "ArrowDown") return (active + 1) % length;
  if (key === "ArrowLeft" || key === "ArrowUp") {
    return (active < 0 ? 0 : active - 1 + length) % length;
  }
  return null;
}

export function SetupChoiceGroup<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: readonly SetupOption<T>[];
  onChange: (value: T) => void;
  label: string;
}) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]'));
    const active = buttons.findIndex((button) => button === document.activeElement);
    const next = setupChoiceIndex(
      event.key,
      active,
      buttons.length,
      event.metaKey || event.ctrlKey || event.altKey,
    );
    if (next === null) return;
    event.preventDefault();
    buttons[next]?.focus();
    buttons[next]?.click();
  };

  return (
    <div className="setup-options" role="radiogroup" aria-label={label} onKeyDown={onKeyDown}>
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <button
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            className={selected ? "setup-option selected" : "setup-option"}
            key={option.value}
            onClick={() => onChange(option.value)}
          >
            <span className="setup-option-heading">
              <kbd aria-hidden="true">{index + 1}</kbd>
              <span>{option.title}</span>
            </span>
            <span className="setup-option-description">{option.description}</span>
            {option.detail && <span className="setup-option-detail">{option.detail}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function SetupPrimary({
  children,
  disabled = false,
  onClick,
}: {
  children: ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  const chord = currentChord("setup.continue");
  return (
    <button type="button" className="setup-button primary" disabled={disabled} onClick={onClick}>
      <span>{children}</span>
      {chord && <kbd>{formatChord(chord)}</kbd>}
    </button>
  );
}
