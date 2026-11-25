// The theme file: one small JSON object, versioned by `rotliTheme`.
//
//   { "rotliTheme": 1, "id": "forest-paper", "name": "Forest Paper",
//     "base": "grove", "contrast": "standard",
//     "seeds": { "light": { "page": "#f6f1e7", "accent": "#3f7d51" },
//                "dark":  { "page": "#101814", "accent": "#82be96" } } }
//
// Seeds are the truth; derived tokens are never stored, so nothing in a file
// can skip the gate. Reading never throws. Every colour is parsed to numbers
// and re-emitted from numbers, so a string from a file never reaches CSS as
// text. Unknown fields at any depth survive a save, and a file from a newer
// engine is usable but read-only. docs/decisions/2026-11-24-custom-theme-file.md
// records the decision.

import { normHex } from "./color";
import type { ModeSeeds } from "./derive";
import { type ContrastLevel, ENGINE_VERSION, type Mode, MODES, asContrastLevel } from "./policy";

/** A theme id, which is also its filename stem. */
export const THEME_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,47}$/;
/** A file over this is refused unread. */
export const MAX_THEME_FILE_BYTES = 64 * 1024;
export const MAX_THEME_NAME_CHARS = 48;
const BASE_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;

/** What a theme is, as the app holds it. A half the file did not give is
 * absent here and worked out at resolve time, never stamped into the file. */
export interface CustomTheme {
  id: string | null;
  name: string;
  /** The built-in family that supplies scenery and the fallback. The app
   * validates it against its own family list. */
  base: string | null;
  contrast: ContrastLevel;
  seeds: Partial<Record<Mode, ModeSeeds>>;
}

export type ThemeFileRead =
  | {
      ok: true;
      theme: CustomTheme;
      /** Written by a newer engine: usable from the seeds this build reads,
       * never overwritten here. */
      readOnly: boolean;
      /** The modes the file did not give, worked out from the other half. */
      derived: Mode[];
      problems: string[];
      /** The parsed object, kept so a save can carry unknown fields. */
      raw: Record<string, unknown>;
    }
  | { ok: false; problems: string[] };

type JsonObject = Record<string, unknown>;

const isObject = (value: unknown): value is JsonObject =>
  value !== null && typeof value === "object" && !Array.isArray(value);
/** An own property only: `__proto__` or `constructor` in a file is data. */
const own = (object: JsonObject, key: string): unknown =>
  Object.prototype.hasOwnProperty.call(object, key) ? object[key] : undefined;

// C0, DEL, and C1 controls
// oxlint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;

/** A display name: plain text, no control characters, at most 48 characters. */
export function cleanThemeName(value: unknown): string {
  if (typeof value !== "string") return "";
  return [...value.replace(CONTROL, "").trim()].slice(0, MAX_THEME_NAME_CHARS).join("").trim();
}

const NOT_A_THEME = "This isn't a theme file.";

function readHalf(value: unknown, label: string, problems: string[]): ModeSeeds | null {
  if (!isObject(value)) return null;
  const page = normHex(own(value, "page"));
  const accent = normHex(own(value, "accent"));
  if (!page || !accent) {
    problems.push(`${label} needs a page color and an accent, as #rrggbb.`);
    return null;
  }
  const seeds: ModeSeeds = { page, accent };
  const rawInk = own(value, "ink");
  const ink = normHex(rawInk);
  if (ink) seeds.ink = ink;
  else if (rawInk !== undefined) problems.push(`${label}'s ink color wasn't readable, so Rotli picked one.`);
  return seeds;
}

/** Read a theme file's parsed JSON. Never throws: an object whose properties
 * can't even be read (a throwing getter) is not a theme. */
export function readThemeFile(raw: unknown): ThemeFileRead {
  try {
    return readObject(raw);
  } catch {
    return { ok: false, problems: [NOT_A_THEME] };
  }
}

