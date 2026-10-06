// The feature catalog's honesty (site/src/features.ts, behind /features/ and its pages): every
// capability marked Shipped quotes README.md or a released CHANGELOG.md section, Docs and Sheets
// carry DOCS_AND_SHEETS' word, and everything not shipped is an "In the work" item of
// ROADMAP.md, never marked Shipped. Pictures and links must point at something the site has.
import { beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const read = (...parts: string[]) => readFileSync(join(root, ...parts), "utf8");
const site = (...parts: string[]) => join(root, "site", "src", ...parts);
const flat = (text: string) => text.replace(/\s+/g, " ");

type Status = "Shipped" | "Beta" | "In development" | "Coming soon";
interface Feature {
  id: string;
  area: string;
  name: string;
  line: string;
  status: Status;
  picture?: { kind: string; src?: string };
  links: { href: string; label: string }[];
  basis?: { file: "README.md" | "CHANGELOG.md"; quote: string }[];
  roadmap?: string;
  next?: string;
  needsWebApp?: true;
}

// the site's modules stay out of the root typecheck: computed paths, typed here
let features: {
  ALL_FEATURES: readonly Feature[];
  AREAS: { id: string }[];
  visibleFeatures(): Feature[];
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
      expect(feature.roadmap, `${feature.id} is Shipped but cites a roadmap item`).toBeUndefined();
      for (const { file, quote } of feature.basis!) {
        const text = file === "README.md" ? readme : changelog;
        expect(text.includes(flat(quote)), `${feature.id}: "${quote}" is not in ${file}`).toBe(true);
      }
    }
  });

  test("Docs and Sheets say Beta the one way the site says it", () => {
    const beta = features.ALL_FEATURES.filter(
      (f) => f.roadmap === "docs-beta" || f.roadmap === "sheets-beta",
    );
    expect(beta.map((f) => f.id).sort()).toEqual(["docs", "sheets"]);
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
      expect(feature.roadmap, `${feature.id} is ${feature.status} without a roadmap item`).toBeDefined();
      expect(inTheWork, `${feature.id}: "${feature.roadmap}" is not under In the work`).toContain(
        feature.roadmap!,
      );
    }
  });

  test("only the next release's items are Coming soon", () => {
    const soon = features.ALL_FEATURES.filter((f) => f.status === "Coming soon").map((f) => f.roadmap);
    expect(soon.sort()).toEqual(["ai-inline", "charts", "chat-attachments"]);
  });

  test("the launch site never lists what is still in development", () => {
    const shown = features.visibleFeatures();
    expect(shown.some((f) => f.status === "In development")).toBe(false);
    expect(shown.length).toBeGreaterThan(20);
  });

  test("every capture exists, and every guide or post linked is published", () => {
    for (const feature of features.ALL_FEATURES) {
      if (feature.picture?.src) {
        expect(existsSync(join(root, "site", "public", feature.picture.src)), feature.picture.src).toBe(true);
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
