// Settings → Appearance: what the titlebar sun cycles, and the editor's image
// outline. state/appearanceLook.ts keeps both; state/themeCycle.ts has the rules.

import { useAppearanceLook } from "../../state/appearanceLook";
import { SOLID_THEMES } from "../../state/themeChoices";
import { type ThemeCycle, solidThemeId } from "../../state/themeCycle";
import { SegField } from "./seg";
import { Toggle } from "./toggle";

export function ThemeCycleSettings() {
  const cycle = useAppearanceLook((s) => s.themeCycle);
  const picks = useAppearanceLook((s) => s.themeCyclePicks);
  const setLook = useAppearanceLook((s) => s.setLook);
  const togglePick = (id: string) => {
    const chosen = new Set(picks);
    if (chosen.has(id)) chosen.delete(id);
    else chosen.add(id);
    // catalog order, so the sun walks them as this list shows them
    setLook({ themeCyclePicks: SOLID_THEMES.map(solidThemeId).filter((t) => chosen.has(t)) });
  };
  return (
    <>
      <SegField<ThemeCycle>
        label="Theme button"
        value={cycle}
        options={[
          ["family", "Light and dark"],
          ["picks", "My picks"],
          ["all", "All 14"],
        ]}
        onPick={(themeCycle) => setLook({ themeCycle })}
      />
      {cycle === "picks" && (
        <div className="theme-picks" role="group" aria-label="Themes the button cycles">
          {SOLID_THEMES.map((t) => {
            const id = solidThemeId(t);
            const on = picks.includes(id);
            return (
              <button
                type="button"
                key={id}
                className={on ? "theme-pick sel" : "theme-pick"}
                aria-pressed={on}
                onClick={() => togglePick(id)}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      )}
      <p className="setnote">
        {cycle === "family"
          ? "The sun in the title bar switches between this family’s light and dark."
          : cycle === "all"
            ? "The sun in the title bar steps through all fourteen environments in order."
            : picks.length < 2
              ? "Pick two or more. Until then the sun switches between this family’s light and dark."
              : `The sun steps through your ${picks.length} picks in the order shown.`}
      </p>
    </>
  );
}

export function ImageOutlineSetting() {
  const on = useAppearanceLook((s) => s.outlineImages);
  const setLook = useAppearanceLook((s) => s.setLook);
  return (
    <Toggle
      on={on}
      onChange={() => setLook({ outlineImages: !on })}
      title="Outline images"
      desc="A quiet line around pictures and videos in a note, so a white image doesn’t melt into the page."
    />
  );
}
