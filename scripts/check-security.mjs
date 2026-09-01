// check:security — mechanical egress + platform-hardening guards.
//
// Derived from the 2026-07 security audit's 'mechanical-check-can-guard'
// findings. This is a TRIPWIRE layer: it makes a NEW off-device network call
// site, a new HTTP-client crate, a stray keychain literal, a widened
// CSP/capability/assetProtocol/updater field, or an obvious sensitive-log
// regression FAIL the lint chain until the change is declared in
// scripts/fixtures/egress-allowlist.json. It cannot prove the absence of a
// leak — see docs/development/security.md for the exact limits of each guard.
//
// Parity idiom: like check-breve-contract.mjs / check-parity.mjs, the truth is
// a tracked fixture and this script asserts reality matches it.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const allow = JSON.parse(readFileSync(join(root, "scripts/fixtures/egress-allowlist.json"), "utf8"));
const failures = [];

const read = (rel) => readFileSync(join(root, rel), "utf8");
function listFiles(dir, re) {
  const out = [];
  for (const name of readdirSync(join(root, dir))) {
    const rel = join(dir, name);
    if (statSync(join(root, rel)).isFile() && re.test(name)) out.push(rel);
  }
  return out;
}
// strip // line comments + /* */ block comments so a commented reference never trips a grep
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

