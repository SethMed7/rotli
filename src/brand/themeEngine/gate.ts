// The gate: every listed pair Rotli paints, flattened and measured. It is
// independent of the solver, so a token set from the solver, a file, an
// override, or the built-in stylesheets goes through the same list. Every
// translucent layer is composited over its backing surface first, then the
// final 8-bit colour is measured.

import { contrast, mix, over } from "./color";
import type { TokenSet } from "./derive";
import {
  ALPHA,
  BOARD_INK,
  type ContrastLevel,
  HIERARCHY,
  LABEL_NAMES,
  LEVELS,
  type Mode,
  SCENE_NAMES,
  SEAM,
  asContrastLevel,
} from "./policy";

export type GateGroup = "text" | "ui" | "seam" | "state";

export interface GateRow {
  group: GateGroup;
  role: string;
  on: string;
  fg: string;
  bg: string;
  ratio: number;
  min: number;
  pass: boolean;
}

/** Measure every listed pair for one mode. A missing token measures as
 * black, so an incomplete set fails instead of passing by omission. */
export function audit(tokens: TokenSet, mode: Mode, level: ContrastLevel = "standard"): GateRow[] {
  const lv = LEVELS[asContrastLevel(level)];
  const t = (name: string): string => tokens[name] ?? "#000000";
  const bases: Record<string, string> = {
    Page: t("--ground"),
    Card: t("--surface"),
    Panel: t("--surface-2"),
    Tint: t("--tint"),
  };
  const page = t("--ground");
  const card = t("--surface");
  const cards: Record<string, string> = { Page: page, Card: card, Panel: t("--surface-2") };
  const rows: GateRow[] = [];
  const add = (group: GateGroup, role: string, on: string, fg: string, bg: string, min: number): void => {
    const ratio = contrast(fg, bg);
    rows.push({ group, role, on, fg, bg, ratio, min, pass: ratio >= min });
  };
  const each = (
    group: GateGroup,
    role: string,
    fg: string,
    grounds: Record<string, string>,
    min: number,
  ): void => {
    for (const [on, bg] of Object.entries(grounds)) add(group, role, on, fg, bg, min);
  };
  const hov = ALPHA.hov[mode];
  const act = ALPHA.act[mode];
  const layered = (
    alpha: number,
    color: string,
    suffix: string,
    grounds: Record<string, string>,
  ): Record<string, string> =>
    Object.fromEntries(
      Object.entries(grounds).map(([on, bg]) => [`${on} ${suffix}`, over(color, alpha, bg)]),
    );
  const selected = {
    ...layered(ALPHA.selected, t("--accent"), "row", cards),
    ...layered(ALPHA.selectedHover, t("--accent"), "row, hovered", cards),
  };
  const selection = layered(ALPHA.selection, t("--accent"), "selection", cards);
  const hovered = {
    ...layered(hov, t("--text"), "hover", bases),
    ...layered(act, t("--text"), "press", bases),
  };
  const hoveredCards = {
    ...layered(hov, t("--text"), "hover", cards),
    ...layered(act, t("--text"), "press", cards),
  };

  // `main` on the page and a card, 4.5 on a panel and on tint
  const read = (role: string, fg: string): void => {
    for (const [on, bg] of Object.entries(bases))
      add("text", role, on, fg, bg, on === "Page" || on === "Card" ? lv.main : 4.5);
  };
  add("text", "Text on the page", "Page", t("--text"), page, lv.page);
  read("Text", t("--text"));
  read("Secondary text", t("--text-muted"));
  read("Links", t("--accent-text"));
  add("text", "Button label", "the accent", t("--on-accent"), t("--accent"), 4.5);
  read("Failed", t("--failure"));
  read("Passed", t("--success"));
  read("Code syntax", t("--syntax-blue"));
  each("text", "Text, current row", t("--text"), selected, 4.5);
  each("text", "Secondary, current row", t("--text-muted"), selected, 4.5);
  each("text", "Accent detail, current row", t("--accent-text"), selected, 4.5);
  each("text", "Text, selected", t("--text"), selection, 4.5);
  each("text", "Text, hover and press", t("--text"), hovered, 4.5);
  each("text", "Secondary, hover and press", t("--text-muted"), hoveredCards, 4.5);
  add(
    "text",
    "Board tool label",
    "the selected tool",
    t("--text"),
    over(t("--accent"), ALPHA.boardContainer, card),
    4.5,
  );
  add("text", "Board ink", "Page", BOARD_INK[mode], page, 4.5);

  for (const [on, bg] of Object.entries(bases))
    add(
      "ui",
      "Accent fill and focus ring",
      on,
      t("--accent"),
      bg,
      on === "Page" || on === "Card" ? lv.ui : 3,
    );
  add("ui", "Board accent", "Card", mix(t("--accent"), ALPHA.boardAccent, t("--text")), card, 3);
  for (const name of LABEL_NAMES) each("ui", `Label ${name}`, t(`--accent-swatch-${name}`), cards, 3);
  for (const name of SCENE_NAMES) {
    add(
      "ui",
      "Chat buddy outline",
      `the ${name} sky`,
      t("--quokka-line-auto"),
      t(`--chat-welcome-${name}`),
      3,
    );
    add(
      "ui",
      "Chat buddy outline",
      `the ${name} ground`,
      t("--quokka-line-auto"),
      t(`--chat-welcome-${name}-ground`),
      3,
    );
  }
  add("ui", "Chart ramp, strongest step", "Card", t("--chart-seq-5"), card, 3);
  add("seam", "Chart ramp, quietest step", "Card", t("--chart-seq-1"), card, 2);

  add("seam", "Hairline", "Page", t("--border"), page, SEAM);
  add("seam", "Hairline", "Card", t("--border"), card, SEAM);
  add("seam", "Text over secondary text", "Secondary", t("--text"), t("--text-muted"), HIERARCHY);
  const strong = mix(t("--text"), ALPHA.borderStrong, t("--border"));
  add("seam", "Floating edge", "Page", strong, page, 1.8);
  add("seam", "Floating edge", "Card", strong, card, 1.8);

  each("state", "Secondary, selected", t("--text-muted"), selection, 3);
  add("state", "Disabled text", "Page", over(t("--text"), ALPHA.disabled, page), page, 2.5);
  add("state", "Disabled text", "Card", over(t("--text"), ALPHA.disabled, card), card, 2.5);
  return rows;
}

/** The failing rows only. */
export const failures = (rows: readonly GateRow[]): GateRow[] => rows.filter((row) => !row.pass);
