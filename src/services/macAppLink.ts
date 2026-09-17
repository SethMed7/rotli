// The installed Mac app, reached from Rotli Web through its `rotli://` scheme.
// A browser has no Finder to open (the owner, 2026-09-17: "it should open the
// actual finder in the location of the file I am in"), but the app on the
// same Mac does — and it registers `rotli://` at install. `reveal` names the
// file and the vault the page is connected to; the app answers only when that
// is its own vault (src-tauri/src/deep_link.rs). Nothing comes back: if no app
// is installed the browser simply has no handler for the scheme.

/** The last link handed to the app — a test seam; the browser cannot observe
 * a scheme navigation from the page. */
export const DEEP_LINK_ATTR = "data-rotli-deep-link";

export function revealLinkFor(vault: string | null, rel: string): string {
  const vaultPart = vault ? `&vault=${encodeURIComponent(vault)}` : "";
  return `rotli://reveal?id=${encodeURIComponent(rel)}${vaultPart}`;
}

export function revealInMacApp(vault: string | null, rel: string): void {
  const url = revealLinkFor(vault, rel);
  document.documentElement.setAttribute(DEEP_LINK_ATTR, url);
  window.location.assign(url);
}
