import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const required = [
  "AGENTS.md",
  "CLAUDE.md",
  "CONTRIBUTING.md",
  "docs/README.md",
  "docs/development/ai-workflow.md",
  "docs/architecture/ai-context-architecture.md",
  ".github/copilot-instructions.md",
  ".github/pull_request_template.md",
  ".carl/carl.json",
  ".carl/mcpServer.mjs",
  ".mcp.json",
  ".codex/config.toml",
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
  if (!text.includes("AGENTS.md")) failures.push(`${rel} must point to AGENTS.md`);
}

for (const rel of ["README.md", "AGENTS.md", "CONTRIBUTING.md", "docs/README.md"]) {
  if (!existsSync(join(root, rel))) continue;
  const text = readFileSync(join(root, rel), "utf8");
  if (/Liquid Glass/i.test(text)) failures.push(`${rel} advertises retired Liquid Glass`);
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

const linkedDocs = ["README.md", "AGENTS.md", "CONTRIBUTING.md", "CLAUDE.md", ...markdownFiles(join(root, "docs"))];
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
        if (String(rule.text ?? "").length > 600) failures.push(`${name} rule ${rule.id} exceeds 600 characters`);
        if (rule.source && !existsSync(join(root, rule.source))) failures.push(`${name} rule ${rule.id} has missing source: ${rule.source}`);
      }
      for (const decision of domain.decisions ?? []) {
        if (String(decision.rationale ?? "").length > 400) failures.push(`${decision.id} rationale exceeds 400 characters`);
      }
    }
    const glassDecision = domains.flatMap(([, domain]) => domain.decisions ?? [])
      .find((decision) => decision.id === "rotli-004");
    if (!glassDecision || !/remove.*Liquid Glass|Liquid Glass.*remove/i.test(glassDecision.decision)) {
      failures.push("Carl must remember that Liquid Glass was removed");
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
  if (!config.includes("[mcp_servers.rotli_carl]") || !config.includes('.carl/mcpServer.mjs')) {
    failures.push(".codex/config.toml does not launch the project CARL server");
  }
  const enabledLine = config.split("\n").find((line) => line.startsWith("enabled_tools")) ?? "";
  if (!enabledLine.includes("carl_recall") || enabledLine.includes("carl_stage_proposal")) {
    failures.push("Codex CARL access must include recall and remain read-only");
  }
}

if (existsSync(join(root, ".carl/mcpServer.mjs"))) {
  const requests = [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "docs-check", version: "1" } } },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "carl_recall", arguments: { query: "secure memex retrieval", max_domains: 2, max_rules: 4 } } },
  ];
  const smoke = spawnSync(process.execPath, [".carl/mcpServer.mjs"], {
    cwd: root,
    input: `${requests.map(JSON.stringify).join("\n")}\n`,
    encoding: "utf8",
  });
  try {
    if (smoke.status !== 0) throw new Error(smoke.stderr || `exit ${smoke.status}`);
    const responses = smoke.stdout.trim().split("\n").map((line) => JSON.parse(line));
    const listed = responses.find((response) => response.id === 2)?.result?.tools ?? [];
    if (!listed.some((tool) => tool.name === "carl_recall")) throw new Error("carl_recall missing from tools/list");
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
}

if (failures.length) {
  console.error(`check:docs failed:\n${failures.map((item) => `- ${item}`).join("\n")}`);
  process.exit(1);
}

console.log("check:docs ok — compact AI context, project CARL, docs, and adapters agree");
