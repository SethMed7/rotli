/** Search-provider policy shared by settings, persistence, and the AI host.
 * The per-chat globe grants internet access; this vault setting chooses the
 * one destination used when that consent is on. */
export const WEB_SEARCH_PROVIDERS = [
  {
    id: "duckduckgo",
    label: "DuckDuckGo",
    detail: "Free · No account",
    needsKey: false,
  },
  {
    id: "brave",
    label: "Brave Search API",
    detail: "Bring your own API key",
    needsKey: true,
  },
] as const;

export type WebSearchProvider = (typeof WEB_SEARCH_PROVIDERS)[number]["id"];

export const DEFAULT_WEB_SEARCH_PROVIDER: WebSearchProvider = "duckduckgo";

export function parseWebSearchProvider(value: unknown): WebSearchProvider {
  return WEB_SEARCH_PROVIDERS.some((provider) => provider.id === value)
    ? (value as WebSearchProvider)
    : DEFAULT_WEB_SEARCH_PROVIDER;
}

export function webSearchProviderInfo(provider: WebSearchProvider) {
  return WEB_SEARCH_PROVIDERS.find((candidate) => candidate.id === provider)!;
}
