// The front end's host seam. Standalone Rotli registers nothing and behaves
// exactly as it always has. A host build registers once, from a module its
// own entry imports before Rotli's `src/main.tsx`, and adds Settings panes
// and blocks, orders the nav, says whether notes are part of the app and
// whether Rotli's pane heads keep their quokka, and supplies its own name and
// wording where Rotli's would read wrong. The registry locks on its first
// read, so what the app rendered with never changes under it.
// docs/architecture/host-seams.md

import type { ComponentType, ReactNode } from "react";

import { THEME_FAMILIES, type ThemeFamily } from "../state/themeChoices";

/** A Settings row's glyph, the same shape as Rotli's own (components/glyphs). */
export type HostGlyph = (props: { size?: number }) => ReactNode;

/** What Settings hands a host pane's component. */
export interface HostPaneProps {
  /** Shows another Settings pane, Rotli's or the host's. A pane this build
   * doesn't show right now does nothing. An id no pane has throws under the
   * dev server and does nothing in a built app. */
  openPane: (id: string) => void;
}

/** One Settings pane a host adds. */
export interface HostSettingsPane {
  /** Unique among every pane, Rotli's included. */
  id: string;
  /** The nav row's name. */
  label: string;
  glyph: HostGlyph;
  /** The pane heading; the label when absent. A host pane's heading is the
   * banner's scenery with no character and no object. */
  title?: string;
  /** The built-in pane this one follows in the nav. Absent, or a pane this
   * build doesn't show: just before About. */
  after?: string;
  /** The pane's body, below its heading. */
  Pane: ComponentType<HostPaneProps>;
  /** Whether the pane shows right now; absent, always. False takes away its
   * nav row and every way to open it. Settings calls it while rendering, so it
   * must be cheap, change nothing and not throw. */
  visible?: () => boolean;
  /** For a `visible` that changes while Settings is open: call `onChange` when
   * it may answer differently, and return the unsubscribe. A zustand store's
   * `subscribe` is one. */
  subscribeVisible?: (onChange: () => void) => () => void;
}

/** The built-in panes a host can add blocks to. */
export const BLOCK_PANES = ["general", "connections", "about"] as const;
export type BlockPane = (typeof BLOCK_PANES)[number];

/** A block a host adds before or after the body of a built-in pane (below
 * its heading either way). Blocks in one place render in the order given. */
export interface HostPaneBlock {
  pane: BlockPane;
  place: "before" | "after";
  Block: ComponentType;
}

/** Sentences a host supplies; Rotli's defaults stand in for each. */
export interface HostWords {
  /** Where the standalone build offers "Check for updates". */
  updates?: string;
  /** The app's name wherever Rotli's copy says "Rotli" and means this app:
   * Settings, first run, Home, chat, dialogs and notices. */
  productName?: string;
  /** The name where Rotli writes its lower-case wordmark ("Message rotli…",
   * "read-only for rotli"); productName when absent. */
  inlineName?: string;
  /** The version beside that name; the bundle's version when absent. */
  version?: string;
  /** The About pane's nav row and heading, where Rotli says "About Rotli". */
  aboutLabel?: string;
  /** The Connections pane's opening paragraph; an empty string hides it. */
  connectionsLead?: string;
  /** A label on each of Rotli's own Connections section headings, to say they
   * belong to its notes; absent, no label. */
  notesSectionTag?: string;
  /** General's "Show in the Dock" switch: its label and its explanation (each
   * Rotli's when absent; an empty detail shows none), or null for no row. */
  dockRow?: { label?: string; detail?: string } | null;
  /** What the About pane says. A string is one paragraph in place of Rotli's
   * sentences, website link and feedback link; null or empty drops them. The
   * version row and the third-party credits stay either way. */
  aboutBody?: string | null;
}

/** First run's built-in steps, in Rotli's own order. */
export const SETUP_STEPS = ["you", "vault", "librarian", "shortcuts"] as const;
export type SetupStepId = (typeof SETUP_STEPS)[number];

/** A host's words for one step: the progress label, the heading, the lede
 * and the primary button. Each falls back to Rotli's. */
export interface HostStepWords {
  label?: string;
  title?: string;
  lede?: string;
  primary?: string;
}

/** Whether a step's own content lets setup move on yet, and how to hear that
 * it may have changed. Absent: always. */
