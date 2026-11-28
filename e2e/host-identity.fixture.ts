// A synthetic host for host-identity.spec.ts and the review captures. It is
// the page's entry in place of main.tsx, as a host build's own entry is: its
// name, a starting theme family, no quokka and a mark of its own. Nothing here
// names a real product.

import { createElement as h } from "react";

import { registerHost } from "../src/host/registry";
import { syntheticFirstRun } from "./host-first-run.fixture";

// A real host's registration module imports its panes, and they import
// Rotli's components and stores before it registers; none of them may read the
// host's name as it loads, or registering would throw (check:product-name
// keeps it so). Then the app's entry, as a host's own entry imports it. By URL,
// so the e2e typecheck doesn't compile the app.
const ROTLI_MODULES = [
  "/src/components/settingsSurface.tsx",
  "/src/components/chat/chatSurface.tsx",
  "/src/components/onboarding/onboarding.tsx",
  "/src/state/main.ts",
  "/src/state/views.ts",
];
for (const module of ROTLI_MODULES) await import(/* @vite-ignore */ module);

/** A plain ring: the host's mark, nothing like a quokka. */
const ExampleMark = ({ size = 16 }: { size?: number }) =>
  h(
    "svg",
    { width: size, height: size, viewBox: "0 0 16 16", "data-host-mark": "", "aria-hidden": "true" },
    h("circle", { cx: 8, cy: 8, r: 6, fill: "none", stroke: "currentColor", strokeWidth: 2 }),
  );

const params = new URLSearchParams(location.search);
registerHost({
  words: { productName: "Example Host", aboutLabel: "About Example Host" },
  themeFamily: "ocean",
  mascot: "none",
  productMark: ExampleMark,
  aboutGlyph: ExampleMark,
  // `?plain` adds the host's own first run (host-first-run.fixture.ts)
  ...(params.has("plain") ? { firstRun: syntheticFirstRun(params) } : {}),
});

const APP_ENTRY = "/src/main.tsx";
await import(/* @vite-ignore */ APP_ENTRY);
