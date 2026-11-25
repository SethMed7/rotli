import { afterEach, beforeEach, expect, test } from "bun:test";

import { resolveSeeds } from "../brand/themeEngine/resolve";
import { FOREST_PAPER, NEON, themeText } from "../brand/themeEngine/themes.fixtures";
import { useAppearanceLook } from "../state/appearanceLook";
import { appExtrasSnapshot } from "../state/appExtras";
import { useCustomTheme } from "../state/customTheme";
import { resetAndReonboard } from "../state/onboarding";
import { THEME_FAMILIES_1_9_6 } from "../state/release196.fixtures";
import { useUiStore } from "../state/ui";
import {
  applyCustomThemeBroadcast,
  clearCustomTheme,
  customThemeBroadcast,
  deleteCustomTheme,
  hydrateCustomTheme,
  importCustomTheme,
  pickThemeFamily,
  primeCustomThemeFromBoot,
  renameCustomTheme,
} from "./composition";

const g = globalThis as unknown as { window: unknown; document: unknown };
const realWindow = g.window;
const realDocument = g.document;
let dom: { dataset: Record<string, string>; styles: { id: string; textContent: string; remove(): void }[] };

beforeEach(async () => {
  const styles: typeof dom.styles = [];
  dom = { dataset: { theme: "light" }, styles };
  g.window = {
    ...(realWindow as object),
    localStorage: { setItem() {}, removeItem() {}, getItem: () => null },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  };
  g.document = {
    ...(realDocument as object),
    documentElement: { dataset: dom.dataset },
    getElementById: (id: string) => styles.find((s) => s.id === id) ?? null,
    createElement: () => {
      const node = {
        id: "",
        textContent: "",
        remove: () => styles.splice(styles.indexOf(node), 1),
      };
      return node;
    },
    head: { appendChild: (node: (typeof styles)[number]) => styles.push(node) },
  };
  useUiStore.setState({ theme: "light", themeFamily: "warm", accentColor: "default", accentHue: 210 });
  useCustomTheme.setState({ selection: null, entries: [], notice: null, moved: [] });
  await hydrateCustomTheme();
  for (const { id } of useCustomTheme.getState().entries) await deleteCustomTheme(id);
});

afterEach(() => {
  clearCustomTheme();
  g.window = realWindow;
  g.document = realDocument;
});

const forestGround = (mode: "light" | "dark") => resolveSeeds(FOREST_PAPER.seeds)![mode].tokens["--ground"]!;

test("importing a theme selects it: its sheet, then the custom attributes, and its base as the family", async () => {
  expect(await importCustomTheme(themeText(FOREST_PAPER))).toEqual({
    status: "saved",
    id: "forest-paper",
    name: "Forest Paper",
  });
  expect(dom.dataset).toMatchObject({ theme: "custom-light", themeId: "forest-paper" });
  expect(useUiStore.getState().themeFamily).toBe("grove");
  expect(dom.styles).toHaveLength(1);
  expect(dom.styles[0]!.textContent).toContain(`--ground: ${forestGround("light")};`);
  expect(dom.styles[0]!.textContent).toContain(`--ground: ${forestGround("dark")};`);
});

test("moved colours are reported for a theme Rotli had to adjust", async () => {
  await importCustomTheme(themeText(NEON));
  expect(useCustomTheme.getState().moved.map((m) => `${m.mode} ${m.role}`)).toEqual([
    "light Page",
    "light Accent",
    "dark Page",
    "dark Accent",
  ]);
});

test("a second import of the same id asks, then keeps both or replaces", async () => {
  await importCustomTheme(themeText(FOREST_PAPER));
  expect((await importCustomTheme(themeText(FOREST_PAPER))).status).toBe("exists");
  expect(await importCustomTheme(themeText(FOREST_PAPER), "keep-both")).toMatchObject({
    id: "forest-paper-2",
  });
  expect(useCustomTheme.getState().entries.map((e) => e.id)).toEqual(["forest-paper", "forest-paper-2"]);
  expect(dom.dataset.themeId).toBe("forest-paper-2");
});

test("deleting the theme in use lands on the base family, with no custom sheet left", async () => {
  await importCustomTheme(themeText(FOREST_PAPER));
  await deleteCustomTheme("forest-paper");
  expect(useCustomTheme.getState().selection).toBeNull();
  expect(dom.dataset.theme).toBe("grove-light");
  expect(dom.dataset.themeId).toBeUndefined();
  expect(dom.styles).toEqual([]);
});

test("a selected theme whose file is gone shows the base family and says so", async () => {
  await importCustomTheme(themeText(FOREST_PAPER));
  await deleteCustomTheme("forest-paper");
  // a later launch: the setting still names it, the file isn't here
  useCustomTheme.setState({ selection: { id: "forest-paper", name: "Forest Paper", source: "mac" } });
  await hydrateCustomTheme();
  expect(useCustomTheme.getState().notice).toBe("Forest Paper isn't on this Mac. Showing Grove.");
  expect(dom.dataset.theme).toBe("grove-light");
  expect(dom.styles).toEqual([]);
});

