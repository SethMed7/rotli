// A Settings pane's heading banner (the owner, 2026-09-29: "bring the entire
// settings area to life"): the theme's backdrop, the pane's own motif, and the
// person's quokka standing in it, with the pane's title on the calm left.

import type { ReactNode } from "react";

import { useUiStore } from "../../state/ui";
import { Character, type CharacterName } from "../character";
import { SkyLife } from "../onboarding/onboardingSkyLife";
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

/** A horizon band's frame: wide, its ground on the bottom edge (the page
 * scenery here, and the sidebar's bottom scene). */
export const HORIZON_FRAME = { viewBox: "0 0 1200 150", preserveAspectRatio: "xMidYMax slice" } as const;

/** A page's scenery: the theme's sky ornament and its horizon, pinned behind
 * the content. `name` keys both, so a new scene fades in when it changes.
 * Settings and first run share it (`set-scenery`, `onb-scenery`). */
export function SceneryLayers({
  className,
  name,
  sky,
  horizon,
}: {
  className: string;
  name: string;
  sky: ReactNode;
  horizon: ReactNode;
}) {
  return (
    <div className={className} data-scenery={name} aria-hidden="true">
      <svg key={`sky-${name}`} className={`${className}-sky`} viewBox="0 0 320 200" focusable="false">
        {sky}
      </svg>
      <svg key={name} className={`${className}-horizon`} {...HORIZON_FRAME} focusable="false">
        {horizon}
      </svg>
    </div>
  );
}

/** The page behind every pane: the theme's sky in the top corner and its
 * horizon along the bottom, pinned while the rows scroll over them. */
export function SettingsScenery() {
  const family = useUiStore((s) => s.themeFamily);
  const scenery = SETTINGS_BACKDROPS[family] ?? SETTINGS_BACKDROPS.warm;
  return (
    <>
      <SceneryLayers className="set-scenery" name={family} sky={scenery.sky} horizon={scenery.horizon} />
      {/* clouds and birds in the side margins (the owner, 2026-09-30) */}
      <SkyLife family={family} className="set-sky-life" />
    </>
  );
}
