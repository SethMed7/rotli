// What a host adds inside one of Rotli's own Settings panes
// (src/host/registry.ts): blocks before or after its body, and a label on its
// section headings. With no host these render nothing at all, so Rotli's panes
// are exactly as they were.

import { type BlockPane, notesSectionTag, paneBlocks } from "../../host/registry";

/** The host's label after one of Rotli's own section headings, if it gave one. */
export function NotesSectionTag() {
  const tag = notesSectionTag();
  if (!tag) return null;
  return (
    <>
      {" "}
      <span className="set-section-tag">{tag}</span>
    </>
  );
}

export function HostBlocks({ pane, place }: { pane: BlockPane; place: "before" | "after" }) {
  const blocks = paneBlocks(pane, place);
  if (blocks.length === 0) return null;
  // the list is frozen at registration, so a block's place in it is stable
  return blocks.map((Block, at) => <Block key={`${pane}:${place}:${String(at)}`} />);
}
