import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { missingScriptSteps, missingTokens, unreferencedNames } from "./documentation-contract.mjs";

const root = process.cwd();
const required = [
  "AGENTS.md",
  "ARCHITECTURE.md",
  "CLAUDE.md",
  "CONTRIBUTING.md",
  "DESIGN.md",
  "PRIVACY.md",
  "SECURITY.md",
  "SUPPORT.md",
  "SYNTAX.md",
  "docs/README.md",
  "docs/security/threat-model.md",
  "docs/architecture/compatibility-and-migrations.md",
  "docs/operations/release-and-supply-chain.md",
  "docs/operations/support-and-diagnostics.md",
  "docs/decisions/README.md",
  "docs/development/ai-workflow.md",
  "docs/development/testing.md",
  "docs/development/adding-things.md",
  "docs/architecture/ai-context-architecture.md",
  ".github/copilot-instructions.md",
  ".github/CODEOWNERS",
  ".github/pull_request_template.md",
  ".github/workflows/regression.yml",
  ".carl/carl.json",
  ".carl/mcpServer.mjs",
  ".mcp.json",
  ".codex/config.toml",
  ".cursor/mcp.json",
  ".agents/mcp_config.json",
  ".agents/rules/AGENTS.md",
  ".agents/skills/verify/SKILL.md",
];

const failures = [];
for (const rel of required) {
  if (!existsSync(join(root, rel))) failures.push(`missing ${rel}`);
}

if (existsSync(join(root, "AGENTS.md")) && readFileSync(join(root, "AGENTS.md")).byteLength > 5_000) {
  failures.push("AGENTS.md exceeds the 5 KiB always-loaded context budget");
}

for (const rel of ["CLAUDE.md", ".github/copilot-instructions.md"]) {
  if (!existsSync(join(root, rel))) continue;
  const text = readFileSync(join(root, rel), "utf8");
  for (const token of missingTokens(text, ["AGENTS.md", "docs/README.md"])) {
    failures.push(`${rel} must point to ${token}`);
  }
  if (rel === "CLAUDE.md" && !text.includes("carl_recall")) {
    failures.push("CLAUDE.md must route topic recall through carl_recall");
  }
}

// CLAUDE.md is an adapter, not a mirror: Claude Code only auto-loads AGENTS.md
// through a real memory import — a bare `@AGENTS.md` line at line start. A
// Markdown link (or a backticked mention) is NOT an import; it leaves the
// canonical rules unloaded and relies on the model choosing to read them.
if (existsSync(join(root, "CLAUDE.md"))) {
  const adapter = readFileSync(join(root, "CLAUDE.md"), "utf8");
  if (!/^@AGENTS\.md$/m.test(adapter)) {
    failures.push(
      "CLAUDE.md must import the canonical rules with a bare `@AGENTS.md` line (a Markdown link is not an import)",
    );
  }
  if (Buffer.byteLength(adapter, "utf8") > 1_000) {
    failures.push(
      "CLAUDE.md exceeds its 1,000-byte adapter budget — rules belong in AGENTS.md, not the adapter",
    );
  }
}

for (const rel of ["README.md", "AGENTS.md", "CONTRIBUTING.md", "docs/README.md"]) {
  if (!existsSync(join(root, rel))) continue;
  const text = readFileSync(join(root, rel), "utf8");
  if (/Liquid Glass/i.test(text)) failures.push(`${rel} advertises retired Liquid Glass`);
}

if (existsSync(join(root, "docs/README.md"))) {
  const map = readFileSync(join(root, "docs/README.md"), "utf8");
  for (const token of missingTokens(map, [
    "../ARCHITECTURE.md",
    "../DESIGN.md",
    "../PRIVACY.md",
    "../SECURITY.md",
    "../SUPPORT.md",
    "../SYNTAX.md",
    "security/threat-model.md",
    "architecture/compatibility-and-migrations.md",
    "operations/release-and-supply-chain.md",
    "operations/support-and-diagnostics.md",
    "decisions/README.md",
  ])) {
    failures.push(`docs/README.md must route to ${token}`);
  }
  if (!map.includes("development/testing.md")) {
    failures.push("docs/README.md must route to the testing and regression contract");
  }
  if (!map.includes("development/adding-things.md")) {
    failures.push("docs/README.md must route to the adding-things placement contract");
  }
}

