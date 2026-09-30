// The switches every settings pane shares (moved out of settingsSurface.tsx,
// 2026-09-28, so a settings section in its own file can use them).

/** The sliding track + knob every switch shares — state comes from the parent's
 * .on class (`.swrow`/`.ailane-sw`), so this stays a dumb visual. */
export function SwitchKnob() {
  return (
    <span className="sw" aria-hidden="true">
      <span className="swknob" />
    </span>
  );
}

/** A real on/off switch — label + description on the left, a sliding track on
 * the right. Replaces the old ambiguous dot-in-a-box "sysrow". */
export function Toggle({
  on,
  onChange,
  title,
  desc,
  disabled,
  locked,
}: {
  on: boolean;
  onChange: () => void;
  title: string;
  desc?: string;
  disabled?: boolean;
  /** Held where it is on purpose (its description says why): only the track
   * reads as locked; the words stay readable, unlike a disabled row. */
  locked?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-disabled={disabled || locked}
      disabled={disabled}
      className={`${on ? "swrow on" : "swrow"}${disabled ? " disabled" : ""}${locked ? " locked" : ""}`}
      onClick={disabled || locked ? undefined : onChange}
    >
      <span className="swtext">
        <span className="swt">{title}</span>
        {desc && <span className="swd">{desc}</span>}
      </span>
      <SwitchKnob />
    </button>
  );
}
