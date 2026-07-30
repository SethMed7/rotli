// Live eval harness for the local-model chat loop (dev tool, run by hand).
//
//   bun scripts/eval-local-chat.ts [--model <id>] [--case people|follow|decide|all] [--log <dir>]
//
// Drives the REAL runAgent loop (src/ai/loop.ts) with the REAL adapter-rendered
// prompts against the local MLX server (loopback :11435, the exact /api/generate
// wire shape Rust uses in src-tauri/src/chat.rs). The Host is a FIXTURE — a
// synthetic vault with a "who's who" index note whose wikilinks mix people and
// non-people — so no real memex is ever touched and nothing leaves the machine.
// Full prompts + raw model outputs per step are written to the log dir.
//
// NOT a test: excluded from `bun test` (no .test.ts suffix) because it needs a
// running local model server. The deterministic pins live in src/ai/*.test.ts.

import { runAgent } from "../src/ai/loop";
import { contextWindowFor } from "../src/ai/budget";
import { buildModelMap, type ModelMapNote } from "../src/memex/modelMap";
import type { AgentEvent, ChatTurn, Host, NoteHit } from "../src/ai/types";

const ENDPOINT = "http://localhost:11435"; // loopback ONLY — mirrors DEFAULT_ENDPOINT in chat.rs

// ── the fixture vault ─────────────────────────────────────────────────────────
// Mirrors the real failure: an index note under wiki/people whose frontmatter
// `links:` and body [[wikilinks]] mix PEOPLE with non-people (a canon note, a
// project), and whose body runs past the read_note budget.

interface FixtureNote {
  id: string;
  title: string;
  folderId: string;
  body: string;
  pinned?: boolean;
}

const PEOPLE = [
  "Marisol Medina",
  "Diego Medina",
  "Lucia Medina",
  "Roberto Medina",
  "Carmen Medina",
  "Ramon Ortega",
  "Priya Nair",
  "Devon Clarke",
  "Tom Becker",
  "Hana Kim",
  "Jake Moreno",
  "Elena Vasquez",
];
const NOT_PEOPLE = ["personal-canon", "caminorx", "myela-stage-plan"];

const whosWho = `---
id: 01JXF0M8Q2W7T9V4B6N1PEOPLE
created: 2026-05-02T09:11:00Z
updated: 2026-07-21T18:40:00Z
pinned: false
owner: seth
tags: [people, index, who-is-who]
links: [personal-canon, caminorx, myela-stage-plan, marisol-medina, ramon-ortega, tom-becker]
summary: Who's who in Seth's world — family, Myela colleagues, clients, friends.
---

# Who's who in Seth's world

The one index of every person that matters day to day. Values and background
live in [[personal-canon]]; the pilgrimage planning lives in [[caminorx]].

## Family

- [[Marisol Medina]] — Seth's wife. Runs the household calendar, teaches piano
  on Tuesdays and Thursdays, and is the reason the garden actually survives.
  Allergic to shellfish — every restaurant pick has to check the menu first.
- [[Diego Medina]] — son, 9. Obsessed with chess openings and Lego Technic;
  Saturday-morning chess club at the library. Wants a dog with alarming
  persistence.
- [[Lucia Medina]] — daughter, 6. Swim lessons Wednesday afternoons, currently
  in her dinosaur phase (Triceratops specifically, do not offer a T-Rex).
- [[Roberto Medina]] — Seth's father. Retired electrician in Tucson; calls on
  Sunday evenings; restoring a 1972 Ford pickup he refuses to sell.
- [[Carmen Medina]] — Seth's mother. Hosts the whole family every Christmas;
  her tamales are the standard every holiday gets judged against.

## Myela (work)

- [[Ramon Ortega]] — Myela CEO and Seth's boss. Prefers Loom updates over
  meetings; travels to Mexico City the first week of every month.
- [[Priya Nair]] — Lead product designer. Owns the Myela design system tokens;
  strong opinions on spacing scales; tea, never coffee.
- [[Devon Clarke]] — Senior backend engineer on the payments pillar. The TSYS
  integration historian — ask Devon before touching settlement code.

## Clients & collaborators

- [[Tom Becker]] — Fleet Aware founder (client). Weekly sync Fridays 10am;
  communicates almost entirely in bullet points and expects the same back.
- [[Hana Kim]] — Freelance illustrator who did the quokka linework explorations.
  Based in Seoul, so async only — 16 hours ahead.

## Friends

- [[Jake Moreno]] — College roommate, now in Denver. Annual camping trip
  organizer; the group chat's designated devil's advocate.
- [[Elena Vasquez]] — Neighbor and family friend. Waters the plants and feeds
  the fish whenever the Medinas travel; her kids trade Pokémon cards with Diego.

See [[myela-stage-plan]] for how the work roster maps to the product stages.
`;

