// A host's blocks inside one of Rotli's own Settings panes, before or after
// its body (src/host/registry.ts paneBlocks). With no host this renders
// nothing at all, so Rotli's panes are exactly as they were.

import { type BlockPane, paneBlocks } from "../../host/registry";

export function HostBlocks({ pane, place }: { pane: BlockPane; place: "before" | "after" }) {
  const blocks = paneBlocks(pane, place);
  if (blocks.length === 0) return null;
  // the list is frozen at registration, so a block's place in it is stable
  return blocks.map((Block, at) => <Block key={`${pane}:${place}:${String(at)}`} />);
}
