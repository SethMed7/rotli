import { PDF_THEME_PRESETS, resolvePdfTheme } from "../scripts/pdf-theme";
import { BREVE_PDF_PRESETS } from "../../src/brand/brevePdfThemes";

let failed = 0;
const check = (condition: boolean, message: string) => {
  if (condition) return;
  failed += 1;
  console.error(`FAIL ${message}`);
};

check(resolvePdfTheme({}).preset === "charcoal", "missing settings use Charcoal");
check(
  JSON.stringify(PDF_THEME_PRESETS) === JSON.stringify(BREVE_PDF_PRESETS),
  "Rotli's picker and the PDF renderer keep the same preset colors",
);
check(
  resolvePdfTheme({ pdfTheme: { preset: "warmLight" } }).palette.background === PDF_THEME_PRESETS.warmLight.background,
  "preset settings resolve the matching palette",
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
