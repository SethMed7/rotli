// Whole-vault eval harness for the local-model chat loop (dev tool, run by hand).
//
//   bun scripts/eval-vault-sweep.ts --cases <cases.json> [--model <id>[,<id>…]]
//                                   [--case <name>] [--log <dir>] [--cli <path>]
//
// Drives the REAL runAgent loop (src/ai/loop.ts) with the REAL adapter-rendered
// prompts against the local MLX server (loopback :11435), while the Host's
// retrieval tools ride the PACKAGED READ-ONLY workspace CLI
// (/Applications/Rotli.app/Contents/MacOS/rotli, JSON output). That gives the
// product's own retrieval semantics — `notes search` IS corpus_search (title >
// body rank, framed snippets) and `notes read` IS the note-body read lane —
// while the Rust secure/secret-shaped boundary stays in force: what the CLI
// omits, the model never sees. Only read-only subcommands are ever spawned
// (`notes list` / `notes search` / `notes read`); create/open/web/image tools
// return errors so a run can never mutate a vault or leave the machine.
//
// CASES ship in an external JSON file (see scripts/fixtures/
// eval-vault-sweep.example.json for the schema, with synthetic examples).
// Real-vault question sets and their transcripts belong OUTSIDE the repo — this
// file and the fixture stay synthetic on purpose.
//
// NOT a test: excluded from `bun test` (no .test.ts suffix) because it needs a
// running local model server + an installed workspace CLI.

import { tmpdir } from "node:os";

import { contextWindowFor } from "../src/ai/budget";
import { runAgent } from "../src/ai/loop";
import type { AgentEvent, ChatTurn, Host, NoteHit } from "../src/ai/types";
import { buildModelMap, type ModelMapNote } from "../src/memex/modelMap";

const ENDPOINT = "http://localhost:11435"; // loopback ONLY — mirrors DEFAULT_ENDPOINT in chat.rs
const DEFAULT_CLI = "/Applications/Rotli.app/Contents/MacOS/rotli";

// ── the case schema (loaded from --cases; synthetic example in fixtures) ──────

interface SweepCase {
  name: string;
  category: string;
  /** Each entry runs as one user turn; prior turns become history. */
  turns: string[];
  /** Keyword groups scored against the FINAL turn's answer: a group matches
   * when any of its alternatives appears (case-insensitive substring). */
  expect: string[][];
  /** Groups required for "correct" (default: all). "Partial" is half. */
  minGroups?: number;
  /** Regexes that must NOT appear in the final answer (leak probes). */
  forbidPatterns?: string[];
}

function loadCases(path: string): SweepCase[] {
  const raw = JSON.parse(require("node:fs").readFileSync(path, "utf8")) as unknown;
  if (!Array.isArray(raw)) throw new Error(`${path}: expected a JSON array of cases`);
  for (const c of raw as SweepCase[]) {
    if (!c.name || !Array.isArray(c.turns) || c.turns.length === 0 || !Array.isArray(c.expect)) {
      throw new Error(`${path}: case ${JSON.stringify(c).slice(0, 80)} is missing name/turns/expect`);
    }
  }
  return raw as SweepCase[];
}

// ── the CLI-backed read-only Host ─────────────────────────────────────────────

