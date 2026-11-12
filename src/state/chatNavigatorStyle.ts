import type { ChatNavigatorStyle } from "./ui";

/** Tesven swaps the quokka trails for its own hexagons (the owner,
 * 2026-11-12), like it keeps the line quokka: keyed on the APPLIED
 * `data-theme`, and the stored choice is never rewritten, so leaving Tesven
 * brings the pawprints or ears back. Each theme world offers three or four
 * trails; a stored trail from the other world resolves to its counterpart. */
const TESVEN_CHOICES: readonly ChatNavigatorStyle[] = ["lines", "dots", "hexes"];
const QUOKKA_CHOICES: readonly ChatNavigatorStyle[] = ["lines", "dots", "paws", "ears"];

function isTesven(dataTheme: string | undefined): boolean {
  return dataTheme?.startsWith("tesven-") ?? false;
}

export function navigatorChoices(dataTheme: string | undefined): readonly ChatNavigatorStyle[] {
  return isTesven(dataTheme) ? TESVEN_CHOICES : QUOKKA_CHOICES;
}

export function resolveNavigatorStyle(
  stored: ChatNavigatorStyle,
  dataTheme: string | undefined,
): ChatNavigatorStyle {
  if (isTesven(dataTheme)) return stored === "paws" || stored === "ears" ? "hexes" : stored;
  return stored === "hexes" ? "paws" : stored;
}
