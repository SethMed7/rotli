// rotli's Univer theme — clay primary + theme-aware neutrals, never the stock
// clinical blue. Lives under src/brand/ so the hex literals are legal
// (check:hex). Built from the frozen kit (tokens/colors.json) and shaped like
// @univerjs/themes' Theme so createUniver({ theme }) accepts it as-is.
//
// Charcoal (and other cool mono darks) must NOT paint warm cocoa chrome — that
// reads as a brown island inside the cool shell. Warm dark keeps cocoa.

import type { Theme } from "@univerjs/presets";
import { defaultTheme } from "@univerjs/presets";

/** Clay ramp — 500 is the signature accent; 700 is clay-text (AA on linen). */
const clay = {
  50: "#FBF0EB",
  100: "#F2D6C2", // peach
  200: "#E8BFA8",
  300: "#D9A088",
  400: "#D18F74",
  500: "#C97E62", // clay
  600: "#B56B50",
  700: "#8F4E37", // clay-text
  800: "#6F3C2A",
  900: "#4A281C",
} as const;

/** Warm gray ramp — linen → cocoa (warm light + warm dark themes). */
const warmGray = {
  50: "#F8F2E9", // linen
  100: "#F1E7D8", // surface-2
  200: "#E7DBC9", // border
  300: "#B7A593", // muted-on-dark
  400: "#6E6155", // muted-on-light
  500: "#3A3028", // cocoa
  600: "#392F28", // surface-2 dark
  700: "#2E2620", // surface dark
  800: "#241D18", // ground dark
  900: "#1A1512",
} as const;

/** Cool gray ramp — charcoal / paper mono (matches themes.css charcoal). */
const coolGray = {
  50: "#FAFAF9",
  100: "#F5F5F4",
  200: "#E7E5E4",
  300: "#A8A49C",
  400: "#78746C",
  500: "#3F3D3A",
  600: "#2A2825", // surface-2 charcoal
  700: "#1F1E1C", // surface charcoal
  800: "#161616", // ground charcoal
  900: "#0F0F0F",
} as const;

export type UniverNeutral = "warm" | "mono";

/** Pick the chrome family from the live app theme. */
export function univerNeutralForTheme(theme: string | undefined): UniverNeutral {
  if (!theme) return "warm";
  return theme === "light" || theme === "dark" ? "warm" : "mono";
}

/** The theme Univer's chrome (toolbar · selection · sheet tabs) paints with. */
export function rotliUniverTheme(neutral: UniverNeutral = "warm"): Theme {
  const resolvedGray = neutral === "mono" ? coolGray : warmGray;
  return {
    ...defaultTheme,
    white: resolvedGray[50],
    black: resolvedGray[500],
    // Paper/charcoal are deliberately monochrome. Keeping clay here made the
    // spreadsheet look like warm-dark chrome pasted into the charcoal app.
    primary: neutral === "mono" ? coolGray : clay,
    gray: resolvedGray,
  };
}

/**
 * Documents are conventional paper, not an app-environment canvas. Keep their
 * editor light in every Rotli environment and make the page literal white so
 * imported Word colors retain their expected contrast.
 */
export function documentUniverTheme(): Theme {
  return {
    ...rotliUniverTheme("mono"),
    white: "#FFFFFF",
    black: "#000000",
  };
}

/** Fixed document-canvas colors. The app environment may change around them,
 * but conventional Word paper and ink do not theme-invert. */
export const DOCUMENT_CANVAS_COLORS = {
  workspace: "#F7F7F7",
  paper: "#FFFFFF",
  border: "#C6C6C6",
  ink: "#000000",
  mutedInk: "#595959",
} as const;
