// The header's star count (the owner, 2026-10-06: "up top I want github with star count").
//
// The visitor's browser never calls GitHub: the count is read once, while the site is BUILT,
// from GitHub's public API, and written into the pages as text. The header's link is a plain
// <a> to the repository with no script, iframe, or image from GitHub, so the site's CSP and the
// privacy page's "This website" stay true.
//
// One request per build: the result is a module-level promise, shared by every page Astro
// renders in the same process, and never written to the repository. No token is needed; if
// GITHUB_TOKEN is in the build's environment it is sent for a higher rate limit and never
// logged. Any failure (no network, a timeout, a non-200, an unexpected body) renders the link
// without a number and never fails the build.
//
// SITE_GITHUB_STARS overrides the request: a whole number is used as the count (the E2E build
// and offline builds), "off" shows no number. Anything else, or unset, asks GitHub.

export const GITHUB_API_REPO = 'https://api.github.com/repos/SethMed7/rotli';
const TIMEOUT_MS = 3000;

type Fetch = (url: string, init: RequestInit) => Promise<Response>;
type Env = Record<string, string | undefined>;

export interface StarOptions {
  fetch?: Fetch;
  env?: Env;
  timeoutMs?: number;
  warn?: (message: string) => void;
}

/** The repository's star count, or null when it can't be read. Never throws. */
export async function fetchStarCount(options: StarOptions = {}): Promise<number | null> {
  const env = options.env ?? process.env;
  const warn = options.warn ?? ((message: string) => console.warn(message));
  const override = (env.SITE_GITHUB_STARS ?? '').trim();
  if (override === 'off') return null;
  if (/^\d+$/.test(override)) return Number(override);

  const token = (env.GITHUB_TOKEN ?? '').trim();
  const headers: Record<string, string> = {
    accept: 'application/vnd.github+json',
    'user-agent': 'rotli-site-build',
  };
  if (token) headers.authorization = `Bearer ${token}`;
  try {
    const response = await (options.fetch ?? fetch)(GITHUB_API_REPO, {
      headers,
      signal: AbortSignal.timeout(options.timeoutMs ?? TIMEOUT_MS),
    });
    if (!response.ok) {
      warn(`[site] GitHub star count unavailable (HTTP ${response.status}); the header shows the link without a number.`);
      return null;
    }
    const body = (await response.json()) as { stargazers_count?: unknown };
    const count = body?.stargazers_count;
    if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) {
      warn('[site] GitHub star count unavailable (unexpected response); the header shows the link without a number.');
      return null;
    }
    return count;
  } catch (error) {
    // The error's name only (TimeoutError, TypeError, SyntaxError): never a header or the token.
    const reason = error instanceof Error ? error.name : 'error';
    warn(`[site] GitHub star count unavailable (${reason}); the header shows the link without a number.`);
    return null;
  }
}

/** 5 → "5", 1234 → "1.2k", 123 456 → "123k", 1 250 000 → "1.3m". */
export function formatStarCount(count: number): string {
  if (count < 1000) return String(count);
  const thousands = count < 100_000 ? Math.round(count / 100) / 10 : Math.round(count / 1000);
  if (thousands < 1000) return `${String(thousands)}k`;
  return `${String(Math.round(count / 100_000) / 10)}m`;
}

let once: Promise<number | null> | null = null;

/** The count for this build, asked for at most once. */
export function buildStarCount(): Promise<number | null> {
  once ??= fetchStarCount();
  return once;
}
