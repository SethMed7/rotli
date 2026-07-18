/** PDF-only palettes for Breve output. These are brand definitions, not app
 * surface tokens: the renderer consumes the same values outside the webview. */
export const BREVE_PDF_PRESETS = {
  charcoal: {
    background: "#161616",
    surface: "#1f1e1c",
    text: "#e9e7e2",
    muted: "#a8a49c",
    accent: "#d9a868",
    rule: "#2e2c29",
  },
  warmLight: {
    background: "#f8f2e9",
    surface: "#ffffff",
    text: "#3a3028",
    muted: "#6e6155",
    accent: "#8f4e37",
    rule: "#e7dbc9",
  },
  warmDark: {
    background: "#241d18",
    surface: "#2e2620",
    text: "#f1e7da",
    muted: "#b7a593",
    accent: "#c97e62",
    rule: "#3d3229",
  },
  paper: {
    background: "#fafaf9",
    surface: "#ffffff",
    text: "#161616",
    muted: "#6b6b68",
    accent: "#8f4e37",
    rule: "#e6e6e3",
  },
} as const;

export const DEFAULT_BREVE_PDF_THEME = {
  preset: "charcoal" as const,
  custom: { ...BREVE_PDF_PRESETS.charcoal },
};

export type BrevePdfPaletteLike = {
  background: string;
  surface: string;
  text: string;
  muted: string;
  accent: string;
  rule: string;
};

function colorLuminance(value: string): number {
  const channels = value
    .slice(1)
    .match(/.{2}/g)
    ?.map((channel) => Number.parseInt(channel, 16) / 255) ?? [0, 0, 0];
  const linear = channels.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * (linear[0] ?? 0) + 0.7152 * (linear[1] ?? 0) + 0.0722 * (linear[2] ?? 0);
}

export function contrastRatio(a: string, b: string): number {
  const light = Math.max(colorLuminance(a), colorLuminance(b));
  const dark = Math.min(colorLuminance(a), colorLuminance(b));
  return (light + 0.05) / (dark + 0.05);
}

/** One shared accessibility gate for presets and custom PDF palettes. */
export function validateBrevePdfPalette(palette: BrevePdfPaletteLike): string {
  if (contrastRatio(palette.text, palette.background) < 4.5)
    return "Text needs more contrast against the PDF page.";
  if (contrastRatio(palette.muted, palette.background) < 4.5)
    return "Secondary text needs more contrast against the PDF page.";
  if (contrastRatio(palette.accent, palette.background) < 3)
    return "The accent needs more contrast against the PDF page.";
  return "";
}