// The adding-things contract table must reference reality: every concrete
// repository path in the document exists. Placeholders (<name>, globs) and
// non-path code spans are skipped.
if (existsSync(join(root, "docs/development/adding-things.md"))) {
  const contract = readFileSync(join(root, "docs/development/adding-things.md"), "utf8");
  for (const match of contract.matchAll(/`([^`\n]+)`/g)) {
    const candidate = match[1];
    if (!/^(?:src|src-tauri|scripts|docs|breve-runtime)\//.test(candidate)) continue;
    if (/[<>*{}\s]/.test(candidate)) continue;
    if (!existsSync(join(root, candidate))) {
      failures.push(`docs/development/adding-things.md references missing path: ${candidate}`);
    }
  }
}

if (existsSync(join(root, "package.json"))) {
  const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  for (const script of [
    "lint",
    "test:unit",
    "test:evals",
    "test:breve",
    "test:tooling",
    "test:regression",
    "check",
  ]) {
    if (!packageJson.scripts?.[script]) failures.push(`package.json is missing documented script: ${script}`);
  }

  const requiredScriptSteps = {
    lint: [
      "bun run typecheck",
      "bun run check:e2e-types",
      "bun run typecheck:tsc6",
      "bun run format:check",
      "bun run check:structure",
      "bun run check:docs",
      "bun run check:naming",
      "bun run check:knip",
      "bun run lint:oxlint",
    ],
    "test:regression": [
      "bun run test",
      "bun run test:evals",
      "bun run check:breve-runtime",
      "bun run check:design-system",
    ],
    check: ["bun run lint", "bun run test:regression"],
  };
  for (const missing of missingScriptSteps(packageJson.scripts, requiredScriptSteps)) {
    failures.push(`package.json proof chain is missing ${missing}`);
  }

  const releaseScript = existsSync(join(root, "scripts/release.sh"))
    ? readFileSync(join(root, "scripts/release.sh"), "utf8")
    : "";
  if (!releaseScript.includes("bun run check"))
    failures.push("scripts/release.sh must run bun run check before building");

  const regressionWorkflow = existsSync(join(root, ".github/workflows/regression.yml"))
    ? readFileSync(join(root, ".github/workflows/regression.yml"), "utf8")
    : "";
  for (const token of missingTokens(regressionWorkflow, [
    "bun run check:e2e-types",
    "bun run test:e2e",
    "cargo clippy",
    "cargo test",
    "bun run build",
  ])) {
    failures.push(`regression workflow must run ${token}`);
  }

  // ── no orphan tooling (added 2026-07-18; this failure mode recurred) ──────
  // (1) Every executable under scripts/ must be invoked from somewhere real:
  // a package.json script, a sibling script, or a CI workflow. A checker that
  // exists but is never run is a silent third state.
  const scriptEntries = Object.entries(packageJson.scripts ?? {});
  const packageScriptText = scriptEntries.map(([, value]) => value).join("\n");
  const workflowsDir = join(root, ".github/workflows");
  const workflowText = existsSync(workflowsDir)
    ? readdirSync(workflowsDir)
        .filter((name) => /\.ya?ml$/.test(name))
        .map((name) => readFileSync(join(workflowsDir, name), "utf8"))
        .join("\n")
    : "";
  const orphanExemptions = {
    "bump-version.sh":
      "manual release helper — run by hand per its usage header; release.sh reads the result",
    "eval-local-chat.ts": "LIVE eval — needs a real on-device model, so it is run by hand, never from a gate",
    "eval-vault-sweep.ts":
      "LIVE eval — whole-vault sweep against a real local model; run by hand, never from a gate",
  };
  // `.ts` counts too: an executable that never runs is an orphan whatever its
  // extension. Test files are excluded from the scan but kept in the haystack,
  // so a library like build-policy.ts is held up by its own .test.ts sibling.
  const scriptDir = readdirSync(join(root, "scripts"));
  const executables = scriptDir.filter((name) => /\.(mjs|sh)$/.test(name) || /(?<!\.test)\.ts$/.test(name));
  const referenceable = scriptDir.filter((name) => /\.(mjs|sh|ts)$/.test(name));
  const siblingText = (self) =>
    referenceable
      .filter((name) => name !== self)
      .map((name) => readFileSync(join(root, "scripts", name), "utf8"))
      .join("\n");
  for (const name of executables) {
    if (name in orphanExemptions) continue;
    if (
      !packageScriptText.includes(name) &&
      !workflowText.includes(name) &&
      !siblingText(name).includes(name)
    ) {
      failures.push(
        `scripts/${name} is an orphan — wire it into package.json/a workflow, or exempt it with a reason`,
      );
    }
  }
  // (1b) test:breve names its files by hand — the only suite that does.
  // `bun test src`, `bun test scripts/*.test.ts`, and Playwright's testDir all
  // glob, so they cannot orphan a file; a new breve-runtime test silently
  // never runs unless someone remembers to extend the script.
  const breveTestDir = join(root, "breve-runtime/tests");
  if (existsSync(breveTestDir)) {
    const breveTests = readdirSync(breveTestDir).filter((name) => name.endsWith(".ts"));
    for (const name of unreferencedNames(breveTests, packageJson.scripts?.["test:breve"] ?? "")) {
      failures.push(`breve-runtime/tests/${name} is never run — add it to the test:breve script`);
    }
  }
  // (2) Every check:* script key must actually run somewhere — referenced by
  // another package.json script (the lint/check/test chains) or a CI workflow.
  // Defined-but-never-run checks are how conventions rot while looking enforced.
  const chainExemptions = {
    "check:dup":
      "advisory duplication miner — run on demand against dup-judgments.json, deliberately not a gate",
  };
  for (const [key] of scriptEntries) {
    if (!key.startsWith("check:") || key in chainExemptions) continue;
    const referencedElsewhere = scriptEntries.some(
      ([other, value]) => other !== key && new RegExp(`\\b${key}\\b`).test(value),
    );
    if (!referencedElsewhere && !new RegExp(`\\b${key}\\b`).test(workflowText)) {
      failures.push(`package.json script ${key} is defined but never run by any chain or workflow`);
    }
  }
  // (3) Every package.json script appears (backticked) in the testing
  // contract, so the command map cannot silently fall behind reality.
  if (existsSync(join(root, "docs/development/testing.md"))) {
    const testingDoc = readFileSync(join(root, "docs/development/testing.md"), "utf8");
    const backtickSpans = [...testingDoc.matchAll(/`([^`\n]+)`/g)].map((match) => match[1]).join("\n");
    for (const [key] of scriptEntries) {
      if (
        !new RegExp(`(^|[^-\\w:])${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^-\\w:])`, "m").test(
          backtickSpans,
        )
      ) {
        failures.push(
          `package.json script ${key} is not documented in docs/development/testing.md's command map`,
        );
      }
    }
  }
}

for (const rel of ["AGENTS.md", "docs/architecture/memex-data-contract.md"]) {
  if (!existsSync(join(root, rel))) continue;
  const text = readFileSync(join(root, rel), "utf8");
  if (!/images and video are the only\s+preview-only/i.test(text)) {
    failures.push(`${rel} must preserve the no-preview-only workspace invariant`);
  }
}

function markdownFiles(dir, prefix = "") {
  const files = [];
  for (const name of readdirSync(dir)) {
    if (!prefix && (name === "archive" || name === "media")) continue;
    const abs = join(dir, name);
    const rel = join(prefix, name);
    if (statSync(abs).isDirectory()) files.push(...markdownFiles(abs, rel));
    else if (name.endsWith(".md")) files.push(join("docs", rel));
  }
  return files;
}

const linkedDocs = [
  "README.md",
  "AGENTS.md",
  "ARCHITECTURE.md",
  "CONTRIBUTING.md",
  "CLAUDE.md",
  "DESIGN.md",
  "PRIVACY.md",
  "SECURITY.md",
  "SUPPORT.md",
  "SYNTAX.md",
  ...markdownFiles(join(root, "docs")),
];
for (const rel of linkedDocs) {
  const text = readFileSync(join(root, rel), "utf8");
  for (const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const raw = match[1].trim().replace(/^<|>$/g, "");
    if (!raw || /^(?:https?:|mailto:|#)/i.test(raw)) continue;
    const path = decodeURIComponent(raw.split("#", 1)[0]);
    if (!path) continue;
    if (!existsSync(resolve(root, dirname(rel), path))) {
      failures.push(`${rel} has a broken local link: ${raw}`);
    }
  }
}

if (existsSync(join(root, ".carl/carl.json"))) {
  try {
    const carl = JSON.parse(readFileSync(join(root, ".carl/carl.json"), "utf8"));
    if (carl?.version !== 1) failures.push(".carl/carl.json has an unsupported version");
    const domains = Object.entries(carl.domains ?? {});
    if (!domains.length) failures.push("Carl has no project domains");
    for (const [name, domain] of domains) {
      if (domain.always_on) failures.push(`${name} is always-on; project detail must be recalled on demand`);
      if (!(domain.recall ?? []).length) failures.push(`${name} has no recall phrases`);
      for (const rule of domain.rules ?? []) {
        if (String(rule.text ?? "").length > 600)
          failures.push(`${name} rule ${rule.id} exceeds 600 characters`);
        if (rule.source && !existsSync(join(root, rule.source)))
          failures.push(`${name} rule ${rule.id} has missing source: ${rule.source}`);
      }
      for (const decision of domain.decisions ?? []) {
        if (String(decision.rationale ?? "").length > 400)
          failures.push(`${decision.id} rationale exceeds 400 characters`);
      }
    }
    // Freshness: a rule whose source contract changed after its last review is
    // stale until someone re-reads it. Known debt lives in .carl/freshness-debt.json
    // (id + date noted) and only shrinks; a shallow CI clone cannot date files,
    // so the comparison runs only where history exists.
    const shallow = (() => {
      try {
        return (
          execSync("git rev-parse --is-shallow-repository", { cwd: root, encoding: "utf8" }).trim() === "true"
        );
      } catch {
        return true;
      }
    })();
    const debtPath = join(root, ".carl/freshness-debt.json");
    const debt = existsSync(debtPath) ? JSON.parse(readFileSync(debtPath, "utf8")) : {};
    const seenDebt = new Set();
    if (!shallow) {
      for (const [name, domain] of domains) {
        for (const rule of domain.rules ?? []) {
          if (!rule.source || !rule.last_reviewed) continue;
          let changed = "";
          try {
            changed = execSync(`git log -1 --format=%cs -- "${rule.source}"`, {
              cwd: root,
              encoding: "utf8",
            }).trim();
          } catch {
            changed = "";
          }
          if (changed && changed > String(rule.last_reviewed)) {
            const key = `${name}#${rule.id}`;
            if (key in debt) seenDebt.add(key);
            else
              failures.push(
                `${key}: source ${rule.source} changed ${changed}, after last_reviewed ${rule.last_reviewed} — re-read the rule and bump last_reviewed (or note it in .carl/freshness-debt.json)`,
              );
          }
        }
      }
      for (const key of Object.keys(debt)) {
        if (!seenDebt.has(key))
          failures.push(
            `${key}: no longer stale — remove it from .carl/freshness-debt.json (the list only shrinks)`,
          );
      }
    }
    for (const entry of carl.staging ?? []) {
      if (entry.status === "adopted")
        failures.push(
          `Carl staging ${entry.id} is adopted — its rule lives in the domain now; prune the staging copy`,
        );
      if (!entry.proposed_at) failures.push(`Carl staging ${entry.id} has no proposed_at date`);
    }
    const glassDecision = domains
      .flatMap(([, domain]) => domain.decisions ?? [])
      .find((decision) => decision.id === "rotli-004");
    if (!glassDecision || !/remove.*Liquid Glass|Liquid Glass.*remove/i.test(glassDecision.decision)) {
      failures.push("Carl must remember that Liquid Glass was removed");
    }

    if (existsSync(join(root, "docs/architecture/ai-context-architecture.md"))) {
      const contextDoc = readFileSync(join(root, "docs/architecture/ai-context-architecture.md"), "utf8");
      for (const [name] of domains) {
        if (!contextDoc.includes(`\`${name}\``)) {
          failures.push(`docs/architecture/ai-context-architecture.md omits CARL domain ${name}`);
        }
      }
    }
    const coreSources = new Set((carl.domains?.ROTLI_CORE?.rules ?? []).map((rule) => rule.source));
    for (const source of ["ARCHITECTURE.md", "SYNTAX.md", "docs/development/testing.md"]) {
      if (!coreSources.has(source)) failures.push(`ROTLI_CORE must route to ${source}`);
    }
    const designSources = new Set((carl.domains?.ROTLI_DESIGN?.rules ?? []).map((rule) => rule.source));
    if (!designSources.has("DESIGN.md")) failures.push("ROTLI_DESIGN must route to DESIGN.md");

    // CARL coverage is measured, not vibes: every top-level src/ directory over
    // the size threshold must appear in this dir→domain map or be exempted with
    // a reason. The check enforces only that a mapping EXISTS — what a domain
    // says stays in carl.json and its sources (CARL is recall, never a second
    // spec). This mechanical form catches the F16 failure mode: a large area
    // (src/editor was 6,700 lines) with no recall home and no recorded reason.
    const carlDirDomainMap = {
      ai: "ROTLI_MODELS",
      boards: "ROTLI_DOCUMENTS",
      brand: "ROTLI_DESIGN",
      chatMemory: "ROTLI_MEMORY",
      components: "ROTLI_DESIGN",
      documents: "ROTLI_DOCUMENTS",
      editor: "ROTLI_EDITOR",
      keys: "ROTLI_KEYS",
      memex: "ROTLI_MEMEX",
      routines: "ROTLI_BREVE",
      services: "ROTLI_CORE",
      security: "ROTLI_SECURITY",
      sheets: "ROTLI_DOCUMENTS",
      state: "ROTLI_CORE",
    };
    const carlDirExemptions = {
      lib: "pure dependency-free utilities with no distinct recall vocabulary — placement law lives in docs/development/adding-things.md",
      newItems:
        "small creation workflow; covered by ROTLI_CORE architecture vocabulary — if it ever grows past the threshold, map it",
      noteChat:
        "thin note↔chat seam below the threshold; its contract lives in the ROTLI_MEMORY chat-note rule",
      styles: "CSS only; owned by the ROTLI_DESIGN token rules and check:design-system",
    };
    const carlDirThresholdLines = 2_000;
    const domainNames = new Set(domains.map(([name]) => name));
    const countLines = (dir) => {
      let lines = 0;
      for (const name of readdirSync(dir)) {
        const abs = join(dir, name);
        if (statSync(abs).isDirectory()) lines += countLines(abs);
        else if (/\.tsx?$/.test(name)) lines += readFileSync(abs, "utf8").split("\n").length;
      }
      return lines;
    };
    const srcDirs = readdirSync(join(root, "src")).filter((name) =>
      statSync(join(root, "src", name)).isDirectory(),
    );
    for (const [dir, domain] of Object.entries(carlDirDomainMap)) {
      if (!srcDirs.includes(dir))
        failures.push(`CARL dir→domain map references missing directory src/${dir}`);
      if (!domainNames.has(domain))
        failures.push(`CARL dir→domain map: src/${dir} points at unknown domain ${domain}`);
    }
    for (const dir of Object.keys(carlDirExemptions)) {
      if (!srcDirs.includes(dir)) failures.push(`CARL dir exemption references missing directory src/${dir}`);
      if (dir in carlDirDomainMap) failures.push(`src/${dir} is both mapped and exempted — pick one`);
    }
    for (const dir of srcDirs) {
      if (dir in carlDirDomainMap || dir in carlDirExemptions) continue;
      const lines = countLines(join(root, "src", dir));
      if (lines > carlDirThresholdLines) {
        failures.push(
          `src/${dir} is ${lines} lines with no CARL dir→domain mapping or exemption (add one in check-documentation.mjs)`,
        );
      }
    }
  } catch (error) {
    failures.push(`.carl/carl.json is invalid JSON: ${error.message}`);
  }
}

if (existsSync(join(root, ".mcp.json"))) {
  try {
    const claudeMcp = JSON.parse(readFileSync(join(root, ".mcp.json"), "utf8"));
    const carl = claudeMcp?.mcpServers?.["rotli-carl"];
    if (carl?.command !== "node" || !carl?.args?.includes(".carl/mcpServer.mjs")) {
      failures.push(".mcp.json does not launch the project CARL server");
    }
  } catch (error) {
    failures.push(`.mcp.json is invalid JSON: ${error.message}`);
  }
}

if (existsSync(join(root, ".codex/config.toml"))) {
  const config = readFileSync(join(root, ".codex/config.toml"), "utf8");
  if (!config.includes("[mcp_servers.rotli_carl]") || !config.includes(".carl/mcpServer.mjs")) {
    failures.push(".codex/config.toml does not launch the project CARL server");
  }
  const enabledLine = config.split("\n").find((line) => line.startsWith("enabled_tools")) ?? "";
  if (!enabledLine.includes("carl_recall") || enabledLine.includes("carl_stage_proposal")) {
    failures.push("Codex CARL access must include recall and remain read-only");
  }
}

// Cursor (.cursor/mcp.json) and Antigravity (.agents/mcp_config.json) reach the
// same project CARL server. Both run read-only: CARL_READONLY=1 makes the
// server hide and refuse carl_stage_proposal — only Claude stages proposals.
for (const rel of [".cursor/mcp.json", ".agents/mcp_config.json"]) {
  if (!existsSync(join(root, rel))) continue;
  try {
    const config = JSON.parse(readFileSync(join(root, rel), "utf8"));
    const server = config?.mcpServers?.["rotli-carl"];
    if (server?.command !== "node" || !server?.args?.includes(".carl/mcpServer.mjs")) {
      failures.push(`${rel} does not launch the project CARL server`);
    }
    if (server?.env?.CARL_READONLY !== "1") {
      failures.push(`${rel} must set CARL_READONLY=1 — only Claude stages CARL proposals`);
    }
  } catch (error) {
    failures.push(`${rel} is invalid JSON: ${error.message}`);
  }
}

// Antigravity does not read a root AGENTS.md; it loads workspace rules from
// .agents/rules/. The mirror there must stay byte-identical to the canonical
// file (a symlink satisfies this automatically; a copy is caught on drift).
if (existsSync(join(root, ".agents/rules/AGENTS.md")) && existsSync(join(root, "AGENTS.md"))) {
  if (
    readFileSync(join(root, ".agents/rules/AGENTS.md"), "utf8") !==
    readFileSync(join(root, "AGENTS.md"), "utf8")
  ) {
    failures.push(".agents/rules/AGENTS.md has drifted from the canonical AGENTS.md");
  }
}

// Skills are canonical in .agents/skills (Codex, Cursor, and Antigravity read
// that path natively). Claude reads .claude/skills, which must resolve to the
// same directory, and .gitignore must carve the symlink out of the .claude/
// ignore or it never reaches the repository.
if (existsSync(join(root, ".agents/skills"))) {
  try {
    if (realpathSync(join(root, ".claude/skills")) !== realpathSync(join(root, ".agents/skills"))) {
      failures.push(".claude/skills must resolve to .agents/skills so every agent sees the same skills");
    }
  } catch {
    failures.push(".claude/skills is missing — link it to .agents/skills");
  }
  const gitignore = existsSync(join(root, ".gitignore"))
    ? readFileSync(join(root, ".gitignore"), "utf8")
    : "";
  if (!gitignore.includes("!.claude/skills")) {
    failures.push(".gitignore must un-ignore .claude/skills (use `.claude/*` + `!.claude/skills`)");
  }
  const packageScripts = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).scripts ?? {};
  for (const name of readdirSync(join(root, ".agents/skills"))) {
    const dir = join(root, ".agents/skills", name);
    if (!statSync(dir).isDirectory()) continue;
    const skillPath = join(dir, "SKILL.md");
    if (!existsSync(skillPath)) {
      failures.push(`.agents/skills/${name} is missing SKILL.md`);
      continue;
    }
    const skill = readFileSync(skillPath, "utf8");
    if (!skill.startsWith("---") || !/^name:\s*\S/m.test(skill) || !/^description:\s*\S/m.test(skill)) {
      failures.push(`.agents/skills/${name}/SKILL.md needs frontmatter with name and description`);
    }
    // Skills point at the canonical proof chain; a named command must exist.
    for (const match of skill.matchAll(/`bun run ([a-z0-9:_-]+)/g)) {
      if (!packageScripts[match[1]])
        failures.push(`.agents/skills/${name}/SKILL.md references missing script: bun run ${match[1]}`);
    }
    for (const match of skill.matchAll(/`([^`\n]+)`/g)) {
      const candidate = match[1];
      if (!/^(?:src|src-tauri|scripts|docs|breve-runtime)\//.test(candidate)) continue;
      if (/[<>*{}\s]/.test(candidate)) continue;
      if (!existsSync(join(root, candidate)))
        failures.push(`.agents/skills/${name}/SKILL.md references missing path: ${candidate}`);
    }
  }
}

if (existsSync(join(root, ".carl/mcpServer.mjs"))) {
  const requests = [
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "docs-check", version: "1" },
      },
    },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
    {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "carl_recall",
        arguments: { query: "secure memex retrieval", max_domains: 2, max_rules: 4 },
      },
    },
  ];
  const smoke = spawnSync(process.execPath, [".carl/mcpServer.mjs"], {
    cwd: root,
    input: `${requests.map(JSON.stringify).join("\n")}\n`,
    encoding: "utf8",
  });
  try {
    if (smoke.status !== 0) throw new Error(smoke.stderr || `exit ${smoke.status}`);
    const responses = smoke.stdout
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const listed = responses.find((response) => response.id === 2)?.result?.tools ?? [];
    if (!listed.some((tool) => tool.name === "carl_recall"))
      throw new Error("carl_recall missing from tools/list");
    const recallText = responses.find((response) => response.id === 3)?.result?.content?.[0]?.text;
    const recall = JSON.parse(recallText);
    if (!recall.matched_domains?.some((domain) => domain.domain === "ROTLI_MEMEX")) {
      throw new Error("secure memex recall did not select ROTLI_MEMEX");
    }
    const ruleCount = recall.matched_domains.reduce((count, domain) => count + domain.rules.length, 0);
    if (ruleCount > 4) throw new Error("bounded recall returned more than four rules");
  } catch (error) {
    failures.push(`project CARL MCP smoke test failed: ${error.message}`);
  }

  // Read-only mode (Cursor/Antigravity wiring): carl_stage_proposal must
  // disappear from tools/list and refuse calls under CARL_READONLY=1.
  const readOnlyRequests = [
    requests[0],
    requests[1],
    { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
    {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "carl_stage_proposal",
        arguments: { proposed_domain: "ROTLI_CORE", rule_text: "smoke", rationale: "smoke" },
      },
    },
  ];
  const readOnlySmoke = spawnSync(process.execPath, [".carl/mcpServer.mjs"], {
    cwd: root,
    env: { ...process.env, CARL_READONLY: "1" },
    input: `${readOnlyRequests.map(JSON.stringify).join("\n")}\n`,
    encoding: "utf8",
  });
  try {
    if (readOnlySmoke.status !== 0) throw new Error(readOnlySmoke.stderr || `exit ${readOnlySmoke.status}`);
    const responses = readOnlySmoke.stdout
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const listed = responses.find((response) => response.id === 2)?.result?.tools ?? [];
    if (listed.some((tool) => tool.name === "carl_stage_proposal"))
      throw new Error("carl_stage_proposal is still listed under CARL_READONLY=1");
    if (!listed.some((tool) => tool.name === "carl_recall"))
      throw new Error("carl_recall missing from read-only tools/list");
    const call = responses.find((response) => response.id === 3);
    if (!call?.error) throw new Error("carl_stage_proposal call was not refused in read-only mode");
  } catch (error) {
    failures.push(`read-only CARL smoke test failed: ${error.message}`);
  }
}

if (failures.length) {
  console.error(`check:docs failed:\n${failures.map((item) => `- ${item}`).join("\n")}`);
  process.exit(1);
}

console.log("check:docs ok — compact AI context, project CARL, docs, and adapters agree");