function readObject(raw: unknown): ThemeFileRead {
  if (!isObject(raw)) return { ok: false, problems: [NOT_A_THEME] };
  const version = own(raw, "rotliTheme");
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1)
    return { ok: false, problems: [NOT_A_THEME] };
  const problems: string[] = [];
  const seedsRaw = own(raw, "seeds");
  const seedsObject = isObject(seedsRaw) ? seedsRaw : {};
  const seeds: Partial<Record<Mode, ModeSeeds>> = {};
  const light = readHalf(own(seedsObject, "light"), "The day half", problems);
  const dark = readHalf(own(seedsObject, "dark"), "The night half", problems);
  if (light) seeds.light = light;
  if (dark) seeds.dark = dark;
  if (!light && !dark)
    return { ok: false, problems: problems.length ? problems : ["The theme has no colors."] };
  const id = own(raw, "id");
  const base = own(raw, "base");
  return {
    ok: true,
    readOnly: version > ENGINE_VERSION,
    derived: MODES.filter((mode) => !seeds[mode]),
    problems,
    raw,
    theme: {
      id: typeof id === "string" && THEME_ID_PATTERN.test(id) ? id : null,
      name: cleanThemeName(own(raw, "name")) || "Untitled theme",
      base: typeof base === "string" && BASE_PATTERN.test(base) ? base : null,
      contrast: asContrastLevel(own(raw, "contrast")),
      seeds,
    },
  };
}

/** Read a theme file's text: over 64 KB or not JSON is refused unread. */
export function parseThemeFileText(text: string): ThemeFileRead {
  if (byteLength(text) > MAX_THEME_FILE_BYTES)
    return { ok: false, problems: ["This file is too large to be a theme."] };
  let parsed: unknown;
  try {
    // an editor may have saved a byte-order mark; it is not part of the JSON
    parsed = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch {
    return { ok: false, problems: [NOT_A_THEME] };
  }
  return readThemeFile(parsed);
}

/** Whether a save may replace this file: never one Rotli could not read, and
 * never one a newer engine wrote. */
export function canOverwrite(previous: ThemeFileRead | null): boolean {
  return previous === null || (previous.ok && !previous.readOnly);
}

const byteLength = (text: string): number => new TextEncoder().encode(text).length;

/** A half's colours as numbers re-emitted, or null if one isn't a colour. */
function writeHalf(previous: unknown, seeds: ModeSeeds): JsonObject | null {
  const page = normHex(seeds.page);
  const accent = normHex(seeds.accent);
  if (!page || !accent) return null;
  const half: JsonObject = isObject(previous) ? { ...previous } : {};
  half.page = page;
  half.accent = accent;
  const ink = normHex(seeds.ink);
  if (ink) half.ink = ink;
  else delete half.ink;
  return half;
}

/** The file's text for a theme. Known fields are set at known paths on a copy
 * of the file's previous object, so unknown fields at every depth survive; an
 * id or base that isn't valid is dropped rather than carried over. A half the
 * theme doesn't give stays in the file as it was: the app never removes one.
 * The text is pretty-printed when that fits under the 64 KB cap and compact
 * when only that fits, so a saved file always reads back. Refuses (null)
 * where canOverwrite does, or when even the compact text is over the cap. */
export function serializeThemeFile(theme: CustomTheme, previous: ThemeFileRead | null = null): string | null {
  if (!canOverwrite(previous)) return null;
  const base: JsonObject = previous?.ok ? (JSON.parse(JSON.stringify(previous.raw)) as JsonObject) : {};
  const out: JsonObject = { ...base, rotliTheme: ENGINE_VERSION };
  if (theme.id && THEME_ID_PATTERN.test(theme.id)) out.id = theme.id;
  else if (!(typeof out.id === "string" && THEME_ID_PATTERN.test(out.id))) delete out.id;
  out.name = cleanThemeName(theme.name) || "Untitled theme";
  if (theme.base && BASE_PATTERN.test(theme.base)) out.base = theme.base;
  else if (!(typeof out.base === "string" && BASE_PATTERN.test(out.base))) delete out.base;
  out.contrast = asContrastLevel(theme.contrast);
  const previousSeeds = own(base, "seeds");
  const seeds: JsonObject = isObject(previousSeeds) ? { ...previousSeeds } : {};
  for (const mode of MODES) {
    const given = theme.seeds[mode];
    const half = given ? writeHalf(own(seeds, mode), given) : null;
    if (given && !half) return null;
    if (half) seeds[mode] = half;
  }
  out.seeds = seeds;
  return fitThemeText(out);
}

/** A theme object as file text that reads back: pretty-printed when that fits
 * under the cap, compact when only that fits, otherwise null. */
export function fitThemeText(value: Record<string, unknown>): string | null {
  const pretty = `${JSON.stringify(value, null, 2)}\n`;
  if (byteLength(pretty) <= MAX_THEME_FILE_BYTES) return pretty;
  const compact = `${JSON.stringify(value)}\n`;
  return byteLength(compact) <= MAX_THEME_FILE_BYTES ? compact : null;
}
