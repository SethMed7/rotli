#!/usr/bin/env node

import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const carlPath = join(dirname(fileURLToPath(import.meta.url)), "carl.json");
const serverInfo = { name: "rotli-carl", version: "1.0.0" };
const instructions = "Rotli CARL is compact, project-scoped architecture recall. Call carl_recall with the task topic before broad documentation or codebase scans, then open only the returned source files. AGENTS.md remains authoritative for process and safety. CARL rules summarize current contracts; they never override code or owning docs. Stage new rules for review instead of silently changing architecture.";

const tools = [
  {
    name: "carl_recall",
    description: "Return the smallest relevant set of Rotli architecture rules and decisions for a task or question.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Task, feature, or architecture question" },
        max_domains: { type: "integer", minimum: 1, maximum: 3, default: 2 },
        max_rules: { type: "integer", minimum: 1, maximum: 6, default: 4 },
      },
      required: ["query"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "carl_list_domains",
    description: "List project CARL domains, recall phrases, and rule/decision counts without loading their full content.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "carl_get_domain",
    description: "Load one named Rotli CARL domain when its full rules are needed.",
    inputSchema: {
      type: "object",
      properties: { domain: { type: "string" } },
      required: ["domain"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "carl_search_decisions",
    description: "Search active project decisions by keyword without loading every domain.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "carl_stage_proposal",
    description: "Stage a compact project-rule proposal in carl.json for human review; does not activate it.",
    inputSchema: {
      type: "object",
      properties: {
        domain: { type: "string" },
        rule_text: { type: "string", maxLength: 600 },
        rationale: { type: "string", maxLength: 400 },
        source: { type: "string", maxLength: 160 },
      },
      required: ["domain", "rule_text", "rationale"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
];

function readCarl() {
  return JSON.parse(readFileSync(carlPath, "utf8"));
}

function writeCarl(carl) {
  const temp = `${carlPath}.tmp`;
  carl.last_modified = new Date().toISOString();
  writeFileSync(temp, `${JSON.stringify(carl, null, 2)}\n`, "utf8");
  renameSync(temp, carlPath);
}

function terms(value) {
  return [...new Set(String(value).toLowerCase().match(/[a-z0-9]+/g) ?? [])];
}

function domainScore(name, domain, query) {
  const lower = query.toLowerCase();
  const queryTerms = terms(query);
  let score = 0;
  for (const phrase of domain.recall ?? []) {
    const normalized = phrase.toLowerCase();
    if (lower.includes(normalized)) score += 12 + terms(normalized).length;
    for (const term of terms(normalized)) if (queryTerms.includes(term)) score += 2;
  }
  if (queryTerms.some((term) => name.toLowerCase().includes(term))) score += 3;
  return score;
}

function activeDecisions(domain) {
  return (domain.decisions ?? []).filter((decision) => decision.status !== "archived");
}

function textScore(value, query) {
  const haystack = String(value).toLowerCase();
  const queryTerms = terms(query);
  return queryTerms.reduce((score, term) => score + (haystack.includes(term) ? 1 : 0), 0);
}

function recall({ query, max_domains: requested = 2, max_rules: requestedRules = 4 }) {
  if (!String(query ?? "").trim()) throw new Error("query is required");
  const carl = readCarl();
  const maxDomains = Math.max(1, Math.min(3, Number(requested) || 2));
  const maxRules = Math.max(1, Math.min(6, Number(requestedRules) || 4));
  const ranked = Object.entries(carl.domains ?? {})
    .filter(([, domain]) => domain.state === "active")
    .map(([name, domain]) => ({ name, domain, score: domainScore(name, domain, query) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, maxDomains);

  const selectedRules = ranked
    .flatMap(({ name, domain, score: domainRank }) => (domain.rules ?? []).map((rule) => ({
      domain: name,
      domainRank,
      rule,
      ruleRank: textScore(`${rule.text} ${rule.source ?? ""}`, query),
    })))
    .sort((a, b) => b.ruleRank - a.ruleRank || b.domainRank - a.domainRank || a.rule.id - b.rule.id)
    .slice(0, maxRules);

  return {
    query,
    matched_domains: ranked.map(({ name, domain, score }) => ({
      domain: name,
      score,
      rules: selectedRules
        .filter((entry) => entry.domain === name)
        .map(({ rule: { id, text, source } }) => ({ id, text, source })),
      decisions: activeDecisions(domain)
        .filter((decision) => textScore([decision.decision, decision.rationale, ...(decision.recall ?? [])].join(" "), query) > 0)
        .map(({ id, decision, rationale, date, source }) => ({ id, decision, rationale, date, source })),
    })).filter((domain) => domain.rules.length || domain.decisions.length),
    source_contracts: [...new Set(selectedRules.map(({ rule }) => rule.source).filter(Boolean))],
    fallback: ranked.length ? null : "No domain matched. Use carl_list_domains, then carl_get_domain only if needed.",
  };
}

function listDomains() {
  const carl = readCarl();
  return {
    domains: Object.entries(carl.domains ?? {}).map(([name, domain]) => ({
      domain: name,
      state: domain.state,
      always_on: Boolean(domain.always_on),
      recall: domain.recall ?? [],
      rule_count: (domain.rules ?? []).length,
      decision_count: activeDecisions(domain).length,
    })),
  };
}

function getDomain({ domain: requested }) {
  const name = String(requested ?? "").toUpperCase();
  const domain = readCarl().domains?.[name];
  if (!domain) throw new Error(`unknown domain: ${name || "(empty)"}`);
  return { domain: name, ...domain, decisions: activeDecisions(domain) };
}

function searchDecisions({ query }) {
  const needle = String(query ?? "").trim().toLowerCase();
  if (!needle) throw new Error("query is required");
  const results = [];
  for (const [domainName, domain] of Object.entries(readCarl().domains ?? {})) {
    for (const decision of activeDecisions(domain)) {
      const haystack = [decision.id, decision.decision, decision.rationale, ...(decision.recall ?? [])]
        .join(" ").toLowerCase();
      if (haystack.includes(needle) || terms(needle).some((term) => terms(haystack).includes(term))) {
        results.push({ domain: domainName, ...decision });
      }
    }
  }
  return { query, results };
}

function stageProposal({ domain: requested, rule_text: ruleText, rationale, source = "AI proposal" }) {
  const domain = String(requested ?? "").toUpperCase();
  const text = String(ruleText ?? "").trim();
  const why = String(rationale ?? "").trim();
  if (!domain || !text || !why) throw new Error("domain, rule_text, and rationale are required");
  if (text.length > 600 || why.length > 400 || String(source).length > 160) throw new Error("proposal exceeds the compact CARL limits");
  const carl = readCarl();
  if (!carl.domains?.[domain]) throw new Error(`unknown domain: ${domain}`);
  const next = Math.max(0, ...(carl.staging ?? []).map((entry) => Number(String(entry.id).replace("stg-", "")) || 0)) + 1;
  const proposal = {
    id: `stg-${String(next).padStart(3, "0")}`,
    proposed_domain: domain,
    rule_text: text,
    rationale: why,
    source: String(source),
    proposed_at: new Date().toISOString(),
    status: "pending",
  };
  carl.staging = [...(carl.staging ?? []), proposal];
  writeCarl(carl);
  return { staged: proposal, active: false };
}

const handlers = {
  carl_recall: recall,
  carl_list_domains: listDomains,
  carl_get_domain: getDomain,
  carl_search_decisions: searchDecisions,
  carl_stage_proposal: stageProposal,
};

function success(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function failure(id, code, message) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

function handle(request) {
  if (request.method === "initialize") {
    return success(request.id, {
      protocolVersion: request.params?.protocolVersion ?? "2025-03-26",
      capabilities: { tools: { listChanged: false } },
      serverInfo,
      instructions,
    });
  }
  if (request.method === "ping") return success(request.id, {});
  if (request.method === "tools/list") return success(request.id, { tools });
  if (request.method === "tools/call") {
    const name = request.params?.name;
    const handler = handlers[name];
    if (!handler) return failure(request.id, -32602, `unknown tool: ${name}`);
    try {
      const result = handler(request.params?.arguments ?? {});
      return success(request.id, { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], isError: false });
    } catch (error) {
      return success(request.id, { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true });
    }
  }
  if (String(request.method ?? "").startsWith("notifications/")) return null;
  return failure(request.id, -32601, `method not found: ${request.method}`);
}

const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on("line", (line) => {
  if (!line.trim()) return;
  try {
    const response = handle(JSON.parse(line));
    if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify(failure(null, -32700, `parse error: ${error.message}`))}\n`);
  }
});
