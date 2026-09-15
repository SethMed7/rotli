/** A small segmented picker (reuses the .aaseg pills). `disabled` renders the
 * same choices inert for a capability this build withholds. */
export function Seg<T extends string>({
  value,
  options,
  onPick,
  disabled = false,
}: {
  value: T;
  options: [T, string][];
  onPick: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className="segrow">
      {options.map(([v, label]) => (
        <button
          type="button"
          key={v}
          className={value === v ? "aaseg sel" : "aaseg"}
          aria-pressed={value === v}
          aria-disabled={disabled || undefined}
          disabled={disabled}
          onClick={() => onPick(v)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
