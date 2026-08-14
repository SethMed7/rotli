import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";

import { formatChord } from "../../keys/chords";
import { currentChord } from "../../keys/registry";

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

/** Resolve a shortcut even before the radiogroup owns focus. The selected card
 * is the spatial anchor, so an arriving ArrowRight advances from what the user
 * can already see rather than always restarting at card one. */
export function setupChoiceTargetIndex(
  key: string,
  focused: number,
  selected: number,
  length: number,
  modified = false,
): number | null {
  return setupChoiceIndex(key, focused >= 0 ? focused : selected, length, modified);
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
  const groupRef = useRef<HTMLDivElement>(null);
  const moveFromKey = (
    event: Pick<globalThis.KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "preventDefault">,
  ) => {
    const group = groupRef.current;
    if (!group) return;
    const buttons = Array.from(group.querySelectorAll<HTMLButtonElement>('[role="radio"]'));
    const focused = buttons.findIndex((button) => button === document.activeElement);
    const selected = buttons.findIndex((button) => button.getAttribute("aria-checked") === "true");
    const next = setupChoiceTargetIndex(
      event.key,
      focused,
      selected,
      buttons.length,
      event.metaKey || event.ctrlKey || event.altKey,
    );
    if (next === null) return;
    event.preventDefault();
    buttons[next]?.focus();
    buttons[next]?.click();
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => moveFromKey(event.nativeEvent);

  useEffect(() => {
    const onDocumentKeyDown = (event: globalThis.KeyboardEvent) => {
      const group = groupRef.current;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (!group || (target && group.contains(target))) return;
      // Page-level onboarding shortcuts should work from the quiet canvas, but
      // must never steal arrows or digits from a real control or editor.
      if (
        target?.closest("input, select, textarea, a, [contenteditable='true']") ||
        (target?.closest("button") && !target.closest(".setup-system-choice"))
      )
        return;
      moveFromKey(event);
    };
    document.addEventListener("keydown", onDocumentKeyDown);
    return () => document.removeEventListener("keydown", onDocumentKeyDown);
  });

  return (
    <div ref={groupRef} className="setup-options" role="radiogroup" aria-label={label} onKeyDown={onKeyDown}>
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

export function SetupBack({ onClick, disabled = false }: { onClick: () => void; disabled?: boolean }) {
  const chord = currentChord("nav.back");
  return (
    <button type="button" className="setup-button secondary" disabled={disabled} onClick={onClick}>
      <span>Back</span>
      {chord && <kbd>{formatChord(chord)}</kbd>}
    </button>
  );
}