const FIXTURE_NOTES: FixtureNote[] = [
  {
    id: "n-people",
    title: "people/ — who's who in Seth's world",
    folderId: "wiki/people",
    body: whosWho,
    pinned: true,
  },
  {
    id: "n-canon",
    title: "personal-canon",
    folderId: "identity",
    body: "---\nid: 01JXCANON\ntags: [identity, values]\nsummary: Seth's personal canon — values and operating principles.\n---\n\n# Personal canon\n\nPrinciples: build calm tools, family dinners are sacred, ship small and often.\nThis note is about VALUES — it is not a person and not a project.\n",
  },
  {
    id: "n-caminorx",
    title: "caminorx",
    folderId: "wiki/projects",
    body: "---\nid: 01JXCAMINO\ntags: [project, travel]\nsummary: CaminoRX — the Camino de Santiago pilgrimage planning project.\n---\n\n# CaminoRX\n\nPlanning project for walking the Camino Portugués in spring. Route drafts,\ngear list, training plan. A PROJECT, not a person.\n\nDecision 2026-07-14: we picked the Camino Portugués coastal route starting in\nPorto (12 walking days) over the Francés, to fit inside Seth's two-week window.\nMarisol joins the final 100km from Vigo. Booking pauses until September.\n",
  },
  {
    id: "n-stage",
    title: "myela-stage-plan",
    folderId: "wiki/projects",
    body: "---\nid: 01JXSTAGE\ntags: [project, myela]\nsummary: Myela product stage plan.\n---\n\n# Myela stage plan\n\nStage roadmap for the three pillars. Owners: Ramon (vision), Seth (eng), Priya (design).\n",
  },
  {
    id: "n-marisol",
    title: "marisol-medina",
    folderId: "wiki/people",
    body: "---\nid: 01JXMARISOL\ntags: [person, family]\nsummary: Marisol Medina — Seth's wife.\n---\n\n# Marisol Medina\n\nSeth's wife. Piano teacher, gardener-in-chief. Shellfish allergy.\n",
  },
  {
    id: "n-ramon",
    title: "ramon-ortega",
    folderId: "wiki/people",
    body: "---\nid: 01JXRAMON\ntags: [person, myela]\nsummary: Ramon Ortega — Myela CEO.\n---\n\n# Ramon Ortega\n\nMyela CEO. Loom over meetings. CDMX the first week of each month.\n",
  },
  {
    id: "n-tom",
    title: "tom-becker",
    folderId: "wiki/people",
    body: "---\nid: 01JXTOM\ntags: [person, client]\nsummary: Tom Becker — Fleet Aware founder, client.\n---\n\n# Tom Becker\n\nFleet Aware founder. Friday 10am sync. Bullet points only.\n",
  },
  {
    id: "n-garden",
    title: "garden-notes",
    folderId: "wiki/reference",
    body: "---\nid: 01JXGARDEN\ntags: [reference]\nsummary: Garden bed rotation notes.\n---\n\n# Garden notes\n\nTomatoes rotate to the east bed this year. Distractor note.\n",
  },
  {
    id: "n-espresso",
    title: "espresso-dial-in",
    folderId: "wiki/reference",
    body: "---\nid: 01JXCOFFEE\ntags: [reference]\nsummary: Espresso dial-in log for the Gaggia.\n---\n\n# Espresso dial-in\n\n18g in, 36g out, 27s. Distractor note.\n",
  },
];

// ── the fixture Host ──────────────────────────────────────────────────────────

function snippetOf(body: string): string {
  const noFm = body.replace(/^---\n[\s\S]*?\n---\n/, "");
  return noFm.replace(/\s+/g, " ").trim().slice(0, 140);
}

function rankFixture(query: string, limit: number): NoteHit[] {
  const tokens = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1);
  const scored = FIXTURE_NOTES.map((n) => {
    const hay = `${n.title}\n${n.folderId}\n${n.body}`.toLowerCase();
    let score = 0;
    for (const t of tokens) {
      if (n.title.toLowerCase().includes(t)) score += 3;
      if (n.folderId.toLowerCase().includes(t)) score += 2;
      if (hay.includes(t)) score += 1;
    }
    return { n, score };
  })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  return scored.map(({ n }) => ({
    id: n.id,
    title: n.title,
    snippet: snippetOf(n.body),
    folder: n.folderId,
  }));
}

interface StepLog {
  kind: "complete";
  formatJson: boolean;
  prompt: string;
  raw: string;
  ms: number;
}

