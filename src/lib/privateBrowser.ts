/** The private browser is deliberately session-only. A tab carries no URL so
 * viewstate.json can never become browser history; this in-memory map exists
 * only long enough to hand an initial destination to its mounted surface. */
const initialUrls = new Map<string, string | null>();

export const PRIVATE_BROWSER_SEARCH_ENGINES = ["duckduckgo", "brave", "google", "bing"] as const;
export type PrivateBrowserSearchEngine = (typeof PRIVATE_BROWSER_SEARCH_ENGINES)[number];
export const DEFAULT_PRIVATE_BROWSER_SEARCH_ENGINE: PrivateBrowserSearchEngine = "google";

export const PRIVATE_BROWSER_SEARCH_ENGINE_PRESENTATIONS: readonly {
  id: PrivateBrowserSearchEngine;
  label: string;
  host: string;
}[] = [
  { id: "duckduckgo", label: "DuckDuckGo", host: "duckduckgo.com" },
  { id: "brave", label: "Brave Search", host: "search.brave.com" },
  { id: "google", label: "Google", host: "google.com" },
  { id: "bing", label: "Bing", host: "bing.com" },
];

export function privateBrowserSearchUrl(engine: PrivateBrowserSearchEngine, query: string): string {
  const encoded = encodeURIComponent(query.trim());
  if (engine === "duckduckgo") return `https://duckduckgo.com/?q=${encoded}`;
  if (engine === "brave") return `https://search.brave.com/search?q=${encoded}`;
  if (engine === "bing") return `https://www.bing.com/search?q=${encoded}`;
  return `https://www.google.com/search?q=${encoded}`;
}

export function normalizePrivateBrowserInput(
  value: string,
  engine: PrivateBrowserSearchEngine = DEFAULT_PRIVATE_BROWSER_SEARCH_ENGINE,
): string | null {
  const input = value.trim();
  if (!input) return null;

  if (/^https?:\/\//i.test(input)) {
    try {
      return new URL(input).toString();
    } catch {
      return null;
    }
  }
  // Refuse an explicit non-web scheme before treating text as a search.
  if (/^[a-z][a-z0-9+.-]*:/i.test(input) && !/^localhost:\d+/i.test(input)) return null;
  // A hostname/path gets the familiar https default. Free text becomes a
  // search without teaching the native boundary to accept arbitrary schemes.
  if (/^(?:localhost|(?:[a-z0-9-]+\.)+[a-z]{2,})(?::\d+)?(?:[/?#].*)?$/i.test(input)) {
    try {
      return new URL(`${/^localhost(?::|\/|$)/i.test(input) ? "http" : "https"}://${input}`).toString();
    } catch {
      return null;
    }
  }
  return privateBrowserSearchUrl(engine, input);
}

export function seedPrivateBrowserTab(tabId: string, url?: string): void {
  initialUrls.set(tabId, url?.trim() ? normalizePrivateBrowserInput(url) : null);
}

export function privateBrowserInitialUrl(tabId: string): string | null {
  return initialUrls.get(tabId) ?? null;
}

export function rememberPrivateBrowserUrl(tabId: string, url: string): void {
  const normalized = normalizePrivateBrowserInput(url);
  if (normalized) initialUrls.set(tabId, normalized);
}

export function forgetPrivateBrowserTab(tabId: string): void {
  initialUrls.delete(tabId);
}