interface HostReadiness {
  ready?: () => boolean;
  subscribeReady?: (onChange: () => void) => () => void;
}

/** A first-run step a host adds: a screen of its own between Rotli's. */
export interface HostSetupStep extends HostReadiness {
  /** Unique, and none of Rotli's step ids. */
  id: string;
  label: string;
  title: string;
  lede?: string;
  /** The primary button; "Continue", or "Finish setup" on the last step. */
  primary?: string;
  Body: ComponentType;
}

/** A block a host adds before or after the body of one of Rotli's steps. */
export interface HostStepBlock extends HostReadiness {
  step: SetupStepId;
  place: "before" | "after";
  Block: ComponentType;
}

/** How first run goes under a host. Absent: Rotli's own four steps, as ever. */
export interface HostFirstRun {
  /** One centred column on the theme's flat ground: no scenery, no companion,
   * no intro; the thank-you card is words alone; a folder is a row with its
   * own button, and the step's primary moves on once one is chosen. */
  plain?: boolean;
  /** Step ids in order, Rotli's and the host's. It starts with "you" and holds
   * "vault"; absent, Rotli's four and then the host's steps. */
  order?: readonly string[];
  steps?: readonly HostSetupStep[];
  blocks?: readonly HostStepBlock[];
  words?: Partial<Record<SetupStepId, HostStepWords>>;
  /** Whether the You step offers the theme, mode and accent. Default true. */
  themeChoice?: boolean;
}

export interface AppHost {
  /** Whether notes are part of this app. False: the window is Settings, with
   * no notes panes and no way back to notes. Default true. */
  notes?: boolean;
  settingsPanes?: readonly HostSettingsPane[];
  paneBlocks?: readonly HostPaneBlock[];
  /** Pane ids, built-in or the host's, in the order the nav shows them. The
   * named panes trade places among the slots they hold; the rest stay put. */
  navOrder?: readonly string[];
  words?: HostWords;
  /** The About row's glyph, where Rotli shows its quokka. */
  aboutGlyph?: HostGlyph;
  /** The heading of each built-in pane: Rotli's quokka and object ("rotli",
   * the default), or the scenery alone, as a host's own panes show ("plain"). */
  paneHeads?: "rotli" | "plain";
  /** The theme family a fresh install, first run, Skip setup and Reset start
   * on: any of Rotli's family ids. Absent, Rotli's own ("warm"). */
  themeFamily?: ThemeFamily;
  /** Whether Rotli's quokka appears ("quokka", the default) or nowhere
   * ("none"): the search-field mark, the chat buddy, banners, setup, empty
   * states, its studio in Appearance and its trails. */
  mascot?: "quokka" | "none";
  /** The host's own mark, where Rotli shows its quokka mark (the titlebar's
   * home mark, the search field). With no mascot and no mark, nothing. */
  productMark?: HostGlyph;
  firstRun?: HostFirstRun;
}

export const DEFAULT_UPDATES_WORDS = "Updates arrive with this app";
export const DEFAULT_PRODUCT_NAME = "Rotli";
export const DEFAULT_INLINE_NAME = "rotli";
export const DEFAULT_ABOUT_LABEL = "About Rotli";
const connectionsLeadFor = (name: string) =>
  `Choose the outside services ${name} can contact. Each connection is explicit and never changes destination after a failure.`;
export const DEFAULT_CONNECTIONS_LEAD = connectionsLeadFor(DEFAULT_PRODUCT_NAME);

const dockDetailFor = (name: string) => `Otherwise ${name} lives in the menu bar only.`;
export const DEFAULT_DOCK_ROW = {
  label: "Show in the Dock",
  detail: dockDetailFor(DEFAULT_PRODUCT_NAME),
} as const;

export interface HostRegistry {
  register(host: AppHost): void;
  read(): AppHost | null;
}

