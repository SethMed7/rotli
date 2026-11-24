// Custom themes wired to this window: which store holds the files, painting
// the selected one, and the person's actions from Appearance. The Mac app
// keeps files beside its settings; a browser build keeps them in memory until
// reload.

import {
  THEME_SHEET_LINE,
  customThemeCss,
  installCustomThemeSheet,
  type CustomThemePaint,
} from "../brand/customThemeSheet";
import { accentVariants } from "../brand/themeEngine/accents";
import { appliedTokens } from "../brand/themeEngine/derive";
import { MODES } from "../brand/themeEngine/policy";
import { isTauri } from "../lib/tauri";
import {
  themeFileExport,
  themeFileRead,
  themeFileRemove,
  themeFileWrite,
  themeFilesList,
} from "../lib/themeFiles";
import { useCustomTheme } from "../state/customTheme";
import { CUSTOM_THEME_BOOT_KEY, applyTheme, setCustomThemeTarget } from "../state/theme";
import { THEME_FAMILIES, THEME_FAMILY_PRESENTATIONS, type ThemeFamily } from "../state/themeChoices";
import { useUiStore } from "../state/ui";
import { type CustomThemeSelection, movedColors, parseCustomThemeSelection, planApply } from "./model";
import type { ThemeFileStore } from "./ports";
import {
  type ImportChoice,
  type ImportResult,
  deleteTheme,
  exportText,
  importTheme,
  loadThemeEntries,
  renameTheme,
} from "./workflow";

const memory = new Map<string, string>();
const memoryStore: ThemeFileStore = {
  list: async () => [...memory.keys()].sort(),
  read: async (id) => memory.get(id) ?? null,
  write: async (id, text) => void memory.set(id, text),
  remove: async (id) => void memory.delete(id),
};
const macStore: ThemeFileStore = {
  list: themeFilesList,
  read: themeFileRead,
  write: themeFileWrite,
  remove: themeFileRemove,
};
const store = (): ThemeFileStore => (isTauri() ? macStore : memoryStore);

/** Whether themes outlast a reload here (only the Mac app keeps files). */
export const themesAreDurable = (): boolean => isTauri();

const familyLabel = (family: ThemeFamily): string =>
  THEME_FAMILY_PRESENTATIONS.find((p) => p.family === family)?.label ?? "Rotli";

let painted = 0;
/** Whether a custom theme is on the page now (painted, or primed from the
 * boot cache). Only then, or when one is about to be, does painting re-apply
 * the theme: otherwise the launch's first paint stays exactly as it was. */
let customOnPage = false;

/** Paint what the selection says: the custom theme's sheet and attributes,
 * or the base family with the reason. Always lands on a whole environment. */
export function paintCustomTheme(): void {
  const { selection, entries } = useCustomTheme.getState();
  const ui = useUiStore.getState();
  const plan = planApply(selection, entries, familyLabel(ui.themeFamily));
  const wasCustom = customOnPage;
  customOnPage = plan.kind === "custom";
  painted += 1;
  if (plan.kind === "custom") {
    const modes = {} as CustomThemePaint["modes"];
    for (const mode of MODES) {
      const tokens = appliedTokens(plan.resolved[mode].tokens);
      modes[mode] = {
        tokens,
        variants: accentVariants(mode, plan.resolved[mode].seeds, tokens, plan.theme.contrast, ui.accentHue),
      };
    }
    const css = customThemeCss({ modes });
    // the sheet first, then the attributes that select it
    installCustomThemeSheet(css);
    setCustomThemeTarget({ id: plan.id, rev: painted, css, remembered: themesAreDurable() });
    useCustomTheme.setState({
      notice: null,
      moved: movedColors(plan.resolved),
      readOnly: plan.readOnly,
      rev: painted,
    });
  } else {
    setCustomThemeTarget(null);
    installCustomThemeSheet(null);
    useCustomTheme.setState({ notice: plan.notice, moved: [], readOnly: false, rev: painted });
  }
  if (wasCustom || customOnPage) applyTheme(ui.theme, ui.themeFamily);
}

async function refresh(): Promise<void> {
  const entries = await loadThemeEntries(store()).catch(() => []);
  useCustomTheme.setState({ entries });
}

let attached = false;
let hueTimer: ReturnType<typeof setTimeout> | undefined;

/** Read this Mac's themes and paint the selection. Awaited before the first
 * render; then a Custom hue change re-solves the theme's accents (debounced,
 * since each is a full derivation). */
export async function hydrateCustomTheme(): Promise<void> {
  useCustomTheme.setState({ durable: themesAreDurable() });
  await refresh();
  paintCustomTheme();
  if (attached) return;
  attached = true;
  useUiStore.subscribe((state, previous) => {
    if (!isCustomThemeShown()) return;
    if (state.accentHue !== previous.accentHue) {
      clearTimeout(hueTimer);
      hueTimer = setTimeout(paintCustomTheme, 120);
    }
  });
}