test("a launch primed from last time's sheet drops to the base family when the file is gone", async () => {
  await importCustomTheme(themeText(FOREST_PAPER));
  const css = dom.styles[0]!.textContent;
  await deleteCustomTheme("forest-paper");
  const selection = { id: "forest-paper", name: "Forest Paper", source: "mac" as const };
  (g.window as { localStorage: { getItem: (key: string) => string | null } }).localStorage.getItem = (key) =>
    key === "rotli.customThemeBoot" ? JSON.stringify({ id: "forest-paper", css }) : null;
  // what theme-boot.js painted before the app ran
  dom.dataset.theme = "custom-light";
  useCustomTheme.setState({ selection });
  primeCustomThemeFromBoot(selection);
  await hydrateCustomTheme();
  expect(dom.dataset.theme).toBe("grove-light");
  expect(dom.dataset.themeId).toBeUndefined();
});

test("picking a built-in family leaves the custom theme", async () => {
  await importCustomTheme(themeText(FOREST_PAPER));
  pickThemeFamily("ocean");
  expect(useCustomTheme.getState().selection).toBeNull();
  expect(dom.dataset.theme).toBe("ocean-light");
});

test("the titlebar sun flips a custom theme's day and night, never another family", async () => {
  await importCustomTheme(themeText(FOREST_PAPER));
  useAppearanceLook.setState({ themeCycle: "all" });
  try {
    useUiStore.getState().cycleTheme();
    expect(useUiStore.getState()).toMatchObject({ theme: "dark", themeFamily: "grove" });
  } finally {
    useAppearanceLook.setState({ themeCycle: "family" });
  }
});

test("rename keeps the id and updates the selection's name", async () => {
  await importCustomTheme(themeText(FOREST_PAPER));
  expect(await renameCustomTheme("forest-paper", "Forest at Dusk")).toBeNull();
  expect(useCustomTheme.getState().selection).toEqual({
    id: "forest-paper",
    name: "Forest at Dusk",
    source: "mac",
  });
});

test("another window follows main's selection from the broadcast, reading the file itself", async () => {
  await importCustomTheme(themeText(FOREST_PAPER));
  const payload = customThemeBroadcast();
  // the other window starts on the base family
  useCustomTheme.setState({ selection: null });
  clearCustomTheme();
  await applyCustomThemeBroadcast(payload);
  expect(dom.dataset).toMatchObject({ theme: "custom-light", themeId: "forest-paper" });
  // a broken payload changes nothing
  await applyCustomThemeBroadcast("{not json");
  expect(dom.dataset.themeId).toBe("forest-paper");
});

test("a selected custom theme writes a family 1.9.6 knows, so 1.9.6 shows the base and never stamps it to warm", async () => {
  await importCustomTheme(themeText(FOREST_PAPER));
  // only where theme files last (the Mac app) is the selection saved at all
  expect(appExtrasSnapshot().customTheme).toBeNull();
  useCustomTheme.setState({ durable: true });
  expect(appExtrasSnapshot().customTheme).toEqual({
    id: "forest-paper",
    name: "Forest Paper",
    source: "mac",
  });
  expect(THEME_FAMILIES_1_9_6).toContain(useUiStore.getState().themeFamily as never);
  // a theme with no base, or one this build doesn't know, keeps the family as it was
  useUiStore.setState({ themeFamily: "iris" });
  const { base: _base, ...noBase } = FOREST_PAPER;
  await importCustomTheme(themeText({ ...noBase, id: "plain", base: "sunset" }));
  expect(useUiStore.getState().themeFamily).toBe("iris");
});

test("if painting a theme fails, the base family applies and Appearance says why", async () => {
  const head = (g.document as { head: { appendChild: (node: unknown) => void } }).head;
  head.appendChild = () => {
    throw new Error("no sheet for you");
  };
  await importCustomTheme(themeText(FOREST_PAPER));
  expect(useCustomTheme.getState().notice).toBe("Couldn't apply Forest Paper. Showing Grove.");
  expect(dom.dataset.theme).toBe("grove-light");
  expect(dom.dataset.themeId).toBeUndefined();
});

test("Reset & re-onboard leaves a custom theme, so setup starts in Rotli Light", async () => {
  await importCustomTheme(themeText(FOREST_PAPER));
  await resetAndReonboard();
  expect(useCustomTheme.getState().selection).toBeNull();
  expect(useUiStore.getState()).toMatchObject({ theme: "light", themeFamily: "warm" });
  expect(dom.dataset.themeId).toBeUndefined();
  expect(dom.styles).toEqual([]);
});