/** A registry: one host at most, registered before the first read. */
export function createHostRegistry(): HostRegistry {
  let host: AppHost | null = null;
  let locked = false;
  return {
    register(next) {
      if (locked) throw new Error("A host registers before the app starts");
      if (host) throw new Error("A host is already registered");
      const ids = (next.settingsPanes ?? []).map((pane) => pane.id);
      if (new Set(ids).size !== ids.length) throw new Error("Host Settings panes need unique ids");
      const blocks = next.paneBlocks ?? [];
      const takesBlocks = (pane: string) => (BLOCK_PANES as readonly string[]).includes(pane);
      if (blocks.some(({ pane, place }) => !takesBlocks(pane) || (place !== "before" && place !== "after")))
        throw new Error(`Host pane blocks go before or after ${BLOCK_PANES.join(", ")}`);
      if (next.themeFamily !== undefined && !(THEME_FAMILIES as readonly string[]).includes(next.themeFamily))
        throw new Error(`A host's theme family is one of ${THEME_FAMILIES.join(", ")}`);
      validateFirstRun(next.firstRun);
      if (next.productMark !== undefined && typeof next.productMark !== "function")
        throw new Error("A host's product mark is a component that takes a size");
      if (next.mascot !== undefined && next.mascot !== "quokka" && next.mascot !== "none")
        throw new Error('A host\'s mascot is "quokka" or "none"');
      host = Object.freeze({
        ...next,
        settingsPanes: Object.freeze([...(next.settingsPanes ?? [])]),
        paneBlocks: Object.freeze([...blocks]),
      });
    },
    read() {
      locked = true;
      return host;
    },
  };
}

/** Throws when a host's first run can't be followed. */
function validateFirstRun(firstRun: HostFirstRun | undefined): void {
  if (!firstRun) return;
  const builtIn = SETUP_STEPS as readonly string[];
  const hostIds = (firstRun.steps ?? []).map((step) => step.id);
  if (new Set(hostIds).size !== hostIds.length || hostIds.some((id) => builtIn.includes(id)))
    throw new Error("A host's first-run steps need unique ids, none of them a built-in step's");
  const order = setupOrder({ firstRun });
  if (new Set(order).size !== order.length) throw new Error("A first-run step is named twice");
  const unknown = order.filter((id) => !builtIn.includes(id) && !hostIds.includes(id));
  if (unknown.length) throw new Error(`Unknown first-run steps: ${unknown.join(", ")}`);
  if (order[0] !== "you" || !order.includes("vault"))
    throw new Error('A first run starts with "you" and holds "vault"');
  const unplaced = hostIds.filter((id) => !order.includes(id));
  if (unplaced.length) throw new Error(`First-run steps left out of the order: ${unplaced.join(", ")}`);
  for (const { step, place } of firstRun.blocks ?? [])
    if (!order.includes(step) || (place !== "before" && place !== "after"))
      throw new Error(`A first-run block goes before or after a step in the order: ${step}`);
}

const registry = createHostRegistry();

/** Called by a host build's entry, before Rotli's main module runs. */
export const registerHost = (host: AppHost): void => registry.register(host);

/** The registered host, or null for standalone Rotli. */
export const appHost = (): AppHost | null => registry.read();

/** Whether notes are part of this app (always, without a host). */
export function notesOn(host: AppHost | null = appHost()): boolean {
  return host?.notes !== false;
}

/** The sentence where this build doesn't check the update feed. */
export function updatesWords(host: AppHost | null = appHost()): string {
  return host?.words?.updates ?? DEFAULT_UPDATES_WORDS;
}

/** The blocks a host puts in one place of a built-in pane, in order. */
export function paneBlocks(
  pane: BlockPane,
  place: "before" | "after",
  host: AppHost | null = appHost(),
): ComponentType[] {
  return (host?.paneBlocks ?? [])
    .filter((block) => block.pane === pane && block.place === place)
    .map((block) => block.Block);
}

/** The app's name where Settings says "Rotli" and means this app. The first
 * read locks the registry, so nothing may read it before the host registers.
 * After that it is safe, module loads included: a host registers before
 * main.tsx loads, and app.tsx reads it as it loads (the two action titles). */
export function productName(host: AppHost | null = appHost()): string {
  return host?.words?.productName ?? DEFAULT_PRODUCT_NAME;
}

/** The name where Rotli writes its lower-case wordmark: "rotli" standalone,
 * the host's inlineName or productName under a host. */
export function inlineName(host: AppHost | null = appHost()): string {
  return host?.words?.inlineName ?? host?.words?.productName ?? DEFAULT_INLINE_NAME;
}

/** The theme family a fresh start uses, or null for Rotli's own default. */
export function hostThemeFamily(host: AppHost | null = appHost()): ThemeFamily | null {
  return host?.themeFamily ?? null;
}