const isCustomThemeShown = (): boolean => {
  const { selection, notice } = useCustomTheme.getState();
  return selection !== null && notice === null;
};

/** Use a theme. Its base becomes the family, which supplies scenery and is
 * what an older Rotli shows. */
export function selectCustomTheme(id: string): void {
  const entry = useCustomTheme.getState().entries.find((candidate) => candidate.id === id);
  if (!entry?.read.ok) return;
  const base = entry.read.theme.base;
  if (base && (THEME_FAMILIES as readonly string[]).includes(base))
    useUiStore.getState().setThemeFamily(base as ThemeFamily);
  useCustomTheme.setState({ selection: { id, name: entry.read.theme.name, source: "mac" } });
  paintCustomTheme();
}

/** Back to the built-in family. */
export function clearCustomTheme(): void {
  if (!useCustomTheme.getState().selection) return;
  useCustomTheme.setState({ selection: null });
  paintCustomTheme();
}

/** Pick a built-in family: that is leaving any custom theme. */
export function pickThemeFamily(family: ThemeFamily): void {
  useCustomTheme.setState({ selection: null });
  useUiStore.getState().setThemeFamily(family);
  paintCustomTheme();
}

export async function importCustomTheme(text: string, choice?: ImportChoice): Promise<ImportResult> {
  const result = await importTheme(store(), text, useCustomTheme.getState().entries, choice);
  if (result.status === "saved") {
    await refresh();
    selectCustomTheme(result.id);
  }
  return result;
}

export async function renameCustomTheme(id: string, name: string): Promise<string | null> {
  const entry = useCustomTheme.getState().entries.find((candidate) => candidate.id === id);
  if (!entry) return "That theme isn't on this Mac any more.";
  const result = await renameTheme(store(), entry, name);
  if (!result.ok) return result.problem;
  await refresh();
  const { selection, entries } = useCustomTheme.getState();
  const renamed = entries.find((candidate) => candidate.id === id);
  if (selection?.id === id && renamed?.read.ok)
    useCustomTheme.setState({ selection: { ...selection, name: renamed.read.theme.name } });
  return null;
}

export async function deleteCustomTheme(id: string): Promise<void> {
  await deleteTheme(store(), id);
  if (useCustomTheme.getState().selection?.id === id) useCustomTheme.setState({ selection: null });
  await refresh();
  paintCustomTheme();
}

/** Save a copy where the person chooses: the macOS save panel in the app, a
 * download in a browser. */
export async function exportCustomTheme(id: string, name: string): Promise<"saved" | "cancelled" | "failed"> {
  try {
    if (isTauri()) return (await themeFileExport(id, name)) ? "saved" : "cancelled";
    const text = await exportText(store(), id);
    if (text === null) return "failed";
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${name.replace(/[/\\:]/g, "") || "Theme"}.rotli-theme.json`;
    link.click();
    URL.revokeObjectURL(url);
    return "saved";
  } catch {
    return "failed";
  }
}

/** What the main window broadcasts so other windows follow: the selection
 * and what was painted. */
export function customThemeBroadcast(): string {
  const { selection, rev } = useCustomTheme.getState();
  return JSON.stringify({ selection, rev });
}

let lastHeard = "";

/** Another window: follow main's custom theme, reading the file here. */
export async function applyCustomThemeBroadcast(payload: string | undefined): Promise<void> {
  if (payload === undefined || payload === lastHeard) return;
  lastHeard = payload;
  let selection: CustomThemeSelection | null = null;
  try {
    selection = parseCustomThemeSelection((JSON.parse(payload) as { selection?: unknown }).selection);
  } catch {
    return;
  }
  useCustomTheme.setState({ selection });
  await refresh();
  paintCustomTheme();
}

/** At launch, before the theme file is read: keep painting what the boot
 * script painted from last launch's sheet, so the window doesn't flash to the
 * base family and back. The file then replaces it, or the base applies. */
export function primeCustomThemeFromBoot(selection: CustomThemeSelection | null): void {
  if (!selection || typeof window === "undefined") return;
  try {
    const cache: unknown = JSON.parse(window.localStorage.getItem(CUSTOM_THEME_BOOT_KEY) ?? "null");
    if (!cache || typeof cache !== "object") return;
    const { id, css } = cache as { id?: unknown; css?: unknown };
    if (id !== selection.id || typeof css !== "string" || !css) return;
    if (!css.split("\n").every((line) => THEME_SHEET_LINE.test(line))) return;
    setCustomThemeTarget({ id, rev: 0, css, remembered: true });
    customOnPage = true;
  } catch {
    // no cache: the base family paints until the file is read
  }
}
