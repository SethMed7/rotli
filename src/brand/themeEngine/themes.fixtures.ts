// Synthetic theme files for tests outside src/brand (where hex can't appear).

export const FOREST_PAPER = {
  rotliTheme: 1,
  id: "forest-paper",
  name: "Forest Paper",
  base: "grove",
  contrast: "standard",
  seeds: {
    light: { page: "#f6f1e7", accent: "#3f7d51" },
    dark: { page: "#101814", accent: "#82be96" },
  },
};

/** Out of every band on purpose: Rotli moves its colours and it still applies. */
export const NEON = {
  rotliTheme: 1,
  id: "neon",
  name: "Neon",
  seeds: {
    light: { page: "#ff5cf4", accent: "#f9ff3c" },
    dark: { page: "#3a00ff", accent: "#220044" },
  },
};

/** From a newer engine, with a field this build doesn't know. */
export const FROM_THE_FUTURE = {
  rotliTheme: 2,
  id: "tomorrow",
  name: "Tomorrow",
  gradients: [{ from: "#000000", to: "#ffffff" }],
  seeds: { light: { page: "#eef2f7", accent: "#2f6fae" } },
};

/** Both halves unreadable: not a usable theme. */
export const NO_COLORS = { rotliTheme: 1, id: "empty", seeds: { light: { page: "red" }, dark: 7 } };

export const themeText = (theme: object): string => `${JSON.stringify(theme, null, 2)}\n`;