function makeFixtureHost(modelId: string, log: StepLog[]): Host {
  const meta = { id: modelId };
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
        signal: AbortSignal.timeout(120_000),
      });
      if (!res.ok) throw new Error(`local model server ${res.status}: ${await res.text()}`);
      const json = (await res.json()) as { response?: string };
      const raw = (json.response ?? "").trim();
      log.push({ kind: "complete", formatJson: formatJson === true, prompt, raw, ms: Date.now() - t0 });
      return raw;
    },
    async searchNotes(query, limit) {
      return rankFixture(query, limit);
    },
    async readNote(id) {
      const n = FIXTURE_NOTES.find((x) => x.id === id);
      if (!n) throw new Error(`no note with id "${id}"`);
      return n.body;
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
      const mapNotes: ModelMapNote[] = FIXTURE_NOTES.map((n, i) => ({
        id: n.id,
        title: n.title,
        folderId: n.folderId,
        updatedAt: 1000 - i,
        pinned: n.pinned === true,
      }));
      return buildModelMap(mapNotes, contextWindowFor(meta), maxChars);
    },
  };
}

// ── cases + scoring ───────────────────────────────────────────────────────────

interface EvalCase {
  name: string;
  turns: string[]; // each run as a user turn; prior turns become history
  score(final: string): { pass: boolean; detail: string };
}

function scorePeople(final: string): { pass: boolean; detail: string } {
  const low = final.toLowerCase();
  const found = PEOPLE.filter((p) => low.includes(p.split(" ")[0]!.toLowerCase()));
  const wrong = NOT_PEOPLE.filter((w) => low.includes(w.toLowerCase()));
  // "personal-canon"/"caminorx" may be MENTIONED as not-people; only count as wrong
  // when the answer is thin (few real people), i.e. the old parroting failure.
  const parroted = wrong.length > 0 && found.length < 6;
  const pass = found.length >= 10 && !parroted;
  return {
    pass,
    detail: `people found ${found.length}/${PEOPLE.length} [${found.join(", ")}]; non-person stems present: [${wrong.join(", ") || "none"}]`,
  };
}

const CASES: EvalCase[] = [
  {
    name: "people",
    turns: ["who are the people in my vault?"],
    score: scorePeople,
  },
  {
    name: "follow",
    turns: ["who are the people in my vault?", "list ALL of them, one per line, with who they are"],
    score: scorePeople,
  },
  {
    name: "decide",
    turns: ["what did we decide about the camino trip?"],
    score(final) {
      const low = final.toLowerCase();
      const hits = ["portugu", "porto", "coastal"].filter((k) => low.includes(k));
      return { pass: hits.length >= 2, detail: `route facts present: ${hits.join(", ") || "none"}` };
    },
  },
];

// ── runner ────────────────────────────────────────────────────────────────────

async function runCase(c: EvalCase, modelId: string, logDir: string): Promise<boolean> {
  const log: StepLog[] = [];
  const host = makeFixtureHost(modelId, log);
  const history: ChatTurn[] = [];
  let final = "";
  const events: string[] = [];

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
      if (ev.type === "tool") events.push(`tool: ${ev.tool} ${JSON.stringify(ev.args)}`);
      if (ev.type === "final") final = ev.text;
    }
    history.push({ role: "user", text: userText }, { role: "assistant", text: final });
  }

  const { pass, detail } = c.score(final);
  const transcript = [
    `# case: ${c.name} · model: ${modelId} · ${pass ? "PASS" : "FAIL"}`,
    `score: ${detail}`,
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
  await Bun.write(`${logDir}/${c.name}.txt`, transcript);
  console.log(`[${pass ? "PASS" : "FAIL"}] ${c.name} — ${detail}`);
  console.log(`       tools: ${events.join(" | ") || "(none)"}`);
  console.log(`       final: ${final.replace(/\s+/g, " ").slice(0, 240)}`);
  return pass;
}

async function main() {
  const args = process.argv.slice(2);
  const flag = (name: string): string | undefined => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const modelId = flag("model") ?? "gemma-3-12b-it-qat-4bit";
  const which = flag("case") ?? "all";
  const logDir = flag("log") ?? `${import.meta.dir}/../.eval-local-chat`;

  // reachability probe — refuse to run without the loopback server
  try {
    const res = await fetch(`${ENDPOINT}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: modelId,
        stream: false,
        prompt: "Reply with the word ok.",
        options: { temperature: 0, num_predict: 5 },
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
  } catch (e) {
    console.error(`local model server not reachable at ${ENDPOINT} — start it and retry. (${String(e)})`);
    process.exit(2);
  }

  const cases = CASES.filter((c) => which === "all" || c.name === which);
  let failures = 0;
  for (const c of cases) {
    if (!(await runCase(c, modelId, logDir))) failures += 1;
  }
  console.log(`\n${cases.length - failures}/${cases.length} cases passed · transcripts in ${logDir}`);
  process.exit(failures > 0 ? 1 : 0);
}

await main();
