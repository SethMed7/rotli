// The one stylesheet that paints a custom theme. Derived colours are runtime
// data in the existing semantic roles, never new tokens (DESIGN.md). Every rule
// is scoped to `:root[data-theme="custom-<mode>"][data-theme-id]`, which
// outranks the static Paper and Charcoal fallback by specificity, so the order
// the sheet lands in never matters. Both halves are written together, so a
// System-mode flip needs no script.
//
// public/theme-boot.js paints the same text before first paint and checks it
// against the same grammar (THEME_SHEET_LINE); themeBoot.test.ts pins the two.

import { ACCENT_VARIANTS, type AccentVariant } from "./themeEngine/accents";
import type { TokenSet } from "./themeEngine/derive";
import { MODES, type Mode } from "./themeEngine/policy";

export interface CustomThemePaint {
  /** The applied token set per mode, and what each Primary-color choice
   * changes on top of it. */
  modes: Record<Mode, { tokens: TokenSet; variants: Record<AccentVariant, TokenSet> }>;
}

/** A sheet the boot script or this module installed carries this flag (or,
 * as a `<style>` element, this id), so a newer sheet replaces it. */
export const CUSTOM_THEME_SHEET_ID = "rotli-custom-theme";
const SHEET_FLAG = "rotliCustomTheme";

const NAME = /^--[a-z0-9-]+$/;
const VALUE = /^(#[0-9a-f]{6}|rgba\(\d{1,3}, \d{1,3}, \d{1,3}, (0|1|0?\.\d+)\))$/;
const MONO_SYNTAX = ["--syntax-blue"];

/** One rule per line; the whole grammar the boot script accepts. */
export const THEME_SHEET_LINE =
  /^:root\[data-theme="custom-(light|dark)"\]\[data-theme-id\](\[data-accent="(blue|green|violet|rose|amber|custom)"\]|:not\(\[data-syntax-palette="mono"\]\))? \{( --[a-z0-9-]+: (#[0-9a-f]{6}|rgba\(\d{1,3}, \d{1,3}, \d{1,3}, (0|1|0?\.\d+)\));)+ \}$/;

function rule(selector: string, tokens: TokenSet, keep: (name: string) => boolean): string | null {
  const decls = Object.entries(tokens)
    .filter(([name, value]) => keep(name) && NAME.test(name) && VALUE.test(value))
    .map(([name, value]) => ` ${name}: ${value};`);
  return decls.length ? `${selector} {${decls.join("")} }` : null;
}

/** The sheet's text. Only engine-shaped names and values are emitted; a
 * value that is not `#rrggbb` or the engine's `rgba()` is dropped. */
export function customThemeCss(paint: CustomThemePaint): string {
  const lines: string[] = [];
  for (const mode of MODES) {
    const { tokens, variants } = paint.modes[mode];
    const scope = `:root[data-theme="custom-${mode}"][data-theme-id]`;
    const notSyntax = (name: string) => !MONO_SYNTAX.includes(name);
    // the Mono syntax palette keeps its own colours, so syntax rides a
    // narrower rule it can opt out of
    const rules = [
      rule(scope, tokens, notSyntax),
      rule(`${scope}:not([data-syntax-palette="mono"])`, tokens, (name) => MONO_SYNTAX.includes(name)),
      ...ACCENT_VARIANTS.map((name: AccentVariant) =>
        rule(`${scope}[data-accent="${name}"]`, variants[name], notSyntax),
      ),
    ];
    for (const line of rules) if (line !== null) lines.push(line);
  }
  return lines.join("\n");
}

interface SheetHost {
  adoptedStyleSheets?: CSSStyleSheet[];
  getElementById(id: string): Element | null;
  createElement(tag: "style"): HTMLStyleElement;
  head: { appendChild(node: Node): unknown } | null;
}

const isOurs = (sheet: CSSStyleSheet): boolean =>
  (sheet as unknown as Record<string, unknown>)[SHEET_FLAG] === true;

/** Replace the custom-theme sheet (null removes it). A constructed sheet where
 * the webview has them; a `<style>` element otherwise (WebKit before 16.4).
 * The CSP allows inline style, and the text holds only validated values. */
export function installCustomThemeSheet(css: string | null, host: SheetHost = document): void {
  if (host.adoptedStyleSheets) host.adoptedStyleSheets = host.adoptedStyleSheets.filter((s) => !isOurs(s));
  host.getElementById(CUSTOM_THEME_SHEET_ID)?.remove();
  if (css === null) return;
  const Sheet = typeof CSSStyleSheet === "function" ? CSSStyleSheet : null;
  if (host.adoptedStyleSheets && Sheet && "replaceSync" in Sheet.prototype) {
    const sheet = new Sheet();
    sheet.replaceSync(css);
    Object.defineProperty(sheet, SHEET_FLAG, { value: true });
    host.adoptedStyleSheets = [...host.adoptedStyleSheets, sheet];
    return;
  }
  const style = host.createElement("style");
  style.id = CUSTOM_THEME_SHEET_ID;
  style.textContent = css;
  host.head?.appendChild(style);
}