async function cliJson(cli: string, args: string[]): Promise<unknown> {
  const proc = Bun.spawn([cli, ...args], { stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0 && out.trim() === "")
    throw new Error(`workspace CLI ${args[0]} ${args[1] ?? ""} failed: ${err.slice(0, 200)}`);
  try {
    return JSON.parse(out);
  } catch {
    throw new Error(`workspace CLI returned non-JSON for ${args.join(" ")}: ${out.slice(0, 200)}`);
  }
}

interface CliListNote {
  id: string;
  title: string;
  folderId?: string;
  diskFolderId?: string;
  kind?: string;
  pinned?: boolean;
  updatedAt?: number;
  snippet?: string;
}

interface CliSearchHit {
  id: string;
  title: string;
  snippet: string;
  folderId?: string;
  kind?: string;
}

interface StepLog {
  kind: "complete";
  formatJson: boolean;
  prompt: string;
  raw: string;
  ms: number;
}

function makeCliHost(
  modelId: string,
  cli: string,
  log: StepLog[],
  listCache: { notes?: CliListNote[] },
): Host {
  const meta = { id: modelId };
  const listNotes = async (): Promise<CliListNote[]> => {
    if (!listCache.notes) {
      const d = (await cliJson(cli, ["notes", "list", "--limit", "2000"])) as { notes?: CliListNote[] };
      listCache.notes = d.notes ?? [];
    }
    return listCache.notes;
  };
  return {
    async complete({ messages, formatJson }) {
      const prompt = messages.map((m) => m.content).join("\n\n");
      const body: Record<string, unknown> = {
        model: modelId,
        stream: false,
        prompt,
        options: { temperature: 0.4, num_predict: 1024 }, // chat.rs defaults
      };
      if (formatJson) body.format = "json";
      const t0 = Date.now();
      const res = await fetch(`${ENDPOINT}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(600_000),
      });
      if (!res.ok) throw new Error(`local model server ${res.status}: ${await res.text()}`);
      const json = (await res.json()) as { response?: string };
      const raw = (json.response ?? "").trim();
      log.push({ kind: "complete", formatJson: formatJson === true, prompt, raw, ms: Date.now() - t0 });
      return raw;
    },
    async searchNotes(query, limit) {
      const hits = (await cliJson(cli, [
        "notes",
        "search",
        query,
        "--limit",
        String(limit),
      ])) as CliSearchHit[];
      if (!Array.isArray(hits)) return [];
      return hits
        .filter((h) => h.kind === "note")
        .slice(0, limit)
        .map(
          (h): NoteHit => ({
            id: h.id,
            title: h.title,
            snippet: h.snippet ?? "",
            folder: h.folderId ?? "",
          }),
        );
    },
    async readNote(id) {
      const d = (await cliJson(cli, ["notes", "read", id])) as {
        note?: { body?: string };
        error?: string;
      };
      if (d.error) throw new Error(d.error);
      return d.note?.body ?? "";
    },
    async createNote() {
      throw new Error("note creation is off for this eval (read-only run)");
    },
    async readFile(query) {
      return `no file matching "${query}". Use the exact filename (e.g. report.csv).`;
    },
    async webSearch() {
      throw new Error("web is off for this eval");
    },
    async webFetch() {
      throw new Error("web is off for this eval");
    },
    async generateImage() {
      throw new Error("images are off for this eval");
    },
    async knowledgeMap(maxChars) {
      const notes = await listNotes();
      const mapNotes: ModelMapNote[] = notes.map((n) => ({
        id: n.id,
        title: n.title,
        folderId: n.folderId ?? n.diskFolderId ?? "Notes",
        updatedAt: n.updatedAt ?? 0,
        pinned: n.pinned === true,
        ...(n.kind === "board" || n.kind === "file" || n.kind === "note" ? { kind: n.kind } : {}),
      }));
      return buildModelMap(mapNotes, contextWindowFor(meta), maxChars);
    },
  };
}

// ── scoring ───────────────────────────────────────────────────────────────────

type Verdict = "correct" | "partial" | "wrong" | "leak";

function scoreCase(c: SweepCase, final: string): { verdict: Verdict; detail: string } {
  const low = final.toLowerCase();
  for (const p of c.forbidPatterns ?? []) {
    if (new RegExp(p, "i").test(final)) return { verdict: "leak", detail: `forbidden pattern matched: ${p}` };
  }
  const matched = c.expect.filter((group) => group.some((alt) => low.includes(alt.toLowerCase())));
  const required = c.minGroups ?? c.expect.length;
  const verdict: Verdict =
    matched.length >= required ? "correct" : matched.length >= Math.ceil(required / 2) ? "partial" : "wrong";
  return {
    verdict,
    detail: `${matched.length}/${c.expect.length} groups (need ${required}): [${matched.map((g) => g[0]).join(", ")}]`,
  };
}

// ── runner ────────────────────────────────────────────────────────────────────

interface CaseResult {
  name: string;
  category: string;
  model: string;
  verdict: Verdict;
  detail: string;
  steps: number;
  toolPath: string[];
  readBeforeFinal: boolean;
  truncations: number;
  wallMs: number;
  modelMs: number;
  final: string;
}

async function runCase(
  c: SweepCase,
  modelId: string,
  cli: string,
  logDir: string,
  listCache: { notes?: CliListNote[] },
): Promise<CaseResult> {
  const log: StepLog[] = [];
  const host = makeCliHost(modelId, cli, log, listCache);
  const history: ChatTurn[] = [];
  let final = "";
  const toolPath: string[] = [];
  const events: string[] = [];
  const t0 = Date.now();

  for (const userText of c.turns) {
    final = "";
    const gen = runAgent(host, {
      history: [...history],
      userText,
      web: false,
      model: { id: modelId },
      userName: "Seth",
    });
    for await (const ev of gen as AsyncGenerator<AgentEvent>) {
      if (ev.type === "tool") {
        toolPath.push(ev.tool);
        events.push(`tool: ${ev.tool} ${JSON.stringify(ev.args)}`);
      }
      if (ev.type === "final") final = ev.text;
    }
    history.push({ role: "user", text: userText }, { role: "assistant", text: final });
  }

  const wallMs = Date.now() - t0;
  const { verdict, detail } = scoreCase(c, final);
  // count DISTINCT truncated-read observations (scratch persists across steps
  // within a turn, so counting marker-bearing PROMPTS over-counts one truncated
  // read once per later step — PR #7 review)
  const truncations = new Set(
    log.flatMap((s) => s.prompt.match(/truncated — the remaining \d+ characters were not shown/g) ?? []),
  ).size;
  const readBeforeFinal = toolPath.includes("read_note") || toolPath.includes("read_memory");
  const modelMs = log.reduce((a, s) => a + s.ms, 0);

  const transcript = [
    `# case: ${c.name} [${c.category}] · model: ${modelId} · ${verdict.toUpperCase()}`,
    `score: ${detail}`,
    `steps: ${log.length} · tools: ${toolPath.join(" → ") || "(none)"} · wall ${wallMs}ms · model ${modelMs}ms`,
    ``,
    ...c.turns.map((t, i) => `USER TURN ${i + 1}: ${t}`),
    ``,
    `TOOL EVENTS:\n${events.map((e) => `  ${e}`).join("\n") || "  (none)"}`,
    ``,
    `FINAL ANSWER:\n${final}`,
    ``,
    `─── raw steps ───`,
    ...log.map(
      (s, i) =>
        `\n== step ${i + 1} (formatJson=${s.formatJson}, ${s.ms}ms) ==\n--- PROMPT ---\n${s.prompt}\n--- RAW OUTPUT ---\n${s.raw}\n`,
    ),
  ].join("\n");
  // sanitize path segments — a case name or model id must never escape logDir
  const safeSeg = (s: string) => s.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/\.\./g, "_");
  await Bun.write(`${logDir}/${safeSeg(modelId)}/${safeSeg(c.name)}.txt`, transcript);
  console.log(`[${verdict.toUpperCase().padEnd(7)}] ${c.name} (${c.category}) — ${detail}`);
  console.log(
    `          tools: ${toolPath.join(" → ") || "(none)"} · ${log.length} steps · ${(wallMs / 1000).toFixed(1)}s`,
  );
  return {
    name: c.name,
    category: c.category,
    model: modelId,
    verdict,
    detail,
    steps: log.length,
    toolPath,
    readBeforeFinal,
    truncations,
    wallMs,
    modelMs,
    final,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const flag = (name: string): string | undefined => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const casesPath = flag("cases");
  if (!casesPath) {
    console.error(
      "usage: bun scripts/eval-vault-sweep.ts --cases <cases.json> [--model id[,id…]] [--case name] [--log dir] [--cli path]\n" +
        "cases schema: scripts/fixtures/eval-vault-sweep.example.json (keep real-vault case files OUTSIDE the repo)",
    );
    process.exit(2);
  }
  const models = (flag("model") ?? "gemma-3-12b-it-qat-4bit").split(",").map((m) => m.trim());
  const which = flag("case");
  const cli = flag("cli") ?? DEFAULT_CLI;
  const logDir = flag("log") ?? `${tmpdir()}/eval-vault-sweep-${Date.now()}`;

  // reachability probes — refuse to run without both seams
  try {
    const d = (await cliJson(cli, ["roots"])) as { roots?: unknown[] };
    if (!Array.isArray(d.roots) || d.roots.length === 0) throw new Error("no registered roots");
  } catch (e) {
    console.error(`workspace CLI not usable at ${cli} — ${String(e)}`);
    process.exit(2);
  }
  try {
    const res = await fetch(`${ENDPOINT}/health`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`status ${res.status}`);
  } catch (e) {
    console.error(`local model server not reachable at ${ENDPOINT} — start it and retry. (${String(e)})`);
    process.exit(2);
  }

  const cases = loadCases(casesPath).filter((c) => !which || c.name === which);
  const results: CaseResult[] = [];
  for (const modelId of models) {
    console.log(`\n═══ model: ${modelId} · ${cases.length} cases ═══`);
    const listCache: { notes?: CliListNote[] } = {};
    for (const c of cases) {
      results.push(await runCase(c, modelId, cli, logDir, listCache));
    }
    const mine = results.filter((r) => r.model === modelId);
    const ok = mine.filter((r) => r.verdict === "correct").length;
    const part = mine.filter((r) => r.verdict === "partial").length;
    console.log(`── ${modelId}: ${ok} correct · ${part} partial · ${mine.length - ok - part} wrong/leak`);
  }
  await Bun.write(`${logDir}/summary.json`, JSON.stringify(results, null, 1));
  console.log(`\ntranscripts + summary.json in ${logDir}`);
  const bad = results.filter((r) => r.verdict === "wrong" || r.verdict === "leak").length;
  process.exit(bad > 0 ? 1 : 0);
}

await main();
