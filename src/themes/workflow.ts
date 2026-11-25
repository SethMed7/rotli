// The personal-theme use cases over a ThemeFileStore.

import {
  canOverwrite,
  fitThemeText,
  parseThemeFileText,
  serializeThemeFile,
} from "../brand/themeEngine/themeFile";
import { type ImportPlan, type ThemeEntry, keepBothId, planImport } from "./model";
import type { ThemeFileStore } from "./ports";

/** Every theme file, read. One that can't be read is listed as such, never
 * dropped, rewritten or deleted. */
export async function loadThemeEntries(store: ThemeFileStore): Promise<ThemeEntry[]> {
  const ids = await store.list();
  return Promise.all(
    ids.map(async (id): Promise<ThemeEntry> => {
      try {
        const text = await store.read(id);
        if (text === null) return { id, read: { ok: false, problems: ["The file is gone."] } };
        return { id, read: parseThemeFileText(text) };
      } catch (error) {
        return { id, read: { ok: false, problems: [String(error)] } };
      }
    }),
  );
}

export type ImportChoice = "replace" | "keep-both";
export type ImportResult =
  | { status: "saved"; id: string; name: string }
  | { status: "exists"; plan: Extract<ImportPlan, { ok: true }> }
  | { status: "refused"; problem: string };

/** Import a theme file's text. An id that is already here asks first
 * (`choice` absent), then replaces it or keeps both. A file Rotli couldn't
 * read is never replaced. */
export async function importTheme(
  store: ThemeFileStore,
  text: string,
  entries: readonly ThemeEntry[],
  choice?: ImportChoice,
): Promise<ImportResult> {
  const plan = planImport(text, entries);
  if (!plan.ok) return { status: "refused", problem: plan.problem };
  if (plan.existing && !choice) return { status: "exists", plan };
  if (plan.existing && choice === "replace" && !plan.existing.read.ok)
    return {
      status: "refused",
      problem: `Rotli couldn't read the ${plan.id} that's there, so it left it alone.`,
    };
  const id = plan.existing && choice === "keep-both" ? keepBothId(plan, entries) : plan.id;
  // the file's own id must be its filename stem, so a copy names itself
  const written = plan.theme.id === id ? text : withId(text, id);
  if (written === null) return { status: "refused", problem: "This file is too large to be a theme." };
  await store.write(id, written);
  return { status: "saved", id, name: plan.theme.name };
}

/** Rename a theme in its file; the id and filename stay. Unknown fields stay
 * too. A theme from a newer Rotli is read-only here. */
export async function renameTheme(
  store: ThemeFileStore,
  entry: ThemeEntry,
  name: string,
): Promise<{ ok: true } | { ok: false; problem: string }> {
  if (!entry.read.ok) return { ok: false, problem: "Rotli couldn't read this theme, so it can't rename it." };
  if (!canOverwrite(entry.read))
    return { ok: false, problem: "This theme was made by a newer Rotli; it's read-only here." };
  const text = serializeThemeFile({ ...entry.read.theme, id: entry.id, name }, entry.read);
  if (text === null) return { ok: false, problem: "That won't fit: the theme file would go over 64 KB." };
  await store.write(entry.id, text);
  return { ok: true };
}

export const deleteTheme = (store: ThemeFileStore, id: string): Promise<void> => store.remove(id);

/** The text of a theme to export: the file as it is, if it reads. */
export async function exportText(store: ThemeFileStore, id: string): Promise<string | null> {
  const text = await store.read(id);
  return text !== null && parseThemeFileText(text).ok ? text : null;
}

/** The same file with its `id` set: every other field kept as written. */
function withId(text: string, id: string): string | null {
  const parsed: unknown = JSON.parse(text.replace(/^\uFEFF/, ""));
  return fitThemeText({ ...(parsed as Record<string, unknown>), id });
}