/** Whether Rotli's quokka appears anywhere in this build. */
export function mascotShown(host: AppHost | null = appHost()): boolean {
  return host?.mascot !== "none";
}

/** The host's own mark, where Rotli shows its quokka mark; null for none. */
export function productMark(host: AppHost | null = appHost()): HostGlyph | null {
  return host?.productMark ?? null;
}

/** What a host build says about system-wide shortcuts, which it never takes:
 * the note in General and the hint on a Keybindings row. With no name given,
 * Rotli's words. A named host says it takes none, because "they stay with
 * <name>" would say the opposite. */
export function noShortcutsWords(host: AppHost | null = appHost()): { note: string; row: string } {
  const name = host?.words?.productName;
  const keeps = "Either way the menu-bar icon stays.";
  return name === undefined
    ? {
        note: `${keeps} System-wide shortcuts stay with Rotli, so open this app from its menu-bar icon.`,
        row: "system-wide shortcuts stay with Rotli",
      }
    : {
        note: `${keeps} ${name} takes no system-wide shortcuts, so open it from its menu-bar icon.`,
        row: `${name} takes no system-wide shortcuts`,
      };
}

/** The About pane's row and heading. */
export function aboutLabel(host: AppHost | null = appHost()): string {
  return host?.words?.aboutLabel ?? DEFAULT_ABOUT_LABEL;
}

/** The Connections pane's opening paragraph; empty means none. */
export function connectionsLead(host: AppHost | null = appHost()): string {
  return host?.words?.connectionsLead ?? connectionsLeadFor(productName(host));
}

/** The label a host puts on Rotli's own section headings, or null for none. */
export function notesSectionTag(host: AppHost | null = appHost()): string | null {
  return host?.words?.notesSectionTag || null;
}

/** Whether built-in pane heads drop the quokka and its object. */
export function plainPaneHeads(host: AppHost | null = appHost()): boolean {
  return host?.paneHeads === "plain";
}

/** The Dock switch's words, or null where a host retired the row. */
export function dockRow(host: AppHost | null = appHost()): { label: string; detail: string } | null {
  const row = host?.words?.dockRow;
  return row === null ? null : { ...DEFAULT_DOCK_ROW, detail: dockDetailFor(productName(host)), ...row };
}

/** What stands in for About's wording: undefined keeps Rotli's own. */
export function aboutBody(host: AppHost | null = appHost()): string | null | undefined {
  return host?.words?.aboutBody;
}

/** The version a host supplies, or null to show the bundle's own. */
export function hostVersion(host: AppHost | null = appHost()): string | null {
  return host?.words?.version ?? null;
}

/** The foot of Settings' nav: the app's name, and its version once known. */
export function navFootLabel(name: string, version: string | null): string {
  return version ? `${name} ${version}` : name;
}

/** First run's step ids in order: Rotli's four, or the host's order. */
export function setupOrder(host: AppHost | null = appHost()): readonly string[] {
  const firstRun = host?.firstRun;
  return firstRun?.order ?? [...SETUP_STEPS, ...(firstRun?.steps ?? []).map((step) => step.id)];
}

/** Whether first run is the plain one. */
export function plainFirstRun(host: AppHost | null = appHost()): boolean {
  return host?.firstRun?.plain === true;
}

/** A host's own step, by id, or null for one of Rotli's. */
export function hostSetupStep(id: string, host: AppHost | null = appHost()): HostSetupStep | null {
  return host?.firstRun?.steps?.find((step) => step.id === id) ?? null;
}

/** The blocks a host puts in one place of one of Rotli's steps, in order. */
export function setupStepBlocks(
  step: SetupStepId,
  place: "before" | "after",
  host: AppHost | null = appHost(),
): readonly HostStepBlock[] {
  return (host?.firstRun?.blocks ?? []).filter((block) => block.step === step && block.place === place);
}

/** A host's words for one of Rotli's steps; empty when it gave none. */
export function setupStepWords(step: SetupStepId, host: AppHost | null = appHost()): HostStepWords {
  return host?.firstRun?.words?.[step] ?? {};
}

/** Whether the You step offers the theme, mode and accent. */
export function setupThemeChoice(host: AppHost | null = appHost()): boolean {
  return host?.firstRun?.themeChoice !== false;
}
