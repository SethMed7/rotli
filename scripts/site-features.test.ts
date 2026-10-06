// The feature catalog's honesty (site/src/features.ts, behind /features/ and its pages): every
// capability marked Shipped quotes README.md or a released CHANGELOG.md section, Docs and Sheets
// carry DOCS_AND_SHEETS' word, and everything not shipped is an "In the work" item of
// ROADMAP.md, never marked Shipped. Pictures and links must point at something the site has.
// The availability line ("Available on Mac and Web") is built in one place and never claims a
// platform rotli has no app for, and every address the 2026-10-06 condensing retired redirects
// (Astro's refresh pages and the Caddyfile, from one map).
import { beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const read = (...parts: string[]) => readFileSync(join(root, ...parts), "utf8");
const site = (...parts: string[]) => join(root, "site", "src", ...parts);
const flat = (text: string) => text.replace(/\s+/g, " ");

type Status = "Shipped" | "Beta" | "In development" | "Coming soon";
type Platform = "Mac" | "Windows" | "Linux" | "Web";
interface Feature {
  id: string;
  area: string;
  name: string;
  line: string;
  status: Status;
  runs: "mac" | "both" | "web";
  picture?: { kind: string; src?: string };
  sections?: { id: string; title: string; picture?: { kind: string; src?: string } }[];
  formerly?: string[];
  links: { href: string; label: string }[];
  basis?: { file: "README.md" | "CHANGELOG.md"; quote: string }[];
  roadmap?: string | string[];
  next?: string;
  needsWebApp?: true;
}

// the site's modules stay out of the root typecheck: computed paths, typed here
let features: {
  ALL_FEATURES: readonly Feature[];
  AREAS: { id: string }[];
  visibleFeatures(): Feature[];
  roadmapIds: (feature: Feature) => string[];
  movedFrom: (features: readonly Feature[]) => Record<string, string>;
  availability: (status: Status, platforms: readonly Platform[]) => string;
  platformsFor: (runs: Feature["runs"], webAppEnabled: boolean) => Platform[];
};
let siteModule: { DOCS_AND_SHEETS: { status: string } };
let inTheWork: string[];

// Released history only: everything below the first numbered release heading.
const changelog = flat(
  read("CHANGELOG.md")
    .split(/^## \[\d/m)
    .slice(1)
    .join(" "),
);
const readme = flat(read("README.md"));

beforeAll(async () => {
  // The same build as scripts/site-agents.test.ts: test files share one module cache.
  process.env.SITE_MODE = "full";
  process.env.SITE_URL = "https://rotli.co";
  process.env.SOURCE_REPOSITORY_PUBLIC = "true";
  features = (await import(site("features.ts"))) as typeof features;
  siteModule = (await import(site("site.ts"))) as typeof siteModule;
  const roadmap = (await import(site("roadmap.ts"))) as {
    parseRoadmap(markdown: string): { title: string; items: { id: string }[] }[];
  };
  const sections = roadmap.parseRoadmap(read("ROADMAP.md"));
  inTheWork = sections.find((section) => section.title === "In the work")!.items.map((item) => item.id);
});

describe("the feature catalog", () => {
  test("ids are unique, URL-safe, and in a known area", () => {
    const ids = features.ALL_FEATURES.map((feature) => feature.id);
    expect(new Set(ids).size).toBe(ids.length);
    const areas = features.AREAS.map((area) => area.id);
    for (const feature of features.ALL_FEATURES) {
      expect(feature.id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(areas).toContain(feature.area);
      expect(feature.line.length).toBeGreaterThan(0);
    }
  });

  test("every Shipped capability quotes README.md or a released CHANGELOG.md entry", () => {
    for (const feature of features.ALL_FEATURES.filter((f) => f.status === "Shipped")) {
      expect(feature.basis?.length, `${feature.id} has no basis`).toBeGreaterThan(0);
      expect(features.roadmapIds(feature), `${feature.id} is Shipped but cites a roadmap item`).toEqual([]);
      for (const { file, quote } of feature.basis!) {
        const text = file === "README.md" ? readme : changelog;
        expect(text.includes(flat(quote)), `${feature.id}: "${quote}" is not in ${file}`).toBe(true);
      }
    }
  });

  test("Docs and Sheets say Beta the one way the site says it", () => {
    // One entry since 2026-10-06 ("Word and Excel files"), naming both roadmap items.
    const beta = features.ALL_FEATURES.filter((f) =>
      features.roadmapIds(f).some((id) => id === "docs-beta" || id === "sheets-beta"),
    );
    expect(beta.map((f) => f.id)).toEqual(["docs"]);
    expect(features.roadmapIds(beta[0]!)).toEqual(["docs-beta", "sheets-beta"]);
    expect(beta[0]!.sections?.map((s) => s.id)).toEqual(["sheets"]);
    for (const feature of beta) expect(feature.status).toBe(siteModule.DOCS_AND_SHEETS.status as Status);
    // Nothing else may claim Beta: the word belongs to DOCS_AND_SHEETS (src/site.ts).
    expect(features.ALL_FEATURES.filter((f) => f.status === "Beta").length).toBe(beta.length);
  });

  test("nothing in the work is marked Shipped, and everything not shipped is in the work", () => {
    for (const feature of features.ALL_FEATURES) {
      if (feature.status === "Shipped") {
        // A shipped feature may share its id with the item that carries it further (Hand to AI
        // shipped; its Refined mode is in the work), but only by saying so with `next`.
        if (inTheWork.includes(feature.id)) expect(feature.next, feature.id).toBe(feature.id);
        if (feature.next) expect(inTheWork, `${feature.id}: next "${feature.next}"`).toContain(feature.next);
        continue;
      }
      const ids = features.roadmapIds(feature);
      expect(ids.length, `${feature.id} is ${feature.status} without a roadmap item`).toBeGreaterThan(0);
      for (const id of ids)
        expect(inTheWork, `${feature.id}: "${id}" is not under In the work`).toContain(id);
    }
  });

  test("only the next release's items are Coming soon", () => {
    const soon = features.ALL_FEATURES.filter((f) => f.status === "Coming soon").flatMap(features.roadmapIds);
    expect([...soon].sort((a: string, b: string) => a.localeCompare(b))).toEqual([
      "ai-inline",
      "charts",
      "chat-attachments",
    ]);
  });

  test("the launch site never lists what is still in development, and the list stays condensed", () => {
    const shown = features.visibleFeatures();
    expect(shown.some((f) => f.status === "In development")).toBe(false);
    // The owner, 2026-10-06: "condense the list". Rotli Web adds one entry when it is offered.
    expect(shown.length).toBeGreaterThanOrEqual(14);
    expect(shown.length).toBeLessThanOrEqual(20);
  });

  test("every capture exists, and every guide or post linked is published", () => {
    for (const feature of features.ALL_FEATURES) {
      for (const picture of [feature.picture, ...(feature.sections ?? []).map((s) => s.picture)]) {
        if (!picture?.src) continue;
        expect(existsSync(join(root, "site", "public", picture.src)), picture.src).toBe(true);
      }
      for (const { href } of feature.links) {
        const writing = href.match(/^\/(resources|blog)\/([a-z0-9-]+)\/$/);
        if (!writing || writing[2] === "developers") continue;
        const folder = writing[1] === "blog" ? "posts" : "resources";
        const file = join(root, "site", "src", "content", "writing", folder, `${writing[2]}.md`);
        expect(existsSync(file), href).toBe(true);
        expect(readFileSync(file, "utf8")).not.toMatch(
          /^(status: coming-soon|draft: true|experiment: true)$/m,
        );
      }
    }
  });
});

describe("the availability line", () => {
  test("says where a feature is available, in the owner's words", () => {
    const { availability } = features;
    expect(availability("Shipped", ["Mac", "Web"])).toBe("Available on Mac and Web");
    expect(availability("Shipped", ["Mac"])).toBe("Available on Mac");
    expect(availability("Shipped", ["Web"])).toBe("Available on Web");
    expect(availability("Shipped", ["Web", "Windows", "Mac"])).toBe("Available on Mac, Windows and Web");
    expect(availability("Shipped", ["Linux", "Mac", "Windows", "Web"])).toBe(
      "Available on Mac, Windows, Linux and Web",
    );
    expect(availability("Beta", ["Mac"])).toBe("Beta on Mac");
    expect(availability("Beta", ["Mac", "Web"])).toBe("Beta on Mac and Web");
    expect(availability("Coming soon", ["Mac"])).toBe("Coming soon to Mac");
    expect(availability("In development", ["Mac", "Web"])).toBe("In development");
  });

  test("names Web only while Rotli Web is offered, and never Windows or Linux", () => {
    const { platformsFor } = features;
    expect(platformsFor("both", true)).toEqual(["Mac", "Web"]);
    expect(platformsFor("web", true)).toEqual(["Web"]);
    expect(platformsFor("mac", true)).toEqual(["Mac"]);
    for (const runs of ["both", "web", "mac"] as const) expect(platformsFor(runs, false)).toEqual(["Mac"]);
    // No entry can claim a platform rotli has no app for: `runs` has no Windows or Linux.
    for (const feature of features.ALL_FEATURES) {
      for (const web of [true, false]) {
        const platforms = platformsFor(feature.runs, web);
        expect(platforms.includes("Windows") || platforms.includes("Linux"), feature.id).toBe(false);
      }
    }
  });
});

// The catalog was condensed on 2026-10-06: each entry folded into another is a section of the
// surviving page, its old id the anchor, and its old address redirects there.
describe("the folded entries' old addresses (2026-10-06)", () => {
  const FOLDED = {
    "tables-code-math": "/features/markdown/#tables-code-math",
    diagrams: "/features/markdown/#diagrams",
    links: "/features/search/#links",
    "slash-commands": "/features/templates/#slash-commands",
    themes: "/features/make-it-yours/",
    "panes-and-keys": "/features/make-it-yours/#panes-and-keys",
    "ask-the-librarian": "/features/librarian/#ask-the-librarian",
    "on-device-ai": "/features/connected-ai/#on-device-ai",
    sheets: "/features/docs/#sheets",
    "pictures-and-files": "/features/boards/#pictures-and-files",
    "open-a-folder": "/features/your-folder/#open-a-folder",
    "what-ai-may-change": "/features/secure-notes/#what-ai-may-change",
    "rotli-helper": "/features/rotli-web/#rotli-helper",
  };

  test("every retired id lands on its section, and none is a live entry's id", () => {
    expect(features.movedFrom(features.ALL_FEATURES)).toEqual(FOLDED);
    const live = new Set(features.ALL_FEATURES.map((f) => f.id));
    for (const old of Object.keys(FOLDED)) expect(live.has(old), old).toBe(false);
  });

  test("the Caddyfile answers every retired address with the same permanent redirect", () => {
    const caddy = readFileSync(join(root, "site", "Caddyfile"), "utf8");
    const answered: Record<string, string> = {};
    for (const [, path, to] of caddy.matchAll(/^\s*redir (\/features\/[a-z-]+)\/? (\S+) permanent$/gm)) {
      answered[path!.slice("/features/".length)] = to!;
    }
    for (const [, name, ids] of caddy.matchAll(
      /@(fold\w+) path_regexp \1 \^\/features\/\(([a-z|-]+)\)\/\?\$/g,
    )) {
      const redir = caddy.match(new RegExp(`redir @${name} "([^"]+)" permanent`))![1]!;
      for (const id of ids!.split("|")) answered[id] = redir.replace(`{re.${name}.1}`, id);
    }
    expect(answered).toEqual(FOLDED);
  });
});
