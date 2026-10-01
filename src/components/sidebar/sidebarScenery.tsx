// The sidebar, alive (the owner, 2026-10-01, from T3 Code's hill and tree
// behind its sidebar header): the theme's own horizon as a one-ink silhouette,
// behind the header row and/or the footer. The owner, the same day: "it can't
// make things hard to see … more subtle, no visual clutter" — so no sky
// objects, no detail colors, and a few percent of ink (notes.css).
// Still art, no motion: the sidebar is always on screen, and an always-on
// animation would keep a hidden window compositing (ROTLI_DESIGN#2). It never
// takes a click; the rows read over it.

import { showsBottom, showsTop } from "../../lib/sidebarLook";
import { useSidebarLook } from "../../state/sidebarLook";
import { useUiStore } from "../../state/ui";
import { SETTINGS_BACKDROPS } from "../settings/settingsBackdropArt";
import { HORIZON_FRAME } from "../settings/settingsBanner";

export function SidebarScenery() {
  const scenery = useSidebarLook((s) => s.look.scenery);
  const family = useUiStore((s) => s.themeFamily);
  if (scenery === "off") return null;
  const horizon = (SETTINGS_BACKDROPS[family] ?? SETTINGS_BACKDROPS.warm).horizon;
  const band = (edge: "top" | "bottom") => (
    <svg
      className={`sb-scene sb-scene-${edge}`}
      data-scenery={`${family}:${edge}`}
      {...HORIZON_FRAME}
      aria-hidden="true"
      focusable="false"
    >
      {horizon}
    </svg>
  );
  return (
    <>
      {showsTop(scenery) && band("top")}
      {showsBottom(scenery) && band("bottom")}
    </>
  );
}
