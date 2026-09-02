/** The OS colour-scheme answer a "system" theme setting resolves against.
 * The ONE matchMedia read site — every other consumer reads `data-theme`
 * (state/theme.ts useDataTheme / useIsDarkTheme). A leaf module so both the
 * ui store and the theme applier can import it without a cycle. */
export function systemPrefersDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}
