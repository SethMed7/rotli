// The sidebar, alive (the owner, 2026-10-01, from T3 Code's hill and tree
// behind its sidebar header): the theme's own scene, very quiet, behind the
// top (the header and switcher) and/or the bottom (the player and footer).
// Still art, no motion: the sidebar is always on screen, and an always-on
// animation would keep a hidden window compositing (ROTLI_DESIGN#2). It never
// takes a click; the rows read over it.

import { showsBottom, showsTop } from "../../lib/sidebarLook";
import { useSidebarLook } from "../../state/sidebarLook";
import { useUiStore } from "../../state/ui";
import { SETTINGS_BACKDROPS } from "../settings/settingsBackdropArt";
import { HORIZON_FRAME } from "../settings/settingsBanner";
import { BANNER_BACKDROPS } from "../settings/settingsBannerArt";

export function SidebarScenery() {
  const scenery = useSidebarLook((s) => s.look.scenery);
  const family = useUiStore((s) => s.themeFamily);
  if (scenery === "off") return null;
  return (
    <>
      {showsTop(scenery) && (
        <svg
          className="sb-scene sb-scene-top"
          data-scenery={`${family}:top`}
          viewBox="0 0 640 120"
          preserveAspectRatio="xMidYMax slice"
          aria-hidden="true"
          focusable="false"
        >
          {BANNER_BACKDROPS[family] ?? BANNER_BACKDROPS.warm}
        </svg>
      )}
      {showsBottom(scenery) && (
        <svg
          className="sb-scene sb-scene-bottom"
          data-scenery={`${family}:bottom`}
          {...HORIZON_FRAME}
          aria-hidden="true"
          focusable="false"
        >
          {(SETTINGS_BACKDROPS[family] ?? SETTINGS_BACKDROPS.warm).horizon}
        </svg>
      )}
    </>
  );
}
