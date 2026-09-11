import catalog from "../assets/welcome.json";

interface WelcomeEntry {
  id: string;
  title: string;
  purpose: string;
  filename: string;
  body: string;
}

/** The one catalog: the root welcome note first, then the nine lessons in the
 * order the Welcome folder in Main lists them. Rust seeds the same JSON
 * natively (and writes entry 0 at the vault root); the browser twin seeds it in
 * memory. */
export const WELCOME_CATALOG: readonly WelcomeEntry[] = catalog;
export const WELCOME_NOTE: WelcomeEntry = WELCOME_CATALOG[0]!;
export const WELCOME_LESSONS: readonly WelcomeEntry[] = WELCOME_CATALOG.slice(1);
