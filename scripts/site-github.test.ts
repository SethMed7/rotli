// The header's GitHub star count (site/src/githubStars.ts), without a network: it is read once
// at build time from GitHub's API, any failure renders the link without a number (never a
// failed build), the optional token is sent but never logged, and the count reads short.
import { beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";

type Fetch = (url: string, init: RequestInit) => Promise<Response>;
let stars: {
  GITHUB_API_REPO: string;
  fetchStarCount(options?: {
    fetch?: Fetch;
    env?: Record<string, string | undefined>;
    timeoutMs?: number;
    warn?: (message: string) => void;
  }): Promise<number | null>;
  formatStarCount(count: number): string;
};

beforeAll(async () => {
  // a computed path keeps the site's sources out of the root typecheck
  stars = (await import(join(import.meta.dir, "..", "site", "src", "githubStars.ts"))) as typeof stars;
});

const TOKEN = "ghp_exampleTokenThatMustNeverBeLogged";

function run(fetch: Fetch, env: Record<string, string | undefined> = {}) {
  const warnings: string[] = [];
  const result = stars.fetchStarCount({ fetch, env, timeoutMs: 50, warn: (m) => warnings.push(m) });
  return { result, warnings };
}

describe("the star count is read once, at build time", () => {
  test("a 200 from the repository's API gives its stargazers_count", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const { result, warnings } = run(async (url, init) => {
      calls.push({ url, init });
      return Response.json({ stargazers_count: 5 });
    });
    expect(await result).toBe(5);
    expect(warnings).toEqual([]);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://api.github.com/repos/SethMed7/rotli");
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.authorization).toBeUndefined();
    expect(calls[0]!.init.signal).toBeInstanceOf(AbortSignal);
  });

  test("GITHUB_TOKEN is sent for the rate limit, and never appears in a warning", async () => {
    let sent = "";
    const ok = run(
      async (_url, init) => {
        sent = (init.headers as Record<string, string>).authorization ?? "";
        return Response.json({ stargazers_count: 7 });
      },
      { GITHUB_TOKEN: TOKEN },
    );
    expect(await ok.result).toBe(7);
    expect(sent).toBe(`Bearer ${TOKEN}`);

    const failed = run(async () => new Response("nope", { status: 401 }), { GITHUB_TOKEN: TOKEN });
    expect(await failed.result).toBeNull();
    expect(failed.warnings.join("\n")).not.toContain(TOKEN);
    const thrown = run(
      async () => {
        throw new Error(`boom ${TOKEN}`);
      },
      { GITHUB_TOKEN: TOKEN },
    );
    expect(await thrown.result).toBeNull();
    expect(thrown.warnings.join("\n")).not.toContain(TOKEN);
  });

  test("a non-200, a timeout, no network, or an odd body gives no number and one warning", async () => {
    const cases: Fetch[] = [
      async () => new Response("rate limited", { status: 403 }),
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
      async () => {
        throw new TypeError("fetch failed");
      },
      async () => new Response("<html>", { status: 200 }),
      async () => Response.json({}),
      async () => Response.json({ stargazers_count: "5" }),
      async () => Response.json({ stargazers_count: -1 }),
      async () => Response.json({ stargazers_count: 2.5 }),
    ];
    for (const fetch of cases) {
      const { result, warnings } = run(fetch);
      expect(await result).toBeNull();
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("without a number");
    }
  });

  test("SITE_GITHUB_STARS overrides the request: a number is used, 'off' shows none", async () => {
    let called = false;
    const fetch: Fetch = async () => {
      called = true;
      return Response.json({ stargazers_count: 1 });
    };
    expect(await run(fetch, { SITE_GITHUB_STARS: "1234" }).result).toBe(1234);
    expect(await run(fetch, { SITE_GITHUB_STARS: "off" }).result).toBeNull();
    expect(called).toBe(false);
    // anything else asks GitHub as usual
    expect(await run(fetch, { SITE_GITHUB_STARS: "lots" }).result).toBe(1);
    expect(called).toBe(true);
  });
});

describe("the count reads short", () => {
  test.each([
    [0, "0"],
    [5, "5"],
    [999, "999"],
    [1000, "1k"],
    [1234, "1.2k"],
    [1250, "1.3k"],
    [9_960, "10k"],
    [12_000, "12k"],
    [123_456, "123k"],
    [999_499, "999k"],
    [999_500, "1m"],
    [1_250_000, "1.3m"],
  ])("%d → %s", (count, text) => {
    expect(stars.formatStarCount(count)).toBe(text);
  });
});
