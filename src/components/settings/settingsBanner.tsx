// A Settings pane's heading banner (the owner, 2026-09-29: "bring the entire
// settings area to life"): the theme's backdrop, the pane's own motif, and the
// person's quokka standing in it, with the pane's title on the calm left.

import { useUiStore } from "../../state/ui";
import { Character, type CharacterName } from "../character";
import { SETTINGS_BACKDROPS } from "./settingsBackdropArt";
import { BANNER_BACKDROPS, BANNER_MOTIFS, type BannerMotif } from "./settingsBannerArt";

export function SettingsBanner({
  title,
  pose,
  motif,
}: {
  title: string;
  pose: CharacterName;
  motif: BannerMotif;
}) {
  const family = useUiStore((s) => s.themeFamily);
  return (
    <div className="set-banner" data-banner={`${family}:${motif}`}>
      <svg className="set-banner-art" viewBox="0 0 640 120" aria-hidden="true" focusable="false">
        {BANNER_BACKDROPS[family] ?? BANNER_BACKDROPS.warm}
        {BANNER_MOTIFS[motif]}
      </svg>
      <Character name={pose} size={84} className="set-banner-quokka" accessorized alwaysVisible />
      <h3 className="set-banner-title">{title}</h3>
    </div>
  );
}

/** The page behind every pane: the theme's sky in the top corner and its
 * horizon along the bottom, pinned while the rows scroll over them. */
export function SettingsScenery() {
  const family = useUiStore((s) => s.themeFamily);
  const scenery = SETTINGS_BACKDROPS[family] ?? SETTINGS_BACKDROPS.warm;
  return (
    <div className="set-scenery" data-scenery={family} aria-hidden="true">
      <svg className="set-scenery-sky" viewBox="0 0 320 200" focusable="false">
        {scenery.sky}
      </svg>
      <svg
        className="set-scenery-horizon"
        viewBox="0 0 1200 150"
        preserveAspectRatio="xMidYMax slice"
        focusable="false"
      >
        {scenery.horizon}
      </svg>
    </div>
  );
}
