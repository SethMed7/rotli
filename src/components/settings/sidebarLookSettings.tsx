// Settings → Appearance → Sidebar: its icons (the owner, 2026-10-01). src/lib/sidebarLook.ts has the choices.

import type { SidebarIcons } from "../../lib/sidebarLook";
import { useSidebarLook } from "../../state/sidebarLook";
import { SegField } from "./seg";

export function SidebarLookSettings() {
  const look = useSidebarLook((s) => s.look);
  const setLook = useSidebarLook((s) => s.setLook);
  return (
    <>
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
        Neutral icons all share one ink; Color gives each kind of file its own, and keeps provider and Word
        marks in theirs.
      </p>
    </>
  );
}
