// The Librarian keeps the vault (2026-09-28; the pure half is
// src/lib/librarianPeople.ts) — the effectful half. Additions happen as soon
// as the reply lands: new People groups and filing rules join the Librarian
// rules (saved before anything is filed, because Rust reads the same file),
// and each new person gets a note, filled in with what was said, tagged and
// filed into their group. The note is journaled as a "create" row, so
// Librarian Activity can undo it (to the Trash) like any other change. A
// change to someone who already has a note waits for the person's yes, and
// touches only its metadata and where it's filed, never its words.

import type { LibrarianAction } from "../lib/librarianActions";
import { type KeptLine, personBody, type VaultAction } from "../lib/librarianPeople";
import type { LibrarianRules } from "../lib/librarianRules";
import { corpusNotePath } from "../lib/tauri";
import { useLibrarianRules } from "../state/librarianRules";
import { flushSettingsNow } from "../state/persist";
import type { BrainAction } from "./brainJournal";
import { logAction } from "./brainJournalStore";
import { createRoutedNote } from "./createNote";
import { invalidateJournal } from "./hooks";
import { applyLibrarian } from "./librarianBar";

export interface KeepDeps {
  rules: () => LibrarianRules;
  setRules: (rules: LibrarianRules) => void;
  saveRules: () => Promise<void>;
  createNote: (body: string) => Promise<string>;
  notePath: (id: string) => Promise<string>;
  log: (action: Omit<BrainAction, "id" | "ts" | "status">) => Promise<unknown>;
  apply: (actions: LibrarianAction[], note: { id: string; title: string; model: string }) => Promise<number>;
  refresh: () => Promise<void>;
}

export const liveKeepDeps: KeepDeps = {
  rules: () => useLibrarianRules.getState().rules,
  setRules: (rules) => useLibrarianRules.getState().setRules(rules),
  saveRules: flushSettingsNow,
  // no folder picked: a Library note, written to the intake and filed from there
  createNote: (body) => createRoutedNote({ selectedFolderId: "", isSmart: true, localFallback: "", body }),
  notePath: corpusNotePath,
  log: logAction,
  apply: (actions, note) => applyLibrarian(actions, note),
  refresh: invalidateJournal,
};

const why = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** The metadata a person's note gets: their tags, then their group. */
function personChanges(action: { area: string | null; tags: string[] }): LibrarianAction[] {
  return [
    ...(action.tags.length > 0 ? [{ type: "tag" as const, tags: action.tags }] : []),
    ...(action.area ? [{ type: "file" as const, area: action.area, create: true }] : []),
  ];
}

/** Apply a reply's additions: groups and rules, then new people. Updates to
 * existing people are skipped here; they wait for `answerUpdate`. */
export async function keepVault(
  actions: readonly VaultAction[],
  model: string,
  deps: KeepDeps = liveKeepDeps,
): Promise<KeptLine[]> {
  const lines: KeptLine[] = [];
  const groups = actions.flatMap((a) => (a.type === "group" ? [a.name] : []));
  const filing = actions.flatMap((a) => (a.type === "rule" ? [a.text] : []));
  if (groups.length > 0 || filing.length > 0) {
    const rules = deps.rules();
    deps.setRules({
      ...rules,
      people: { ...rules.people, groups: [...rules.people.groups, ...groups] },
      filing: [...rules.filing, ...filing],
    });
    await deps.saveRules();
    lines.push(
      ...groups.map((name) => ({ text: `Added the People group ${name}` })),
      ...filing.map((text) => ({ text: `Added the rule “${text}”` })),
    );
  }
  for (const action of actions) {
    if (action.type !== "person") continue;
    try {
      const id = await deps.createNote(personBody(action));
      const rel = await deps.notePath(id);
      await deps.log({
        action: "create",
        noteId: rel,
        noteUlid: id,
        noteTitle: action.name,
        before: "",
        after: rel,
        model,
      });
      await deps.apply(personChanges(action), { id, title: action.name, model });
      lines.push({
        text: action.area ? `Added ${action.name} to ${action.area}` : `Added a note for ${action.name}`,
        noteId: id,
      });
    } catch (error) {
      lines.push({ text: `Couldn’t add ${action.name}: ${why(error)}`, failed: true });
    }
  }
  await deps.refresh();
  return lines;
}

/** The person said yes to changing someone's note: its tags and group only. */
export async function answerUpdate(
  action: Extract<VaultAction, { type: "update" }>,
  model: string,
  deps: Pick<KeepDeps, "apply"> = liveKeepDeps,
): Promise<number> {
  return deps.apply(personChanges(action), { id: action.noteId, title: action.name, model });
}
