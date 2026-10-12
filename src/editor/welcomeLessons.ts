import catalog from "../assets/welcome.json";
import { PLATFORM, type Platform } from "../lib/featurePolicy";

interface WelcomeEntry {
  id: string;
  title: string;
  purpose: string;
  filename: string;
  body: string;
  webReplacements?: readonly { desktop: string; web: string }[];
}

/** The one catalog: the root welcome note first, then the three lessons in the
 * order the Welcome folder in Main lists them. Rust seeds the same JSON
 * natively (and writes entry 0 at the vault root); the browser twin seeds it in
 * memory. */
export function welcomeCatalogForPlatform(platform: Platform): readonly WelcomeEntry[] {
  if (platform === "desktop") return catalog;
  return catalog.map((entry) => ({
    ...entry,
    body: (entry.webReplacements ?? []).reduce((body, replacement) => {
      if (!body.includes(replacement.desktop)) {
        throw new Error(`Welcome web wording is stale for ${entry.id}: ${replacement.desktop}`);
      }
      return body.replace(replacement.desktop, replacement.web);
    }, entry.body),
  }));
}

export const WELCOME_CATALOG: readonly WelcomeEntry[] = welcomeCatalogForPlatform(PLATFORM);
export const WELCOME_NOTE: WelcomeEntry = WELCOME_CATALOG[0]!;
export const WELCOME_LESSONS: readonly WelcomeEntry[] = WELCOME_CATALOG.slice(1);
