import { readFileSync } from "node:fs";
import { CONFIG_PATH } from "./config-path";

export type PdfPalette = {
  background: string;
  surface: string;
  text: string;
  muted: string;
  accent: string;
  rule: string;
};

/** `rotli` = the user's live Rotli theme, written into `pdfTheme.resolved` by
 * the app on every appearance change. It is the default since 2026-09-02. */
export type PdfThemePreset = "rotli" | "charcoal" | "warmLight" | "warmDark" | "paper" | "custom";

export const PDF_THEME_PRESETS: Record<Exclude<PdfThemePreset, "custom" | "rotli">, PdfPalette> = {
  charcoal: {
    background: "#161616", surface: "#1f1e1c", text: "#e9e7e2",
    muted: "#a8a49c", accent: "#d9a868", rule: "#2e2c29",
  },
  warmLight: {
    background: "#f8f2e9", surface: "#ffffff", text: "#3a3028",
    muted: "#6e6155", accent: "#8f4e37", rule: "#e7dbc9",
  },
  warmDark: {
    background: "#241d18", surface: "#2e2620", text: "#f1e7da",
    muted: "#b7a593", accent: "#c97e62", rule: "#3d3229",
  },
  paper: {
    background: "#fafaf9", surface: "#ffffff", text: "#161616",
    muted: "#6b6b68", accent: "#8f4e37", rule: "#e6e6e3",
  },
};

const isColor = (value: unknown): value is string =>
  typeof value === "string" && /^#[\da-f]{6}$/i.test(value);

type PdfThemeSettings = {
  pdfTheme?: {
    preset?: PdfThemePreset;
    custom?: Partial<PdfPalette>;
    /** The app theme's six tokens, last written by Rotli's main window. */
    resolved?: Partial<PdfPalette>;
  };
};

const PALETTE_KEYS = ["background", "surface", "text", "muted", "accent", "rule"] as const;

/** Every field valid, or nothing — a half-written palette never mixes with a
 * fallback and produces unreadable contrast. */
function completePalette(candidate: Partial<PdfPalette> | undefined): PdfPalette | null {
  if (!candidate) return null;
  const out: Partial<PdfPalette> = {};
  for (const key of PALETTE_KEYS) {
    const value = candidate[key];
    if (!isColor(value)) return null;
    out[key] = value;
  }
  return out as PdfPalette;
}

export function resolvePdfTheme(raw: PdfThemeSettings): { preset: PdfThemePreset; palette: PdfPalette } {
  const preset = raw.pdfTheme?.preset ?? "rotli";
  if (preset === "rotli") {
    // Until the app has synced its theme once (or if it never runs beside the
    // runtime), Rotli's own default appearance is the honest stand-in.
    return { preset, palette: completePalette(raw.pdfTheme?.resolved) ?? PDF_THEME_PRESETS.warmLight };
  }
  if (preset !== "custom" && preset in PDF_THEME_PRESETS) {
    return { preset, palette: PDF_THEME_PRESETS[preset as Exclude<PdfThemePreset, "custom" | "rotli">] };
  }
  const fallback = PDF_THEME_PRESETS.charcoal;
  const custom = raw.pdfTheme?.custom ?? {};
  return {
    preset: "custom",
    palette: {
      background: isColor(custom.background) ? custom.background : fallback.background,
      surface: isColor(custom.surface) ? custom.surface : fallback.surface,
      text: isColor(custom.text) ? custom.text : fallback.text,
      muted: isColor(custom.muted) ? custom.muted : fallback.muted,
      accent: isColor(custom.accent) ? custom.accent : fallback.accent,
      rule: isColor(custom.rule) ? custom.rule : fallback.rule,
    },
  };
}

export function readPdfTheme(): { preset: PdfThemePreset; palette: PdfPalette } {
  let raw: PdfThemeSettings = {};
  try {
    raw = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    // No routine config yet: render with Rotli's default appearance.
  }
  return resolvePdfTheme(raw);
}

export function pdfThemeVariables(palette: PdfPalette): string {
  return `--bg:${palette.background};--surface:${palette.surface};--ink:${palette.text};--muted:${palette.muted};--accent:${palette.accent};--rule:${palette.rule};`;
}
