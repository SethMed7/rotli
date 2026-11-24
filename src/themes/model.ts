// Custom themes as the app holds them: what is listed, what is selected, and
// what applies. Pure; the colour contract is src/brand/themeEngine.

import { over } from "../brand/themeEngine/color";
import type { SeedNote, TokenSet } from "../brand/themeEngine/derive";
import { ALPHA } from "../brand/themeEngine/policy";
import { MODES } from "../brand/themeEngine/policy";
import { type ResolvedTheme, resolveSeeds } from "../brand/themeEngine/resolve";
import {
  type CustomTheme,
  THEME_ID_PATTERN,
  type ThemeFileRead,
  cleanThemeName,
  parseThemeFileText,
} from "../brand/themeEngine/themeFile";

/** One personal theme file. Its filename stem is its id; an `id` inside the
 * file that disagrees is ignored. */
export interface ThemeEntry {
  id: string;
  read: ThemeFileRead;
}

/** The `customTheme` app setting: which theme, and its name for the message
 * shown when the file is gone. `themeFamily` keeps the theme's base, so an
 * older Rotli shows the base and carries this key through untouched. */
export interface CustomThemeSelection {
  id: string;
  name: string;
  source: "mac";
}

export function parseCustomThemeSelection(value: unknown): CustomThemeSelection | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const { id, name, source } = value as Record<string, unknown>;
  if (typeof id !== "string" || !THEME_ID_PATTERN.test(id) || source !== "mac") return null;
  return { id, name: cleanThemeName(name) || id, source: "mac" };
}

/** A new theme's id from its name: lowercase words joined by hyphens, made
 * unique among `taken` with -2, -3… */
export function themeIdFor(name: string, taken: ReadonlySet<string>): string {
  const slug =
    name
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40)
      .replace(/-+$/, "") || "theme";
  if (!taken.has(slug)) return slug;
  for (let n = 2; ; n++) if (!taken.has(`${slug}-${n}`)) return `${slug}-${n}`;
}

export type ApplyPlan =
  | { kind: "custom"; id: string; theme: CustomTheme; resolved: ResolvedTheme; readOnly: boolean }
  | { kind: "base"; notice: string | null };

/** What applies for a selection: the custom theme when its file reads and
 * passes the gate, otherwise the base family with a reason. The app always
 * lands on a complete environment. */
export function planApply(
  selection: CustomThemeSelection | null,
  entries: readonly ThemeEntry[],
  baseLabel: string,
  resolve: typeof resolveSeeds = resolveSeeds,
): ApplyPlan {
  if (!selection) return { kind: "base", notice: null };
  const entry = entries.find((candidate) => candidate.id === selection.id);
  if (!entry) return { kind: "base", notice: `${selection.name} isn't on this Mac. Showing ${baseLabel}.` };
  if (!entry.read.ok)
    return { kind: "base", notice: `Couldn't read ${entry.id}.json. Showing ${baseLabel}.` };
  const { theme } = entry.read;
  const resolved = resolve(theme.seeds, theme.contrast);
  if (!resolved?.ok)
    return {
      kind: "base",
      notice: `${theme.name} didn't pass Rotli's readability check. Showing ${baseLabel}.`,
    };
  return {
    kind: "custom",
    id: entry.id,
    theme: { ...theme, id: entry.id },
    resolved,
    readOnly: entry.read.readOnly,
  };
}

/** The colours Rotli moved to keep a theme readable, day then night. */
export const movedColors = (resolved: ResolvedTheme): (SeedNote & { mode: "light" | "dark" })[] =>
  MODES.flatMap((mode) => resolved[mode].notes.map((note) => ({ ...note, mode })));

export type ImportPlan =
  | { ok: false; problem: string }
  | { ok: true; text: string; theme: CustomTheme; id: string; existing: ThemeEntry | null };

/** Check a file someone is importing. It is copied as written, so a newer
 * theme's own fields survive; it only has to read and pass the gate here. */
export function planImport(text: string, entries: readonly ThemeEntry[]): ImportPlan {
  const read = parseThemeFileText(text);
  if (!read.ok) return { ok: false, problem: read.problems[0] ?? "This isn't a theme file." };
  if (!resolveSeeds(read.theme.seeds, read.theme.contrast)?.ok)
    return { ok: false, problem: "That theme didn't come out readable, so Rotli didn't add it." };
  const taken = new Set(entries.map((entry) => entry.id));
  const id = read.theme.id ?? themeIdFor(read.theme.name, taken);
  return {
    ok: true,
    text,
    theme: read.theme,
    id,
    existing: entries.find((entry) => entry.id === id) ?? null,
  };
}

/** "Keep both": the imported theme takes the next free id. */
export const keepBothId = (
  plan: { theme: CustomTheme; id: string },
  entries: readonly ThemeEntry[],
): string =>
  themeIdFor(
    plan.theme.name === "Untitled theme" ? plan.id : plan.theme.name,
    new Set(entries.map((e) => e.id)),
  );

/** A theme's colours as the Appearance thumbnails' roles: sidebar, page,
 * card, ink, and the current row's wash. */
export function previewRoles(tokens: TokenSet): Record<string, string> {
  const sidebar = tokens["--surface-2"] ?? "";
  return {
    "--preview-ground": tokens["--ground"] ?? "",
    "--preview-sidebar": sidebar,
    "--preview-surface": tokens["--surface"] ?? "",
    "--preview-text": tokens["--text"] ?? "",
    "--preview-muted": tokens["--text-muted"] ?? "",
    "--preview-border": tokens["--border"] ?? "",
    "--preview-selected": over(tokens["--accent"] ?? sidebar, ALPHA.selectedHover, sidebar),
  };
}
