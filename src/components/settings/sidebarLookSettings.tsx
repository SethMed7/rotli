// Settings → Appearance → Sidebar: its scenery and its icons (the owner,
// 2026-10-01). src/lib/sidebarLook.ts has the choices.

import type { SidebarIcons, SidebarScenery } from "../../lib/sidebarLook";
import { useSidebarLook } from "../../state/sidebarLook";
import { SegField } from "./seg";

export function SidebarLookSettings() {
  const look = useSidebarLook((s) => s.look);
  const setLook = useSidebarLook((s) => s.setLook);
  return (
    <>
      <SegField<SidebarScenery>
        label="Scenery"
        value={look.scenery}
        options={[
          ["off", "Off"],
          ["top", "Top"],
          ["bottom", "Bottom"],
          ["both", "Both"],
        ]}
        onPick={(scenery) => setLook({ scenery })}
      />
      <SegField<SidebarIcons>
        label="Icons"
        value={look.icons}
        options={[
          ["neutral", "Neutral"],
          ["color", "Color"],
        ]}
        onPick={(icons) => setLook({ icons })}
      />
      <p className="setnote">
        Scenery is your theme’s own scene, very quiet, behind the top or bottom of the sidebar. Neutral icons
        all share one ink; Color gives each kind of file its own, and keeps provider and Word marks in theirs.
      </p>
    </>
  );
}
