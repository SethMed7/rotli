// Web-address normalization shared by every surface that opens a typed
// address: the Breve watchlist's website field and Markdown links. Pure.

/** Accepts a bare domain or an http/https URL; returns the canonical URL. */
export function normalizedWebsite(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(candidate);
    if ((parsed.protocol !== "https:" && parsed.protocol !== "http:") || !parsed.hostname) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}
