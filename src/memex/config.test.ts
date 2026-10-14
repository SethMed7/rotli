import { expect, test } from "bun:test";

import type { CorpusConfigView } from "../lib/tauri";
import { fromCorpusConfig } from "./config";

const view = (corpus: Partial<CorpusConfigView["corpus"]>): CorpusConfigView => ({
  corpus: {
    absPath: "/Users/sam/Garden",
    isMemex: false,
    memexId: null,
    perms: null,
    brainEnabled: true,
    ...corpus,
  },
  brains: [],
  folders: [],
  activeBrainId: null,
  developmentReadOnly: false,
});

test("a folder connected in place is flagged, so Settings offers a copy instead of the Librarian", () => {
  const inPlace = fromCorpusConfig(view({ adopted: true }));
  expect(inPlace.openedInPlace).toBe(true);
  expect(inPlace.currentFolder?.root).toBe("/Users/sam/Garden");
  // a Rotli vault, and an imported copy (a vault Rotli made), are not
  expect(fromCorpusConfig(view({ isMemex: true, memexId: "mx_1", perms: "chats+inbox" })).openedInPlace).toBe(
    false,
  );
  expect(fromCorpusConfig(view({ adopted: false })).openedInPlace).toBe(false);
});
