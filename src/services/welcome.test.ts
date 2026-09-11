import { afterEach, expect, test } from "bun:test";

import { WELCOME_CATALOG } from "../editor/welcomeLessons";
import { useMainStore } from "../state/main";
import { activeTabOf, leaves, usePanesStore } from "../state/panes";
import { useUiStore } from "../state/ui";
import { MAIN_ROOT, mainItemIdsInFolder } from "./mainTree";
import { notesService } from "./notes";
import { WELCOME_FOLDER, ensureWelcome, openSeededWelcome, openWelcome, resetWelcome } from "./welcome";

afterEach(resetWelcome);

const idsInMain = () =>
  mainItemIdsInFolder(useMainStore.getState().manifest.tree, `${MAIN_ROOT}${WELCOME_FOLDER}`);

test("seeding creates the welcome note and nine lessons once, filed in Main in catalog order", async () => {
  const before = (await notesService.listAll()).length;
  const first = await ensureWelcome();
  expect(first.created).toBe(true);
  expect(first.noteIds).toHaveLength(WELCOME_CATALOG.length);
  expect((await notesService.listAll()).length).toBe(before + WELCOME_CATALOG.length);
  expect(idsInMain()).toEqual(first.noteIds);
  expect((await notesService.getNote(first.noteIds[0]!))?.title).toBe("Welcome to Rotli");
  expect((await notesService.getNote(first.noteIds[2]!))?.title).toBe("Tasks and progress");

  const again = await ensureWelcome();
  expect(again.created).toBe(false);
  expect(again.noteIds).toEqual(first.noteIds);
  expect((await notesService.listAll()).length).toBe(before + WELCOME_CATALOG.length);
  expect(idsInMain()).toEqual(first.noteIds);
});

test("a note removed from Main is refiled without touching the others or the files", async () => {
  const seed = await ensureWelcome();
  const removed = seed.noteIds[2]!;
  useMainStore.getState().setTree(
    useMainStore.getState().manifest.tree.map((node) =>
      "folder" in node && node.folder === WELCOME_FOLDER
        ? {
            ...node,
            children: node.children.filter((child) => !("note" in child) || child.note !== removed),
          }
        : node,
    ),
  );
  expect(idsInMain()).not.toContain(removed);
  const count = (await notesService.listAll()).length;
  const again = await ensureWelcome();
  expect(again.created).toBe(false);
  expect((await notesService.listAll()).length).toBe(count);
  const ids = idsInMain();
  expect(ids).toHaveLength(WELCOME_CATALOG.length);
  expect(ids.at(-1)).toBe(removed);
});

test("opening lands on the welcome note as an ordinary tab and leaves Settings", async () => {
  useUiStore.setState({ sidebarMode: "breve", settingsOpen: true, activeView: "Work" });
  const seed = await openWelcome();
  const tab = activeTabOf(leaves(usePanesStore.getState().root)[0]!);
  expect(tab).toMatchObject({ surfaceKind: "note", noteId: seed.noteIds[0] });
  expect(useUiStore.getState()).toMatchObject({
    settingsOpen: false,
    sidebarMode: "notes",
    activeView: null,
  });
});

test("the post-onboarding reopen only fires for a vault this session seeded", async () => {
  const original = useMainStore.getState().manifest;
  resetWelcome();
  openSeededWelcome();
  expect(useMainStore.getState().manifest).toBe(original);
  const seed = await ensureWelcome();
  usePanesStore.getState().openNewItemTab();
  openSeededWelcome();
  expect(activeTabOf(leaves(usePanesStore.getState().root)[0]!)).toMatchObject({
    surfaceKind: "note",
    noteId: seed.noteIds[0],
  });
  resetWelcome();
  usePanesStore.getState().openNewItemTab();
  openSeededWelcome();
  expect(activeTabOf(leaves(usePanesStore.getState().root)[0]!)?.surfaceKind).toBe("newItem");
});

test("a Main save failure reports and stays retryable without creating more files", async () => {
  const original = useMainStore.getState();
  // a fresh Main: the notes may already exist as files from an earlier test
  useMainStore.setState({
    manifest: { version: 1, tree: [] },
    setTree: () => useMainStore.setState({ saveState: "error", error: "Disk full" }),
  });
  try {
    await expect(ensureWelcome()).rejects.toThrow("Disk full");
    const count = (await notesService.listAll()).length;
    useMainStore.setState({ setTree: original.setTree, saveState: "idle", error: null });
    const seed = await ensureWelcome();
    expect(seed.created).toBe(false);
    expect((await notesService.listAll()).length).toBe(count);
    expect(idsInMain()).toEqual(seed.noteIds);
  } finally {
    useMainStore.setState({ setTree: original.setTree });
  }
});
