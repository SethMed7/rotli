import { PDF_THEME_PRESETS, resolvePdfTheme } from "../scripts/pdf-theme";
import { BREVE_PDF_PRESETS } from "../../src/brand/brevePdfThemes";

let failed = 0;
const check = (condition: boolean, message: string) => {
  if (condition) return;
  failed += 1;
  console.error(`FAIL ${message}`);
};

// The default follows the app theme (2026-09-02). Before the app has synced
// its palette the renderer stands in with Rotli's own default appearance —
// never Charcoal, which is not what a Warm/Ocean/Grove user chose.
check(resolvePdfTheme({}).preset === "rotli", "missing settings follow the Rotli theme");
check(
  resolvePdfTheme({}).palette.background === PDF_THEME_PRESETS.warmLight.background,
  "unsynced Rotli preset renders Warm Light",
);
const resolved = {
  background: "#0e171d", surface: "#152229", text: "#e7f0f4",
  muted: "#a1b6c0", accent: "#86c2e0", rule: "#263a43",
};
check(
  JSON.stringify(resolvePdfTheme({ pdfTheme: { preset: "rotli", resolved } }).palette) === JSON.stringify(resolved),
  "the synced app palette is rendered verbatim",
);
check(
  resolvePdfTheme({ pdfTheme: { preset: "rotli", resolved: { ...resolved, accent: "oklch(78% 0.13 210)" } } })
    .palette.background === PDF_THEME_PRESETS.warmLight.background,
  "a palette with any invalid channel falls back whole — never a mixed palette",
);
check(
  JSON.stringify(PDF_THEME_PRESETS) === JSON.stringify(BREVE_PDF_PRESETS),
  "Rotli's picker and the PDF renderer keep the same preset colors",
);
check(
  resolvePdfTheme({ pdfTheme: { preset: "warmLight" } }).palette.background === PDF_THEME_PRESETS.warmLight.background,
  "preset settings resolve the matching palette",
);
check(
  resolvePdfTheme({ pdfTheme: { preset: "charcoal", resolved } }).palette.background === PDF_THEME_PRESETS.charcoal.background,
  "an explicit preset ignores the synced app palette",
);

const custom = resolvePdfTheme({
  pdfTheme: {
    preset: "custom",
    custom: {
      background: "#102030",
      surface: "invalid",
      text: "#f0f0f0",
      muted: "#b0b0b0",
      accent: "#70a0c0",
      rule: "#304050",
    },
  },
});
check(custom.palette.background === "#102030", "valid custom colors survive");
check(custom.palette.surface === PDF_THEME_PRESETS.charcoal.surface, "invalid custom colors fall back safely");

if (failed) process.exit(1);
console.log("OK pdf theme resolution");
