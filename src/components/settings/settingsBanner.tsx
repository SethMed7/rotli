// A Settings pane's heading banner (the owner, 2026-09-29: "bring the entire
// settings area to life"): the theme's backdrop, the pane's own motif, and the
// person's quokka standing in it, with the pane's title on the calm left.

import { useUiStore } from "../../state/ui";
import { Character, type CharacterName } from "../character";
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
