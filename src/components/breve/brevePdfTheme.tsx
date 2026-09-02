// Breve → Settings → PDF appearance: the preset picker, the custom palette
// editor, and the live preview. "Match Rotli" (the default since 2026-09-02)
// previews the document's own theme tokens — the same six values the main
// window syncs to the renderer. Split out of breveSurface.tsx (audit
// 2026-09-02; the surface file's size is a ratchet).

import { useMemo } from "react";
import type { CSSProperties } from "react";

import { BREVE_PDF_PRESETS, validateBrevePdfPalette } from "../../brand/brevePdfThemes";
import { readDocumentPdfPalette } from "../../brand/pdfPalette";
import type { BrevePdfPalette, BrevePdfTheme, BrevePdfThemePreset } from "../../routines/breveTypes";
import { useDataTheme } from "../../state/theme";

const PDF_THEME_OPTIONS: Array<{
  value: BrevePdfThemePreset;
  label: string;
  detail: string;
}> = [
  {
    value: "rotli",
    label: "Match Rotli",
    detail: "Follows your Rotli theme — every family, light or dark — as you change it",
  },
  {
    value: "charcoal",
    label: "Charcoal",
    detail: "Breve’s original dark editorial palette",
  },
  {
    value: "warmLight",
    label: "Warm Light",
    detail: "Rotli linen, cocoa, and clay",
  },
  {
    value: "warmDark",
    label: "Warm Dark",
    detail: "Rotli cocoa with clay accents",
  },
  {
    value: "paper",
    label: "Paper",
    detail: "Neutral white with crisp dark type",
  },
  { value: "custom", label: "Custom", detail: "Choose every PDF color" },
];

const PDF_COLOR_FIELDS: Array<{ key: keyof BrevePdfPalette; label: string }> = [
  { key: "background", label: "Page" },
  { key: "surface", label: "Panels" },
  { key: "text", label: "Text" },
  { key: "muted", label: "Secondary text" },
  { key: "accent", label: "Accent and links" },
  { key: "rule", label: "Rules" },
];

/** `live` is the document's current palette (what the main window syncs to
 * the renderer) — the truth for "Match Rotli"; the last synced palette stands
 * in when the DOM cannot be read, and Warm Light is the renderer's fallback. */
function resolvedPdfPalette(theme: BrevePdfTheme, live: BrevePdfPalette | null): BrevePdfPalette {
  if (theme.preset === "custom") return theme.custom;
  if (theme.preset === "rotli") return live ?? theme.resolved ?? { ...BREVE_PDF_PRESETS.warmLight };
  return { ...BREVE_PDF_PRESETS[theme.preset] };
}

export function pdfThemeValidation(theme: BrevePdfTheme): string {
  return validateBrevePdfPalette(resolvedPdfPalette(theme, readDocumentPdfPalette()));
}

export function PdfThemeEditor({
  theme,
  onChange,
}: {
  theme: BrevePdfTheme;
  onChange: (theme: BrevePdfTheme) => void;
}) {
  // "Match Rotli" previews the live tokens, so the preview must follow a
  // theme switch made while this page is open: re-read the document's
  // palette for the applied theme.
  const dataTheme = useDataTheme();
  const live = useMemo(() => readDocumentPdfPalette(dataTheme), [dataTheme]);
  const palette = resolvedPdfPalette(theme, live);
  const validation = validateBrevePdfPalette(palette);
  const style = {
    "--pdf-preview-bg": palette.background,
    "--pdf-preview-surface": palette.surface,
    "--pdf-preview-text": palette.text,
    "--pdf-preview-muted": palette.muted,
    "--pdf-preview-accent": palette.accent,
    "--pdf-preview-rule": palette.rule,
  } as CSSProperties;
  return (
    <section className="breve-delivery-section breve-pdf-section" aria-labelledby="breve-pdf-theme-title">
      <div className="breve-delivery-head">
        <div>
          <h3 id="breve-pdf-theme-title">PDF appearance</h3>
          <p>New scheduled and on-demand PDFs use this palette. Existing files keep their original colors.</p>
        </div>
      </div>
      <div className="breve-pdf-layout">
        <div className="breve-pdf-controls">
          <label className="breve-field" htmlFor="breve-pdf-theme">
            <span>Theme</span>
            <select
              id="breve-pdf-theme"
              value={theme.preset}
              aria-describedby="breve-pdf-theme-help"
              onChange={(event) =>
                onChange({
                  ...theme,
                  preset: event.target.value as BrevePdfThemePreset,
                })
              }
            >
              {PDF_THEME_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <small id="breve-pdf-theme-help">
              {PDF_THEME_OPTIONS.find((option) => option.value === theme.preset)?.detail}
            </small>
          </label>
          {theme.preset === "custom" && (
            <div className="breve-color-grid" aria-label="Custom PDF colors">
              {PDF_COLOR_FIELDS.map(({ key, label }) => (
                <label key={key} className="breve-color-field">
                  <span>{label}</span>
                  <span className="breve-color-control">
                    <input
                      type="color"
                      value={theme.custom[key]}
                      aria-label={`${label} color`}
                      onChange={(event) =>
                        onChange({
                          ...theme,
                          custom: {
                            ...theme.custom,
                            [key]: event.target.value,
                          },
                        })
                      }
                    />
                    <code>{theme.custom[key].toUpperCase()}</code>
                  </span>
                </label>
              ))}
            </div>
          )}
          {validation && (
            <p id="breve-pdf-theme-error" className="breve-field-error" role="alert">
              {validation}
            </p>
          )}
        </div>
        <div
          className="breve-pdf-preview"
          style={style}
          aria-label={`${PDF_THEME_OPTIONS.find((option) => option.value === theme.preset)?.label} PDF preview`}
        >
          <span className="breve-pdf-preview-kicker">Your personal wire</span>
          <strong>BREVE</strong>
          <span className="breve-pdf-preview-date">Morning · Friday</span>
          <div>
            <b>Today’s signal</b>
            <p>A quiet preview of headings, reading text, links, and section rules.</p>
            <span className="breve-pdf-preview-link">Read source</span>
          </div>
        </div>
      </div>
    </section>
  );
}
