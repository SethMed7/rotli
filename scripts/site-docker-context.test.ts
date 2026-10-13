// The rotli.co image builds Rotli Web (`bun run build:web`, which type-checks
// src/ including its tests) from ONLY what site/Dockerfile's app stage copies.
// A src/ file importing outside that set builds everywhere but Railway
// (2026-10-12: src/lib/helperFakeCap.test.ts imported e2e/web/fake-helper and
// every rotli.co deploy failed until the Dockerfile copied e2e/).

import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize, relative } from "node:path";

const root = join(import.meta.dir, "..");

/** The repo paths the app stage copies into /repo (`COPY <src…> <dest>`). */
function appStageSources(): string[] {
  const dockerfile = readFileSync(join(root, "site/Dockerfile"), "utf8");
  const stage = dockerfile.slice(dockerfile.indexOf("AS app"), dockerfile.indexOf("RUN bun run build:web"));
  return [...stage.matchAll(/^COPY (?!--from)(.+)$/gm)].flatMap((m) =>
    m[1]!.trim().split(/\s+/).slice(0, -1),
  );
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(path);
  }
  return out;
}

test("every src/ import outside src/ resolves into what the site image copies", () => {
  // node_modules comes from the stage's own `bun ci`
  const copied = [...appStageSources(), "node_modules"];
  expect(copied).toContain("src");
  const misses: string[] = [];
  for (const file of sourceFiles(join(root, "src"))) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/(?:from|import\()\s*["'](\.{1,2}\/[^"']+)["']/g)) {
      const target = relative(root, normalize(join(dirname(file), m[1]!)));
      if (target.startsWith("src/") || target.startsWith("..")) continue;
      const covered = copied.some(
        (source) => target === source || target.startsWith(`${source.replace(/\/$/, "")}/`),
      );
      if (!covered) misses.push(`${relative(root, file)} → ${target}`);
    }
  }
  expect(misses).toEqual([]);
});
