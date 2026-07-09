// rotli's Univer theme — clay primary + warm cocoa grays, never the stock
// clinical blue. Lives under src/brand/ so the hex literals are legal
// (check:hex). Built from the frozen kit (tokens/colors.json) and shaped like
// @univerjs/themes' Theme so createUniver({ theme }) accepts it as-is.

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

/** Warm gray ramp — linen → cocoa, never cool slate. Dark mode paints from
 * the high end (800/900 = cocoa ground). */
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

/** The theme Univer's chrome (toolbar · selection · sheet tabs) paints with. */
export const rotliUniverTheme: Theme = {
  ...defaultTheme,
  white: "#F8F2E9",
  black: "#3A3028",
  primary: clay,
  gray: warmGray,
};
