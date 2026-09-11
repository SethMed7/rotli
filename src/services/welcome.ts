// The Welcome folder: a preseeded folder in Main holding the root welcome note
// and nine lessons as ordinary notes ("a preseeded folder, that's it — it uses
// the left menu and is in main view"). Seeding happens only when a vault is
// created and on the explicit Settings action; opening an existing vault never
// writes.
import { WELCOME_CATALOG, WELCOME_LESSONS } from "../editor/welcomeLessons";
import { corpusSeedWelcome, isTauri } from "../lib/tauri";
import { useMainStore } from "../state/main";
import { usePanesStore } from "../state/panes";
import { useUiStore } from "../state/ui";
import type { WelcomeSeed } from "../types";
import { invalidateFolders, invalidateNoteLists } from "./hooks";
import { fileNoteInNamedRootFolder, mainHasNote } from "./mainTree";
import { notesService } from "./notes";

export const WELCOME_FOLDER = "Welcome";

let generation = 0;
let seeded: { generation: number; startId: string } | null = null;

const titleOf = (body: string) => body.split("\n")[0]!.replace(/^#\s+/, "").trim();

/** The browser twin's seed: an in-memory root folder holding the welcome note
 * and one note per lesson, reused by exact title so a second call is a no-op
 * (mirrors the Rust seed; the twin has no root-note lane, so the welcome note
 * lives inside the folder here). */
async function seedInMemory(): Promise<WelcomeSeed> {
  const folders = await notesService.listFolders();
  const folder =
    folders.find((f) => f.parentId === null && f.name === WELCOME_FOLDER) ??
    (await notesService.createFolder(WELCOME_FOLDER));
  const existing = await notesService.listAll();
  let created = false;
  const noteIds: string[] = [];
  for (const entry of WELCOME_CATALOG) {
    const title = titleOf(entry.body);
    const match = existing.find((n) => n.folderId === folder.id && n.title === title);
    if (match) {
      noteIds.push(match.id);
      continue;
    }
    noteIds.push((await notesService.createNote(folder.id, entry.body)).id);
    created = true;
  }
  return { created, noteIds };
}

function mainSettled(): Promise<void> {
  if (useMainStore.getState().saveState !== "saving") return Promise.resolve();
  return new Promise((resolve) => {
    const unsubscribe = useMainStore.subscribe((state) => {
      if (state.saveState === "saving") return;
      unsubscribe();
      resolve();
    });
  });
}

/** Seed the lessons (idempotent) and file every catalog note missing from Main
 * under the Welcome root folder. Resolves with the ids in catalog order: the
 * welcome note first when it still exists, then the lessons. */
export async function ensureWelcome(): Promise<WelcomeSeed> {
  const owner = generation;
  const stale = () => new Error("The vault changed while the Welcome folder was being prepared. Try again.");
  const seed = isTauri() ? await corpusSeedWelcome() : await seedInMemory();
  if (owner !== generation) throw stale();
  await Promise.all([invalidateNoteLists(), invalidateFolders()]);
  if (owner !== generation) throw stale();
  const main = useMainStore.getState();
  let tree = main.manifest.tree;
  for (const id of seed.noteIds) {
    if (!mainHasNote(tree, id)) tree = fileNoteInNamedRootFolder(tree, id, WELCOME_FOLDER);
  }
  if (tree !== main.manifest.tree) {
    main.setTree(tree);
    await mainSettled();
    if (owner !== generation) throw stale();
    const after = useMainStore.getState();
    if (after.saveState === "error")
      throw new Error(
        `${after.error}. The notes exist in the vault; open the Welcome folder again to add them to Main.`,
      );
  }
  if (seed.noteIds.length === 0) throw new Error("No welcome notes could be seeded in this vault.");
  seeded = { generation: owner, startId: seed.noteIds[0]! };
  return seed;
}

function show(id: string): void {
  useUiStore.setState({
    settingsOpen: false,
    settingsPaneRequest: null,
    sidebarMode: "notes",
    sidebarView: "home",
    sidebarCollapsed: false,
    activeView: null,
  });
  usePanesStore.getState().openNote(id);
}

/** Settings → Open welcome folder, and vault creation: seed, file, then open
 * the welcome note (or the first lesson when the welcome note was removed). */
export async function openWelcome(): Promise<WelcomeSeed> {
  const seed = await ensureWelcome();
  show(seed.noteIds[0]!);
  return seed;
}

/** After onboarding's model step: bring the welcome note back only for a vault
 * this session just seeded. A re-onboard that keeps the current vault opens
 * nothing and, above all, writes nothing. */
export function openSeededWelcome(): void {
  if (!seeded || seeded.generation !== generation) return;
  show(seeded.startId);
}

export function resetWelcome(): void {
  generation++;
  seeded = null;
}

export function welcomeUsesMemory(): boolean {
  return !isTauri();
}

/** Lesson count for copy that must stay in step with the catalog. */
export const WELCOME_LESSON_COUNT = WELCOME_LESSONS.length;
