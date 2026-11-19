// check:web-ai-rows-mutation — proves the web AI corpus's row test catches
// the bug it exists for. The third review of pull request 267 (2026-11-09) noted that
// the source-text guard ("no web AI row is spread from a summary or a hit")
// was removed to keep the source-shape ceiling, and that a reviewer's
// mutation (`{ ...summary, title, snippet }`: a row spread from the stale
// summary, with only the fields someone thought of replaced) must still fail
// a test. This copies src/ to a scratch folder, applies each mutation there
// (never to the working tree), runs src/services/webAiCorpus.test.ts, and
// fails unless the unmutated copy passes and every mutant fails.
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TARGET = "src/services/webAiCorpus.ts";
const TEST = "src/services/webAiCorpus.test.ts";

/** Each mutant: the exact text it replaces, and the bug it plants. */
export const MUTANTS = [
  {
    name: "a list row spread from the stale summary",
    from: "return read.flatMap((note) => (note ? [meta(note)] : []));",
    to: "return read.flatMap((note, index) => (note ? [{ ...visible[index]!, title: note.title, snippet: note.snippet }] : []));",
  },
  {
    name: "a search hit spread from the stale hit",
    from: "        const hit = note && hitOf(note, query);\n        return hit ? [hit] : [];",
    to: "        const hit = note && hitOf(note, query);\n        return hit ? [{ ...hits[read.indexOf(note)]!, title: hit.title, snippet: hit.snippet }] : [];",
  },
];

/** Apply one mutant to a source; throws when its text is gone (update this script). */
export function mutate(source, mutant) {
  if (!source.includes(mutant.from))
    throw new Error(`mutant "${mutant.name}": its text is no longer in ${TARGET}`);
  return source.replace(mutant.from, mutant.to);
}

function scratchCopy(root) {
  const dir = mkdtempSync(join(tmpdir(), "rotli-mutation-"));
  cpSync(join(root, "src"), join(dir, "src"), { recursive: true });
  for (const file of ["package.json", "tsconfig.json", "bunfig.toml", "test-setup.ts"]) {
    if (existsSync(join(root, file))) cpSync(join(root, file), join(dir, file));
  }
  symlinkSync(join(root, "node_modules"), join(dir, "node_modules"));
  return dir;
}

function passes(dir) {
  // the child gets no inherited GIT_* (nothing here runs git, and none may leak)
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
  const run = Bun.spawnSync(["bun", "test", TEST], { cwd: dir, env, stdout: "pipe", stderr: "pipe" });
  return run.exitCode === 0;
}

/** Every failure: the unmutated copy must pass, and each mutant must fail. */
export function mutationFailures(root) {
  const dir = scratchCopy(root);
  const failures = [];
  try {
    const original = readFileSync(join(dir, TARGET), "utf8");
    if (!passes(dir)) failures.push(`${TEST} fails on an unmutated copy: fix it first`);
    for (const mutant of MUTANTS) {
      writeFileSync(join(dir, TARGET), mutate(original, mutant));
      if (passes(dir)) failures.push(`${TEST} still passes with ${mutant.name}; it no longer guards that`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return failures;
}

if (import.meta.main) {
  const failures = mutationFailures(process.env.ROTLI_CHECK_ROOT ?? process.cwd());
  if (failures.length) {
    console.error(`check:web-ai-rows-mutation failed:\n${failures.map((f) => `  - ${f}`).join("\n")}`);
    process.exit(1);
  }
  console.log(`check:web-ai-rows-mutation ok — ${MUTANTS.length} mutants, each caught by ${TEST}`);
}