// ── (a) egress allowlist ──────────────────────────────────────────────────────
//
// Rust: every src-tauri/src file that uses the ureq HTTP client must be a
// declared egress site; no OTHER HTTP-client crate may enter Cargo.toml.
{
  const ureqFiles = allow.rust.ureqFiles;
  for (const rel of listFiles("src-tauri/src", /\.rs$/)) {
    const base = rel.split("/").pop();
    const code = stripComments(read(rel));
    if (/\bureq::/.test(code) || /fetch_agent\s*\(/.test(code)) {
      if (!(base in ureqFiles)) {
        failures.push(
          `${rel}: uses the ureq HTTP client but is not a declared egress site. ` +
            `Add it to egress-allowlist.json rust.ureqFiles with its destination class + guard (see docs/development/security.md).`,
        );
      }
    }
  }
  // Cargo.toml must not pull in a second HTTP client behind ureq's back.
  const cargo = read("src-tauri/Cargo.toml");
  for (const crate of allow.rust.deniedHttpCrates) {
    if (new RegExp(`^\\s*${crate.replace(/[-]/g, "[-_]")}\\s*=`, "m").test(cargo)) {
      failures.push(`src-tauri/Cargo.toml: HTTP-client crate "${crate}" is denied — ureq is the one vetted client.`);
    }
  }
}

// src/: the webview's CSP is connect-src ipc-only, so a raw fetch( in app code
// can never reach the asset protocol or the network — it fails at runtime with
// "Load failed" (the 2026-09-01 chat-drop regression). Every call site must be
// declared with its reason; file reads go through the IPC byte lane instead.
{
  const fetchFiles = allow.src?.rawFetchFiles ?? {};
  const walk = (dir) =>
    readdirSync(join(root, dir), { withFileTypes: true }).flatMap((entry) => {
      const rel = join(dir, entry.name);
      if (entry.isDirectory()) return walk(rel);
      return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [rel] : [];
    });
  for (const rel of walk("src")) {
    const code = stripComments(read(rel));
    if (/(^|[^.\w])fetch\s*\(/.test(code) && !(rel in fetchFiles)) {
      failures.push(
        `${rel}: raw fetch() in the webview is blocked by the ipc-only connect-src. ` +
          `Read vault files through corpusFileBytes, or declare the call site in egress-allowlist.json src.rawFetchFiles with its destination + guard.`,
      );
    }
  }
}

// breve-runtime: every raw fetch( site must be a declared egress file; node net
// modules restricted to the allowlist.
{
  const fetchFiles = allow.breveRuntime.rawFetchFiles;
  const imapFiles = allow.breveRuntime.imapFlowFiles;
  const netModules = allow.breveRuntime.nodeNetModules;
  for (const rel of listFiles("breve-runtime/scripts", /\.ts$/)) {
    const base = rel.split("/").pop();
    const code = stripComments(read(rel));
    // a RAW fetch: `fetch(` not preceded by `.` (excludes client.fetch / safeFetch)
    // and not `safeFetch`/`checkUrl` helpers.
    const rawFetch = /(^|[^.\w])fetch\s*\(/.test(code);
    if (rawFetch && !(base in fetchFiles)) {
      failures.push(
        `${rel}: raw fetch() call site is not declared. ` +
          `Route web reads through safe-fetch.ts, or add this file to egress-allowlist.json breveRuntime.rawFetchFiles with its destination + guard.`,
      );
    }
    // ImapFlow client.fetch — a different (allowlisted) surface
    if (/client\.fetch\s*\(/.test(code) && !(base in imapFiles) && !(base in fetchFiles)) {
      failures.push(`${rel}: client.fetch (ImapFlow) is not declared in egress-allowlist.json breveRuntime.imapFlowFiles.`);
    }
    // low-level node networking
    for (const mod of ["node:http", "node:https", "node:net", "node:tls", "node:dgram"]) {
      if (new RegExp(`["']${mod}(/\\w+)?["']`).test(code)) {
        const declared = netModules[base] ?? [];
        if (!declared.some((m) => m === mod || m.startsWith(`${mod}/`))) {
          failures.push(
            `${rel}: imports ${mod} — low-level networking must be declared in egress-allowlist.json breveRuntime.nodeNetModules.`,
          );
        }
      }
    }
  }
  // llm.ts must gate its endpoint through the locality guard before fetching
  // (requireMatch idiom): the loopback-only invariant is enforced in config, but
  // pin that llm.ts resolves through llmConfig (which throws on non-loopback).
  if (!/from ["']\.\/config["']/.test(read("breve-runtime/scripts/llm.ts")) || !/llmConfig\(/.test(read("breve-runtime/scripts/llm.ts"))) {
    failures.push("breve-runtime/scripts/llm.ts must resolve its endpoint via llmConfig() (the loopback-only locality gate).");
  }
  if (!/llmEndpointIsLocal|allowRemote/.test(read("breve-runtime/scripts/config.ts"))) {
    failures.push("breve-runtime/scripts/config.ts must keep the loopback-only local-tier gate (llmEndpointIsLocal + allowRemote knob).");
  }
}

// ── (a″) every declared egress SITE still calls the egress gate ───────────────
//
// The 2026-08-01 audit found this class three times over: an outbound lane that
// bounded its DESTINATION (a scheme allowlist, a fixed search host, a provider
// allowlist) while bounding its CONTENT not at all. `open_url` handed the OS any
// URL a compromised webview named; the organizer's remote lane sent any prompt
// the daemon built. Both were one function away from correct and neither was
// caught by anything mechanical. So: each function named in the fixture must
// reference `blocked_for_remote`, and the file's other outbound functions are
// caught by the ureq allowlist above.
{
  const sites = allow.rust.gatedEgressSites ?? {};
  const GATE = "blocked_for_remote";
  for (const [rel, fns] of Object.entries(sites)) {
    if (rel.startsWith("_")) continue;
    const code = stripComments(read(rel));
    for (const fn of fns) {
      // the function's body: from its signature to the next top-level `}`
      const start = code.search(new RegExp(`fn\\s+${fn}\\s*[(<]`));
      if (start < 0) {
        failures.push(
          `${rel}: declared egress site "${fn}" no longer exists. ` +
            `If it was renamed or removed, update egress-allowlist.json rust.gatedEgressSites in the same change.`,
        );
        continue;
      }
      const end = code.indexOf("\n}", start);
      const body = code.slice(start, end < 0 ? code.length : end);
      if (!body.includes(GATE)) {
        failures.push(
          `${rel}: ${fn} is a declared egress site but does not call crate::secret::${GATE}. ` +
            `An outbound lane must bound its CONTENT, not only its destination (docs/architecture/egress-threat-model.md).`,
        );
      }
    }
  }
}

// ── (a′) the TS agent-loop egress-tool set is complete ────────────────────────
//
// Every ToolName that isn't a known LOCAL tool must be in EGRESS_TOOLS, so a
// future off-device tool can't be added past the secret guard (audit info
// finding). Asserted here rather than as a runtime test so it rides the lint.
{
  const types = read("src/ai/types.ts");
  const loop = read("src/ai/loop.ts");
  const toolBlock = types.match(/export type ToolName\s*=([\s\S]*?);/);
  if (!toolBlock) failures.push("src/ai/types.ts: could not find the ToolName union to check EGRESS_TOOLS completeness.");
  const toolNames = toolBlock ? [...toolBlock[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]) : [];
  // create_note/update_note/create_document write INTO the vault and open_note opens a tab —
  // all stay on-device (no bytes leave), so they classify local (PR #4,
  // 2026-07-29; update_note added 2026-07-30, gated by corpus_read_ai + the
  // secure-context refusal in host.ts).
  const localTools = [
    "search_notes",
    "read_note",
    "create_note",
    // create_document encodes DOCX locally and writes only through the managed
    // corpus repository; secure-tainted runs are refused because DOCX has no
    // note protection metadata.
    "create_document",
    "update_note",
    "open_note",
    "search_memory",
    "read_memory",
    "read_file",
    // create_artifact composes only local note/document/sheet/PDF adapters.
    // host.ts refuses a secure-context chat; the Rust PDF boundary separately
    // rejects protected source and read-only output roots (2026-08-09).
    "create_artifact",
    // draw_board converts Mermaid → an Excalidraw board file entirely on
    // device (boards/composition mermaid-to-excalidraw) — a creation tool,
    // no egress; the host gates it behind the secure-context taint (2026-08-03)
    "draw_board",
  ];
  // WEB_TOOLS + IMAGE_TOOLS are spread into EGRESS_TOOLS; collect both arrays.
  const egressListed = [
    ...[...loop.matchAll(/const (?:WEB_TOOLS|IMAGE_TOOLS): ToolName\[\] = \[([^\]]*)\]/g)]
      .flatMap((m) => [...m[1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1])),
  ];
  for (const t of toolNames) {
    if (localTools.includes(t)) continue;
    if (!egressListed.includes(t)) {
      failures.push(
        `src/ai/loop.ts: tool "${t}" is neither a known local tool nor in EGRESS_TOOLS — classify it (its args would leave the device unguarded).`,
      );
    }
  }
}

// ── (b) keychain literals only via the named constants ────────────────────────
{
  const sites = new Set(allow.keychain.constantSites);
  const scanDirs = ["src-tauri/src", "src/lib", "src/ai", "breve-runtime/scripts", "src/components"];
  for (const dir of scanDirs) {
    for (const rel of walkTree(dir, /\.(rs|ts|tsx)$/)) {
      if (sites.has(rel)) continue;
      const code = stripComments(read(rel));
      for (const account of allow.keychain.accounts) {
        if (code.includes(`"${account}"`) || code.includes(`'${account}'`)) {
          failures.push(
            `${rel}: hard-coded keychain account literal "${account}" — import the named constant instead (${allow.keychain.constantSites.join(", ")}).`,
          );
        }
      }
    }
  }
}

// ── (c) tauri.conf.json + capabilities security snapshot ──────────────────────
{
  const conf = JSON.parse(read("src-tauri/tauri.conf.json"));
  const sec = conf.app?.security ?? {};
  const snap = allow.tauriConf;
  if (sec.csp !== snap.csp) failures.push("src-tauri/tauri.conf.json: csp drifted from the pinned snapshot (egress-allowlist.json tauriConf.csp). Update the snapshot in the same change if intentional.");
  if (sec.devCsp !== snap.devCsp) failures.push("src-tauri/tauri.conf.json: devCsp drifted from the pinned snapshot.");
  const scope = sec.assetProtocol?.scope ?? [];
  if (JSON.stringify(scope) !== JSON.stringify(snap.assetProtocolScope)) {
    failures.push("src-tauri/tauri.conf.json: assetProtocol.scope drifted from the pinned snapshot — a wider scope exposes more of the filesystem to the webview.");
  }
  const endpoints = conf.plugins?.updater?.endpoints ?? [];
  if (JSON.stringify(endpoints) !== JSON.stringify(snap.updaterEndpoints)) {
    failures.push("src-tauri/tauri.conf.json: updater endpoints drifted from the pinned snapshot — a new update source is a trust decision.");
  }
  const caps = JSON.parse(read("src-tauri/capabilities/default.json"));
  const perms = caps.permissions ?? [];
  if (JSON.stringify(perms) !== JSON.stringify(allow.capabilities.default)) {
    failures.push("src-tauri/capabilities/default.json: granted permissions drifted from the pinned snapshot (egress-allowlist.json capabilities.default) — a new plugin permission widens the webview's reach.");
  }
  const capabilityWebviews = caps.webviews ?? [];
  if (JSON.stringify(capabilityWebviews) !== JSON.stringify(allow.capabilities.defaultWebviews)) {
    failures.push("src-tauri/capabilities/default.json: app-owned webview targets drifted from the pinned snapshot — private browser guests must not inherit Rotli IPC.");
  }
  const capabilityWindows = caps.windows ?? [];
  if (JSON.stringify(capabilityWindows) !== JSON.stringify(allow.capabilities.defaultWindows)) {
    failures.push("src-tauri/capabilities/default.json: window-wide capability targets are forbidden — they grant every child webview Rotli IPC.");
  }
}

// ── (c′) public remote-relay deployment boundary ─────────────────────────────
//
// The relay is internet-facing and intentionally state-free. Keep the cheap
// defenses that make arbitrary public traffic an availability problem rather
// than an unbounded-memory or cross-role authority bug.
{
  const relay = allow.remoteRelay;
  const code = stripComments(read(relay.source));
  const dockerfile = read(relay.dockerfile);
  for (const [name, expected] of [
    ["MAX_CLOUD_FRAME_BYTES", relay.maxCloudFrameBytes],
    ["MAX_MCP_RESPONSE_BYTES", relay.maxMcpResponseBytes],
    ["MAX_DEVICE_FRAME_BYTES", relay.maxDeviceFrameBytes],
    ["MAX_DEVICE_WAITERS", relay.maxDeviceWaiters],
    ["MAX_CLOUD_REQUESTS", relay.maxCloudRequests],
  ]) {
    const match = code.match(new RegExp(`const\\s+${name}\\s*=\\s*([0-9_]+)`));
    const actual = match ? Number(match[1].replaceAll("_", "")) : Number.NaN;
    if (actual !== expected) {
      failures.push(`${relay.source}: ${name} must remain fixture-pinned at ${expected}.`);
    }
  }
  for (const marker of [
    'type TokenRole = "client" | "device"',
    'request.headers.has("origin")',
    '"application/json"',
    "maxRequestBodySize: MAX_DEVICE_FRAME_BYTES",
    "devices.size >= maxDeviceWaiters",
    "cloud.size >= maxCloudRequests",
  ]) {
    if (!code.includes(marker)) failures.push(`${relay.source}: missing public-relay guard ${JSON.stringify(marker)}.`);
  }
  if (!dockerfile.includes(`FROM ${relay.image}`) || !/^USER bun$/m.test(dockerfile)) {
    failures.push(`${relay.dockerfile}: must use the pinned ${relay.image} image as the unprivileged bun user.`);
  }
  if (existsSync(join(root, "services/rotli-mcp-relay/railway.json"))) {
    failures.push(
      "services/rotli-mcp-relay/railway.json: legacy Railway config-as-code is forbidden; use the scoped Dockerfile service profile.",
    );
  }
}

// ── (d) sensitive-content logging tripwire (heuristic) ────────────────────────
//
// Flags a print/log statement in an egress-adjacent file whose argument names a
// body/secret/prompt-shaped variable. DOCUMENTED LIMIT: a renamed variable or an
// interpolated helper slips it — this catches the obvious regression, not a
// determined leak. See docs/development/security.md.
{
  const argRe = new RegExp(allow.sensitiveLogging.forbiddenLogArgPattern, "i");
  for (const rel of allow.sensitiveLogging.egressAdjacentFiles) {
    const code = stripComments(read(rel));
    const logRe = /\b(?:println!|eprintln!|console\.(?:log|warn|error|info|debug))\s*\(([^;\n]*)/g;
    for (const m of code.matchAll(logRe)) {
      if (argRe.test(m[1])) {
        failures.push(
          `${rel}: a log statement references a body/secret/prompt-shaped variable — do not log egress content (${m[1].trim().slice(0, 60)}…).`,
        );
      }
    }
  }
}

// ── (e) update checks are user-initiated ─────────────────────────────────────
//
// Local-first also describes network behavior: the updater feed may be queried
// from the explicit Settings control, never from app mount, visibility, or a
// timer. This catches a recurrence without pretending that a grep proves the
// wider absence of network activity (the egress inventory above owns that).
{
  const allowedCallers = new Set(["src/components/settingsSurface.tsx"]);
  for (const rel of walkTree("src", /\.(ts|tsx)$/)) {
    if (rel === "src/lib/tauri.ts") continue; // capability implementation
    const code = stripComments(read(rel));
    if (/\bcheckForUpdate\s*\(/.test(code) && !allowedCallers.has(rel)) {
      failures.push(
        `${rel}: checks the updater feed outside the explicit Settings action — Rotli must not phone home on launch, visibility, or a timer.`,
      );
    }
  }
}

function walkTree(dir, re) {
  const out = [];
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    for (const name of readdirSync(join(root, d))) {
      const rel = join(d, name);
      const st = statSync(join(root, rel));
      if (st.isDirectory()) stack.push(rel);
      else if (re.test(name)) out.push(rel);
    }
  }
  return out;
}

if (failures.length) {
  console.error(`check:security failed:\n${failures.map((l) => `  - ${l}`).join("\n")}`);
  process.exit(1);
}
console.log(
  "check:security ok — egress sites declared, keychain literals constant-only, CSP/capability/updater snapshot intact, updater checks user-initiated, no sensitive logging",
);
