/**
 * BREVE write+read sandbox — OS-level enforcement of the access policy for the MODEL subprocesses.
 *
 * Breve is a local-first PERSONAL assistant tied to its memex brain — not a code/repo agent. The
 * tool-bearing tiers (claude -p, agy) run with --dangerously-skip-permissions, so without this they
 * could read and write anywhere you can. This wraps them in macOS `sandbox-exec` with a profile that:
 *   • allows everything by default (network, spawn git/gh/grep, read system libraries, etc.)
 *   • DENIES reads inside $HOME except the policy roots (the memex, storage, managed runtime) and the
 *     CLIs' own state (so it CANNOT read your other projects, ~/Documents, ~/.ssh, ~/Library/Messages, …)
 *   • DENIES all file writes except those same roots (+ the CLIs' state + temp).
 *   • LOCKS DOWN the CLI tool homes (deny-by-default inside them, re-allow only the runtime DATA each
 *     tool writes) so a (prompt-injected) model can't plant code/instructions that run UNSANDBOXED on
 *     the next claude/agy/git run. Covered exec surfaces: ~/.claude/{hooks,skills,commands,agents,
 *     plugins,bin,settings*.json,CLAUDE.md,statusline-command.sh,…}, ~/.claude.json, all of ~/.codex,
 *     ~/.gemini & ~/.antigravity {extensions,settings,GEMINI.md,argv.json,*.sh,*.md}, ~/.config/{git,gh},
 *     ~/.bun/bin, ~/.local/bin, and any .git hooks (incl. submodules + core.hooksPath). New config a future tool
 *     version adds inside a locked home is denied BY DEFAULT — the policy is allowlist-data, not deny-bad.
 *   • ISOLATES ~/.breve-secrets entirely: explicit deny read+write (model can neither see nor touch it).
 * Net: the model reads/writes only the brain + storage + its own files; system paths stay readable so
 * the tools run; the deny is inherited by children, so a model-run cat/git/Write against a local project
 * or the home dir fails at the OS — not just the prompt. External reach is the WEB + GitHub via `gh`.
 *
 * Keychain note: claude reads its OAuth token by spawning `security`, so ~/Library/Keychains must stay
 * readable — but ONLY for that login-keychain token. Breve's own secrets (Resend key, mail passwords)
 * now live in a SEPARATE keychain (breve.keychain-db) that the sandbox explicitly denies read+write, so
 * no tool-tier model can reach them; the prior hard-isolation follow-up is resolved. The daemon itself
 * is NOT sandboxed (trusted, deterministic code).
 *
 * Knob (per the Configuration Rule): BREVE_SANDBOX=0 disables it (safe fallback if a tool needs a new
 * path) — set it in the launchd plist env. On a non-macOS host (no sandbox-exec) wrap() is a no-op.
 */
import { writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { knowledgePath, storagePath } from "./config";

const HOME = process.env.HOME!;
const BREVE_ROOT = process.env.ROTLI_BREVE_HOME ?? join(import.meta.dir, "..");
const SANDBOX_EXEC = "/usr/bin/sandbox-exec";
const ENABLED = process.env.BREVE_SANDBOX !== "0";

// Breve's own secrets live in a separate keychain the model must never read or write (only claude's
// login-keychain token under ~/Library/Keychains stays reachable).
const BREVE_KEYCHAIN = `${HOME}/Library/Keychains/breve.keychain-db`;

// A secrets directory the model can neither read nor write (belt-and-suspenders: also outside the
// read allow-list). Explicit deny placed as a last match so nothing re-allows it.
const BREVE_SECRETS = `${HOME}/.breve-secrets`;

// The DEFAULT policy roots (admin / single-tenant): the whole brain + storage + Breve. A per-principal
// call narrows these to one partition (+ that user's storage) — that narrowing is the isolation teeth.
// Config-derived (knowledgePath/storagePath) so the boundary tracks wherever you point Breve.
const POLICY_READ_DEFAULT = [knowledgePath(), storagePath(), BREVE_ROOT];
const POLICY_WRITE_DEFAULT = [knowledgePath(), storagePath(), BREVE_ROOT];

// Shared PLUMBING readable by every model run regardless of partition (tool + system state); the
// policy roots are prepended per-call. (Everything OUTSIDE $HOME stays readable for the tools/system.)
const PLUMBING_READ_SUBPATHS = [
  `${HOME}/.claude`, `${HOME}/.cache`, `${HOME}/.bun`, `${HOME}/.config`,   // claude + bun + general
  `${HOME}/.npm`, `${HOME}/.local`, `${HOME}/.antigravity`, `${HOME}/.gemini`, `${HOME}/.codex`,
  `${HOME}/Library/Caches`, `${HOME}/Library/Preferences`, `${HOME}/Library/Fonts`,
  `${HOME}/Library/Application Support/Antigravity`,
  `${HOME}/Library/Application Support/Google`,
  `${HOME}/Library/Keychains`,                                             // claude's OAuth token lives here
];
const READ_HOME_LITERALS = [
  `${HOME}/.claude.json`, `${HOME}/.claude.json.backup`,
  `${HOME}/.zshrc`, `${HOME}/.zshenv`, `${HOME}/.zprofile`,
  `${HOME}/.bashrc`, `${HOME}/.bash_profile`, `${HOME}/.profile`,
  `${HOME}/.gitconfig`, `${HOME}/.npmrc`, `${HOME}/.inputrc`, `${HOME}/.hushlogin`,
];

// Paths the model may WRITE: the policy roots + the CLIs' own state + temp (a subset is also read).
// NOTE: tool homes (~/.claude, ~/.gemini, ~/.antigravity) are allowed HERE but then locked down below
// to deny-by-default with a data re-allow. ~/.codex is intentionally NOT here (codex self-sandboxes
// and is no longer wrapped by us, so nothing we wrap writes there).
const PLUMBING_WRITE_SUBPATHS = [
  `${HOME}/.claude`, `${HOME}/.cache`, `${HOME}/.bun`, `${HOME}/.config`,
  `${HOME}/.npm`, `${HOME}/.local`, `${HOME}/.antigravity`, `${HOME}/.gemini`,
  `${HOME}/Library/Application Support/Antigravity`,
  `${HOME}/Library/Application Support/Google`,
  `${HOME}/Library/Caches`, `${HOME}/Library/Preferences`,
  `${HOME}/Library/Keychains`,                                             // claude persists token refreshes
  "/private/tmp", "/private/var/folders", "/var/folders", "/tmp", "/dev",
];
// No write LITERALS at $HOME root: ~/.claude.json is config (mcpServers etc.) and stays read-only.
const WRITE_LITERALS: string[] = [];

// Inside ~/.claude (locked deny-by-default) these are the RUNTIME DATA the model tier legitimately
// writes — re-allowed so claude -p keeps working. Everything else in ~/.claude (config/exec) is denied.
const CLAUDE_DATA_SUBPATHS = [
  "projects", "sessions", ".sessions", "shell-snapshots", "file-history", "session-env",
  "cache", "image-cache", "paste-cache", "screenshots", "downloads", "telemetry", "statsig",
  "debug", "jobs", "plans", "tasks", "teams", "backups", "daemon", "ide",
].map((d) => `${HOME}/.claude/${d}`);
const CLAUDE_DATA_LITERALS = [
  ".credentials.json", "history.jsonl", ".last-cleanup", ".last-update-result.json",
  "stats-cache.json", "mcp-needs-auth-cache.json", "daemon.log",
].map((f) => `${HOME}/.claude/${f}`);

// Inside ~/.gemini (locked deny-by-default) these are the RUNTIME DATA agy legitimately writes
// (auth/state/history). Everything else — commands/, extensions/, settings.json, GEMINI.md,
// trustedFolders.json, and any NEW config — is denied. Exec file types are denied even here (regex below).
const GEMINI_DATA_SUBPATHS = [
  "history", "tmp", "config", "antigravity", "antigravity-backup",
  "antigravity-browser-profile", "antigravity-cli", "antigravity-ide",
].map((d) => `${HOME}/.gemini/${d}`);
const GEMINI_DATA_LITERALS = [
  "oauth_creds.json", "mcp-oauth-tokens.json", "google_accounts.json",
  "projects.json", "state.json", "installation_id",
].map((f) => `${HOME}/.gemini/${f}`);

const sub = (p: string) => `  (subpath ${JSON.stringify(p)})`;
const lit = (p: string) => `  (literal ${JSON.stringify(p)})`;
const denySub = (p: string) => `  (deny file-write* (subpath ${JSON.stringify(p)}))`;
const denyLit = (p: string) => `  (deny file-write* (literal ${JSON.stringify(p)}))`;

export type SandboxRoots = { readRoots: string[]; writeRoots: string[] };
const DEFAULT_ROOTS: SandboxRoots = { readRoots: POLICY_READ_DEFAULT, writeRoots: POLICY_WRITE_DEFAULT };

// SBPL: last matching rule wins → allow all, carve out reads to $HOME, carve out all writes. The
// POLICY ROOTS (readRoots/writeRoots) vary per principal; everything below them — plumbing, the
// tool-home lockdowns, the .git/keychain/secrets denies — is user-independent hardening.
function buildProfile(roots: SandboxRoots): string {
  const READ_HOME_SUBPATHS = [...roots.readRoots, ...PLUMBING_READ_SUBPATHS];
  const WRITE_SUBPATHS = [...roots.writeRoots, ...PLUMBING_WRITE_SUBPATHS];
  return [
  "(version 1)",
  "(allow default)",
  // READS: deny within $HOME, then re-allow the policy roots + tool state (system paths unaffected).
  `(deny file-read* (subpath ${JSON.stringify(HOME)}))`,
  `(allow file-read-metadata (literal ${JSON.stringify(HOME)}))`, // stat ~ itself (cwd), not its children
  "(allow file-read*",
  ...READ_HOME_SUBPATHS.map(sub),
  ...READ_HOME_LITERALS.map(lit),
  ")",
  `(deny file-read* (literal ${JSON.stringify(BREVE_KEYCHAIN)}))`, // last-match: Breve's own secrets stay hidden
  `(deny file-read* (subpath ${JSON.stringify(BREVE_SECRETS)}))`,  // last-match: ~/.breve-secrets unreadable
  // WRITES: deny everywhere, then re-allow the policy roots + tool state + temp.
  "(deny file-write*)",
  "(allow file-write*",
  ...WRITE_SUBPATHS.map(sub),
  ...WRITE_LITERALS.map(lit),
  ")",
  // ── Tool-home lockdown (deny-by-default inside each home; re-allow only runtime DATA) ──────────
  // A write that becomes CODE or INSTRUCTIONS on the next claude/agy/git run must be denied even
  // though the home is broadly writable above. New config a future version adds is denied by default.
  // ~/.claude: lock the home, re-open only the data the model tier writes (transcripts, caches, token).
  denySub(`${HOME}/.claude`),
  "(allow file-write*",
  ...CLAUDE_DATA_SUBPATHS.map(sub),
  ...CLAUDE_DATA_LITERALS.map(lit),
  ")",
  // ~/.codex: codex self-sandboxes and is no longer wrapped by us — nothing we wrap writes here, deny all.
  denySub(`${HOME}/.codex`),
  // ~/.gemini + ~/.antigravity: agy writes DATA here, so DENY-BY-DEFAULT inside each home and re-allow
  // only the runtime data agy needs (auth/state/history). commands/*.toml, extensions/, settings.json,
  // GEMINI.md, trustedFolders.json, argv.json, and ANY new config a future version adds are denied by
  // default — closing the gemini-CLI custom-command (shell) injection + credential/trust poisoning.
  denySub(`${HOME}/.gemini`),
  "(allow file-write*",
  ...GEMINI_DATA_SUBPATHS.map(sub),
  ...GEMINI_DATA_LITERALS.map(lit),
  ")",
  denySub(`${HOME}/.antigravity`),
  "(allow file-write*",
  sub(`${HOME}/.antigravity/antigravity`),
  ")",
  // Backstop: no script/command/instruction file TYPE may be written ANYWHERE in these homes — even
  // inside a re-allowed data dir — so a planted .toml/.js/.py/.sh/.md/.yaml can't slip through.
  '(deny file-write* (regex #"/\\.(gemini|antigravity)/.*\\.(sh|md|toml|js|mjs|cjs|py|ya?ml)$"))',
  // Git + GitHub-CLI config: a write here = core.hooksPath / alias=!cmd / token tamper on next git/gh.
  denySub(`${HOME}/.config/git`),
  denySub(`${HOME}/.config/gh`),
  // ~/.claude.json: Claude Code's user config (mcpServers stdio servers spawn on launch) — read-only.
  denyLit(`${HOME}/.claude.json`),
  denyLit(`${HOME}/.claude.json.backup`),
  // Interpreter bin dirs on PATH.
  denySub(`${HOME}/.bun/bin`),
  denySub(`${HOME}/.local/bin`),
  // Any .git hook surface inside a writable root — direct hooks, submodule hooks, and core.hooksPath
  // (set via .git/config), all of which exec on the next git/gh.
  '(deny file-write* (regex #"/\\.git/hooks(/|$)"))',
  '(deny file-write* (regex #"/\\.git/config$"))',
  '(deny file-write* (regex #"/\\.git/modules/.*/hooks(/|$)"))',
  // Breve's own secrets — the last word, never re-opened.
  `(deny file-write* (literal ${JSON.stringify(BREVE_KEYCHAIN)}))`,
  `(deny file-write* (subpath ${JSON.stringify(BREVE_SECRETS)}))`,
  "",
  ].join("\n");
}

// One cached .sb file per distinct root-set (admin and each member get their own, by content hash).
const profileCache = new Map<string, string>();
function ensureProfile(roots: SandboxRoots = DEFAULT_ROOTS): string | null {
  const key = JSON.stringify([roots.readRoots, roots.writeRoots]);
  const cached = profileCache.get(key);
  if (cached) return cached;
  try {
    const dir = join(HOME, ".cache", "breve");
    mkdirSync(dir, { recursive: true });
    const hash = Bun.hash(key).toString(16);
    // Keep the default profile's stable name (back-compat with --print / existing tooling).
    const fname = key === JSON.stringify([DEFAULT_ROOTS.readRoots, DEFAULT_ROOTS.writeRoots])
      ? "breve-write-sandbox.sb" : `sandbox-${hash}.sb`;
    const p = join(dir, fname);
    writeFileSync(p, buildProfile(roots));
    profileCache.set(key, p);
    return p;
  } catch {
    return null;
  }
}

/** True when the sandbox will actually wrap commands (macOS + enabled). */
export const sandboxActive = ENABLED && existsSync(SANDBOX_EXEC);

/** Wrap an argv so it runs under the sandbox. `roots` narrows the policy roots to one partition (the
 *  isolation teeth); omitted ⇒ the default admin/whole-brain roots (back-compat). No-op (returns argv
 *  unchanged) if disabled/unavailable, so the daemon never hard-fails. Pass an ABSOLUTE program path. */
export function sandboxed(argv: string[], roots: SandboxRoots = DEFAULT_ROOTS): string[] {
  if (!sandboxActive) return argv;
  const p = ensureProfile(roots);
  return p ? [SANDBOX_EXEC, "-f", p, ...argv] : argv;
}

/** Build the sandbox roots for a partition. KNOWLEDGE is always scoped to the ACTIVE partition (so
 *  partitions — incl. an admin's own personas — stay mutually isolated). The admin additionally gets
 *  the storage + managed-runtime roots read+write for brief/action machinery; a member gets only their
 *  partition and never the unpartitioned runtime. For
 *  the single-tenant __default__ partition, knowledgeRoot === the memex base, so the admin roots equal
 *  the whole-brain roots. */
export function rootsForPartition(opts: { knowledgeRoot: string; storageRoot?: string; admin?: boolean }): SandboxRoots {
  const breve = BREVE_ROOT;
  if (opts.admin) {
    const storage = storagePath();
    return { readRoots: [opts.knowledgeRoot, storage, breve], writeRoots: [opts.knowledgeRoot, storage, breve] };
  }
  // A member gets ONLY their partition (+ shared tool/system plumbing added in buildProfile). Crucially
  // NOT the managed runtime: that tree is unpartitioned and holds the owner's signal.json / mail-accounts.json /
  // recipients.json / access.json / briefs / logs / every principal's transcripts — a member's model
  // tier (agy/claude, standalone CLIs that need no runtime files) must never read it. (FORGE H1/H2.)
  const store = opts.storageRoot ?? opts.knowledgeRoot;
  return {
    readRoots: [opts.knowledgeRoot, store],
    writeRoots: [opts.knowledgeRoot, store],
  };
}

// CLI: `bun scripts/sandbox.ts --print` shows the profile; `--selftest [--user <name>]` checks the
// boundary (with --user: a member profile, asserting cross-partition reads/writes are DENIED).
if (import.meta.main) {
  const arg = process.argv[2];
  const userIdx = process.argv.indexOf("--user");
  const selftestUser = userIdx >= 0 ? process.argv[userIdx + 1] : undefined;
  if (arg === "--print") {
    console.log(`active: ${sandboxActive}\nprofile: ${ensureProfile()}\n\n${buildProfile(DEFAULT_ROOTS)}`);
  } else if (arg === "--selftest" && selftestUser) {
    // Member-isolation test: build a member profile over a throwaway "own" partition and assert it
    // CANNOT reach a sibling "other" partition or write the managed runtime, while its own partition is read+write.
    const store = storagePath(), brain = knowledgePath();
    const own = `${store}/.sbtest-own`, other = `${store}/.sbtest-other`;
    mkdirSync(own, { recursive: true }); mkdirSync(other, { recursive: true });
    writeFileSync(join(other, "secret.txt"), "another partition's data\n");
    const roots = rootsForPartition({ knowledgeRoot: own, storageRoot: own, admin: false });
    const p = ensureProfile(roots)!;
    const run = (script: string) => Bun.spawnSync([SANDBOX_EXEC, "-f", p, "/bin/bash", "-c", script]).exitCode;
    const W = (label: string, path: string, want: "allow" | "deny") => {
      const code = run(`echo x > ${JSON.stringify(path)} 2>/dev/null`);
      const wrote = existsSync(path);
      if (wrote && want === "deny") { try { rmSync(path, { force: true }); } catch {} }
      else if (wrote) { try { rmSync(path, { force: true }); } catch {} }
      return [label, want === "allow" ? code === 0 : code !== 0 && !wrote] as [string, boolean];
    };
    const checks: Array<[string, boolean]> = [
      W(`member writes OWN partition ALLOWED`, join(own, ".sbtest"), "allow"),
      ["member reads OWN partition ALLOWED", run(`cat ${JSON.stringify(join(own, "."))} >/dev/null 2>&1; ls ${JSON.stringify(own)} >/dev/null 2>&1`) === 0],
      W(`member writes OTHER partition DENIED`, join(other, ".sbtest"), "deny"),
      ["member reads OTHER partition DENIED", run(`cat ${JSON.stringify(join(other, "secret.txt"))} >/dev/null 2>&1`) !== 0],
      ["member reads brain root DENIED", run(`ls ${brain} >/dev/null 2>&1`) !== 0],
      // The managed runtime is the owner's unpartitioned store — a member must NOT read it.
      ["member reads managed runtime root DENIED", run(`ls ${JSON.stringify(BREVE_ROOT)} >/dev/null 2>&1`) !== 0],
      ["member reads managed signal.json DENIED", run(`cat ${JSON.stringify(join(BREVE_ROOT, "signal.json"))} >/dev/null 2>&1`) !== 0],
      ["member reads managed mail config DENIED", run(`cat ${JSON.stringify(join(BREVE_ROOT, "mail-accounts.json"))} >/dev/null 2>&1`) !== 0],
      ["member reads managed transcripts DENIED", run(`ls ${JSON.stringify(join(BREVE_ROOT, "signal", "transcripts"))} >/dev/null 2>&1`) !== 0],
      ["member reads managed briefs DENIED", run(`ls ${JSON.stringify(join(BREVE_ROOT, "briefs"))} >/dev/null 2>&1`) !== 0],
      W(`member writes managed runtime DENIED`, join(BREVE_ROOT, ".sbtest"), "deny"),
      ["member reads ~/.breve-secrets DENIED", run(`ls ${HOME}/.breve-secrets >/dev/null 2>&1`) !== 0],
    ];
    let ok = true;
    for (const [label, pass] of checks) { console.log(`${pass ? "✓" : "✗"} ${label}`); if (!pass) ok = false; }
    try { rmSync(own, { recursive: true, force: true }); rmSync(other, { recursive: true, force: true }); } catch {}
    process.exit(ok ? 0 : 1);
  } else if (arg === "--selftest") {
    const p = ensureProfile()!;
    const run = (script: string) => Bun.spawnSync([SANDBOX_EXEC, "-f", p, "/bin/bash", "-c", script]).exitCode;
    // Completeness self-test: assert WRITE is DENIED across EVERY exec/config surface (not just a
    // mirror of the deny rules) AND that the runtime DATA each tool needs stays WRITABLE — so a policy
    // omission shows up as a failing "DENIED" check, and an over-broad lock shows up as a failing
    // "ALLOWED" check. Parent dirs are pre-created UNSANDBOXED so a deny isn't faked by a missing dir.
    const settingsExisted = existsSync(`${HOME}/.claude/settings.json`);
    const secretsExisted = existsSync(BREVE_SECRETS);
    const STORE = storagePath(), BRAIN = knowledgePath();
    const SCRATCH = `${STORE}/.sbtest-git`; // throwaway "repo" for .git/* deny tests (never a real repo)
    for (const d of [
      `${HOME}/.claude/hooks`, `${HOME}/.claude/skills`, `${HOME}/.claude/commands`,
      `${HOME}/.claude/plugins`, `${HOME}/.claude/bin`, `${HOME}/.claude/projects`,
      `${HOME}/.claude/shell-snapshots`, `${HOME}/.gemini/extensions`, `${HOME}/.gemini/tmp`,
      `${HOME}/.gemini/commands`, `${HOME}/.gemini/config`, `${HOME}/.gemini/history`,
      `${HOME}/.antigravity/extensions`, `${HOME}/.antigravity/antigravity`,
      `${HOME}/.config/git`, `${HOME}/.config/gh`,
      `${HOME}/.bun/bin`, `${HOME}/.local/bin`, `${HOME}/.codex`,
      `${SCRATCH}/.git/hooks`, `${SCRATCH}/.git/modules/x/hooks`,
    ]) mkdirSync(d, { recursive: true });
    if (!settingsExisted) writeFileSync(`${HOME}/.claude/settings.json`, "{}\n");
    mkdirSync(BREVE_SECRETS, { recursive: true });

    const W = (label: string, path: string, want: "allow" | "deny") => {
      const code = run(`echo x > ${JSON.stringify(path)} 2>/dev/null`);
      const wrote = existsSync(path);
      // For allow-tests, clean the artifact we just made; for deny-tests, clean any LEAK (deny failed).
      if (wrote) { try { rmSync(path, { force: true }); } catch {} }
      const pass = want === "allow" ? code === 0 && true : code !== 0 && !wrote;
      return [label, pass] as [string, boolean];
    };

    const checks: Array<[string, boolean]> = [
      // ── base boundary ──
      W("write managed runtime allowed", join(BREVE_ROOT, ".sbtest"), "allow"),
      W("write storage root allowed", `${STORE}/.sbtest`, "allow"),
      W("write brain root allowed", `${BRAIN}/.sbtest`, "allow"),
      W("write ~/Documents (outside policy) DENIED", `${HOME}/Documents/.sbtest`, "deny"),
      W("write home root DENIED", `${HOME}/.sbtest`, "deny"),
      ["read brain root allowed", run(`ls ${BRAIN} >/dev/null 2>&1`) === 0],
      ["read ~/.ssh DENIED", run(`ls ${HOME}/.ssh >/dev/null 2>&1`) !== 0],
      ["read ~/Documents DENIED", run(`ls ${HOME}/Documents >/dev/null 2>&1`) !== 0],
      ["read /usr (system) allowed", run(`ls /usr/bin >/dev/null 2>&1`) === 0],
      // ── ~/.claude: runtime DATA writable, exec/config DENIED, config still READABLE ──
      W("write ~/.claude/projects (data) ALLOWED", `${HOME}/.claude/projects/.sbtest`, "allow"),
      W("write ~/.claude/shell-snapshots (data) ALLOWED", `${HOME}/.claude/shell-snapshots/.sbtest`, "allow"),
      W("write ~/.claude root file DENIED", `${HOME}/.claude/.sbtest`, "deny"),
      W("write ~/.claude/*.sh (statusline class) DENIED", `${HOME}/.claude/.sbtest.sh`, "deny"),
      W("write ~/.claude/hooks DENIED", `${HOME}/.claude/hooks/.sbtest`, "deny"),
      W("write ~/.claude/skills DENIED", `${HOME}/.claude/skills/.sbtest`, "deny"),
      W("write ~/.claude/commands DENIED", `${HOME}/.claude/commands/.sbtest.md`, "deny"),
      W("write ~/.claude/plugins DENIED", `${HOME}/.claude/plugins/.sbtest`, "deny"),
      W("write ~/.claude/bin DENIED", `${HOME}/.claude/bin/.sbtest`, "deny"),
      ["read ~/.claude/settings.json ALLOWED", run(`cat ${HOME}/.claude/settings.json >/dev/null 2>&1`) === 0],
      W("write ~/.claude.json-class (home-root json) DENIED", `${HOME}/.sbtest.json`, "deny"),
      // ── ~/.codex: full lockdown (codex unwrapped) ──
      W("write ~/.codex DENIED", `${HOME}/.codex/.sbtest`, "deny"),
      ["read ~/.codex allowed", run(`ls ${HOME}/.codex >/dev/null 2>&1`) === 0],
      // ── ~/.gemini / ~/.antigravity: DENY-BY-DEFAULT, only agy runtime DATA writable ──
      W("write ~/.gemini/history (data json) ALLOWED", `${HOME}/.gemini/history/.sbtest.json`, "allow"),
      W("write ~/.gemini/tmp (data) ALLOWED", `${HOME}/.gemini/tmp/.sbtest`, "allow"),
      W("write ~/.gemini root file DENIED", `${HOME}/.gemini/.sbtest`, "deny"),
      W("write ~/.gemini/commands/*.toml (cmd injection) DENIED", `${HOME}/.gemini/commands/.sbtest.toml`, "deny"),
      W("write ~/.gemini/extensions DENIED", `${HOME}/.gemini/extensions/.sbtest`, "deny"),
      W("write ~/.gemini/*.toml DENIED", `${HOME}/.gemini/.sbtest.toml`, "deny"),
      W("write ~/.gemini/config/*.js (backstop in data dir) DENIED", `${HOME}/.gemini/config/.sbtest.js`, "deny"),
      W("write ~/.gemini/*.sh DENIED", `${HOME}/.gemini/.sbtest.sh`, "deny"),
      W("write ~/.antigravity/antigravity (data) ALLOWED", `${HOME}/.antigravity/antigravity/.sbtest`, "allow"),
      W("write ~/.antigravity root file DENIED", `${HOME}/.antigravity/.sbtest`, "deny"),
      W("write ~/.antigravity/extensions DENIED", `${HOME}/.antigravity/extensions/.sbtest`, "deny"),
      // ── git + gh config ──
      W("write ~/.config/git DENIED", `${HOME}/.config/git/.sbtest`, "deny"),
      W("write ~/.config/gh DENIED", `${HOME}/.config/gh/.sbtest`, "deny"),
      // ── interpreter bins ──
      W("write ~/.bun/bin DENIED", `${HOME}/.bun/bin/.sbtest`, "deny"),
      W("write ~/.local/bin DENIED", `${HOME}/.local/bin/.sbtest`, "deny"),
      // ── .git escape surfaces inside a writable root ──
      W("write <root>/.git/hooks DENIED", `${SCRATCH}/.git/hooks/.sbtest`, "deny"),
      W("write <root>/.git/config DENIED", `${SCRATCH}/.git/config`, "deny"),
      W("write <root>/.git/modules/*/hooks DENIED", `${SCRATCH}/.git/modules/x/hooks/.sbtest`, "deny"),
      // ── secrets ──
      W("write ~/.breve-secrets DENIED", `${HOME}/.breve-secrets/.sbtest`, "deny"),
      ["read ~/.breve-secrets DENIED", run(`ls ${HOME}/.breve-secrets >/dev/null 2>&1`) !== 0],
    ];
    let ok = true;
    for (const [label, pass] of checks) { console.log(`${pass ? "✓" : "✗"} ${label}`); if (!pass) ok = false; }
    // Teardown: only remove fixtures this run created; nuke the throwaway git scratch.
    if (!settingsExisted) rmSync(`${HOME}/.claude/settings.json`, { force: true });
    if (!secretsExisted) rmSync(BREVE_SECRETS, { recursive: true, force: true });
    try { rmSync(SCRATCH, { recursive: true, force: true }); } catch {}
    process.exit(ok ? 0 : 1);
  } else {
    console.error("usage: sandbox.ts --print | --selftest");
  }
}
