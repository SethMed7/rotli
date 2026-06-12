// THE one resident bottom-center slot per editor pane (r5). The format bar
// lives here now; future tenants (the TTS player, the dictation pill) take
// the slot over — they never add a second floating element down there.

import type { ReactNode } from "react";

export function BottomSlot({ children }: { children: ReactNode }) {
  return <div className="bottomslot">{children}</div>;
}
