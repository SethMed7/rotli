import { expect, test } from "bun:test";

import type { CorpusConfigView } from "../lib/tauri";
import {
  CORPUS_INSTANCE_ID,
  activeInstance,
  chatsDirOf,
  fromCorpusConfig,
  isWritable,
  noteLaneWritable,
  openedInPlaceVault,
  storageDirOf,
} from "./config";

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

const ROLES = {
  inbox: "Inbox",
  archive: "Archive (Rotli)",
  trash: "Trash (Rotli)",
  chats: "chats (Rotli)",
  storage: "storage (Rotli)",
};

test("a brought-in vault is the write target for chat, but never the note lane", () => {
  // bug: with an imported vault active and another vault connected, chat
  // wrote into the OTHER vault, because the imported corpus wasn't an instance
  const cfg = fromCorpusConfig({
    ...view({ memexId: "mx_copy", perms: "chats+inbox", folderRoles: ROLES }),
    brains: [
      {
        id: "work",
        label: "Work",
        absPath: "/Users/sam/Work",
        memexId: "mx_work",
        mode: "open",
        perms: "chats+inbox",
        brainEnabled: true,
      },
    ],
    activeBrainId: "work",
  });
  const active = activeInstance(cfg);
  expect(active?.id).toBe(CORPUS_INSTANCE_ID);
  expect(active?.layout).toBe("imported");
  expect(active && chatsDirOf(active)).toBe("chats (Rotli)");
  expect(active && storageDirOf(active)).toBe("storage (Rotli)");
  expect(cfg.currentFolder).toBeNull();
  expect(isWritable(active)).toBe(true);
  expect(noteLaneWritable(active)).toBe(false);
  expect(noteLaneWritable(cfg.instances.find((i) => i.id === "work") ?? null)).toBe(true);
});

test("a folder connected in place is an instance too, and still offers the copy", () => {
  const cfg = fromCorpusConfig(
    view({ memexId: "mx_here", perms: "chats+inbox", folderRoles: ROLES, adopted: true }),
  );
  const vault = openedInPlaceVault(cfg);
  expect(vault?.id).toBe(CORPUS_INSTANCE_ID);
  expect(vault?.inPlace).toBe(true);
  expect(noteLaneWritable(vault)).toBe(false);
  // an unmarked folder opened in place before the marker: the display folder
  expect(openedInPlaceVault(fromCorpusConfig(view({ adopted: true })))?.root).toBe("/Users/sam/Garden");
  expect(openedInPlaceVault(fromCorpusConfig(view({ isMemex: true, memexId: "mx_1" })))).toBeNull();
});
