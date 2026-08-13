// The memex contract — MIRRORED BY VALUE, never imported.
//
// rotli is a separate repo. The memex (memex-vault) is a SIBLING resolved by path at
// runtime; it may be ABSENT or a DRIFTED copy, and its engine (mounts.ts /
// conversations.ts / validate.ts) is bun/node — it CANNOT run in this webview at
// all. So, exactly like the embedded brief runtime's config.ts (see breve-runtime/docs/memex-boundary.md),
// rotli RE-IMPLEMENTS the file-format contract here, by value, and performs the
// actual bytes-to-disk through its own Rust commands. The brain's validate.ts is
// only ever SHELLED OUT to (Rust), never imported.
//
// DO NOT "DRY this up" by importing memex-vault's mounts.ts / conversations.ts — that
// re-introduces module-load coupling and breaks rotli when the memex is missing or
// its engine has drifted. This file is kept byte-identical to:
//   • memex-vault/scripts/conversations.ts  (slugify, the chat file shape, message
//     lines, the `## Chat` backlink, the inbox line, the `updated:` bump)
//   • memex-vault/scripts/mounts.ts          (accessMode fail-closed, memexId pinning,
//     the contract-version range math)
// contract.test.ts is the guard; re-sync this file whenever memex-vault bumps
// CONTRACT_VERSION or changes the chat/inbox shape. All functions here are PURE
// (no I/O, no React) so they unit-test in a plain browser.

// rotli is built against the v3.5 note contract (it writes the per-note frontmatter
// + the wiki/_inbox staging path). v3.6 split the brain's self/ → identity/ +
// personality/ and added the org layer — but rotli's WRITE surfaces (chats/ and
// wiki/_inbox/; inbox.md was dropped as a declared surface 2026-07, #96 — nothing
// ever wrote it) are untouched by that, so rotli stays fully compatible; the band just
// extends to 3.6 so a v3.6 brain is in-range. It still WRITES to a v3.4 brain (the
// chat/inbox shape didn't change; a 3.4 brain just warns on the new note fields, never
// errors), so the supported band is [MIN_CONTRACT, CONTRACT_VERSION] — a brain whose
// memex.json still reads "3.4" stays writable. Out of the band ⇒ the brain opens read-only.
//
// v3.7 (2026-07-01) opens ONE surface to a SECOND actor: the AI FILER may write the
// curated `wiki/**` (area/summary/tags/links/… — the AI_KEYS) and file _inbox notes
// into areas, subject to `locked`. The USER's write lane (canWrite) is byte-unchanged.
// v3.8 (2026-07-24) adds readable filename projections, rename aliases, and a
// deterministic read-only query grammar. Durable identity and write lanes are
// unchanged; Rotli mirrors the grammar through CLI/MCP and extends the band.
export const CONTRACT_VERSION = "3.8";
export const MIN_CONTRACT = "3.4";

/** Sources allowed on the chats surface (conversations.ts SURFACES.chats.sources).
 *  rotli always writes as "rotli". */
export const CHAT_SOURCES = ["rotli", "app", "claude", "manual", "signal"] as const;
export const ROTLI_SOURCE = "rotli";

export type AccessMode = "local" | "open" | "secure";
// v3.7: "chats+inbox+file" NAMES the Filer lane in the contract mirror — no TS code
// runs with it (#95, audit 2026-07). The Filer executes entirely in Rust (organizer.rs
// through corpus.rs's filer gates); the app-facing Perms (memex/config.ts / tauri.ts
// MemexPerms) deliberately exclude the tier, so no user or linked library can ever be
// granted it. The interactive editor is always "chats+inbox". The tier stays in this
// union only so the contract can name both lanes; canFile/mayFile below are likewise
// mirror-by-value pins of the Rust gate (contract.test.ts), not a live TS write path.
export type Perms = "chats+inbox" | "chats+inbox+file" | "read-only";

export interface MemexInfo {
  id: string;
  contract: string;
  createdAt: string;
  selfHeal?: boolean;
  apps: Record<string, { role?: string; connectedAt: string }>;
}

export interface ChatMsg {
  speaker: string;
  text: string;
  at?: string;
}

export interface ChatMeta {
  title: string;
  source: string;
  id?: string;
  slug?: string;
  attachedTo?: string;
  participants?: string[];
}

/** Durable navigation references created by a chat. They point at ordinary
 * vault files; the chat owns only the association, never the artifact bytes. */
export interface ChatArtifact {
  kind: "note" | "file" | "canvas";
  id: string;
  /** Optional presentation only. Identity and authority remain `kind` + `id`. */
  label?: string;
}

export interface ChatArtifactTurn {
  /** Zero-based assistant-turn ordinal. */
  assistant: number;
  artifacts: ChatArtifact[];
}

// ── dates (mirror conversations.ts `today`) ──────────────────────────────────
// conversations.ts stamps YYYY-MM-DD in the home tz. The composition helpers take
// an explicit `date` so they stay pure/testable; the service passes today().
const TZ = "America/New_York";
export const today = (now: Date = new Date(), tz: string = TZ): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(now);

// ── chat slug (byte-identical to conversations.ts) ───────────────────────────
export const slugify = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);

/** Human-readable note filename slug. Mirrors Rust char::is_alphanumeric and
 * its 60-Unicode-scalar cap; chat slugs retain their older ASCII contract. */
export const noteSlugify = (s: string): string =>
  [
    ...s
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-|-$/g, ""),
  ]
    .slice(0, 60)
    .join("")
    .replace(/-$/g, "");

// ── contract-version handshake (mirror mounts.ts verNum/requireContract) ─────
const verNum = (v: string): number =>
  v
    .split(".")
    .map(Number)
    .reduce((a, n, i) => a + n / Math.pow(1000, i), 0);

/** Whether a brain's contract is within the band rotli supports (inclusive).
 *  Out of range ⇒ the caller opens the brain READ-ONLY (never silently writes a
 *  contract it wasn't built for). Defaults to the exact version rotli ships. */
export function contractInRange(
  contract: string,
  min: string = MIN_CONTRACT,
  max: string = CONTRACT_VERSION,
): boolean {
  const v = verNum(contract);
  return v >= verNum(min) && v <= verNum(max);
}

// ── access mode (byte-identical fail-closed table: mounts.ts accessMode +
//    registry — no registry ⇒ local; valid registry, mode local|open ⇒ that;
//    anything else, incl. malformed ⇒ secure) ────────────────────────────────
export function parseAccessMode(usersJson: string): AccessMode {
  let reg: { users?: unknown; primary?: unknown; mode?: unknown };
  try {
    reg = JSON.parse(usersJson);
  } catch {
    return "local"; // absent/unreadable users.json ⇒ single-tenant
  }
  if (!reg || !Array.isArray(reg.users) || typeof reg.primary !== "string") return "local";
  const m = typeof reg.mode === "string" ? reg.mode.trim().toLowerCase() : "";
  return m === "local" || m === "open" ? (m as AccessMode) : "secure";
}

// ── instance identity (mirror mounts.ts memexInfo/memexId) ───────────────────
/** Parse memex.json; null unless it carries a string `id` (mounts.ts memexInfo). */
export function parseMemexInfo(memexJson: string): MemexInfo | null {
  try {
    const r = JSON.parse(memexJson);
    return r && typeof r.id === "string" ? (r as MemexInfo) : null;
  } catch {
    return null;
  }
}

/** A real memex id is `mx_`-prefixed (the detection marker; mounts.ts ids). */
export const isMemexId = (id: string | null | undefined): boolean =>
  typeof id === "string" && id.startsWith("mx_");

// ── the chats surface (byte-identical to conversations.ts writeChat) ─────────
function assertChatSource(source: string): void {
  if (!(CHAT_SOURCES as readonly string[]).includes(source)) {
    throw new Error(`chat source "${source}" not allowed on the chats surface (${CHAT_SOURCES.join("/")})`);
  }
}

export const chatSlug = (meta: ChatMeta): string => meta.slug ?? slugify(meta.title);

/** The fresh `chats/<slug>.md` header file (no messages yet) — the exact bytes
 *  conversations.ts writes on first creation. */
export function composeChatFile(meta: ChatMeta, date: string): string {
  assertChatSource(meta.source);
  const slug = chatSlug(meta);
  return [
    "---",
    `id: ${meta.id ?? `${date}-${slug}`}`,
    `title: ${meta.title}`,
    `source: ${meta.source}`,
    `attachedTo: ${meta.attachedTo ? `[[${meta.attachedTo}]]` : ""}`,
    `participants: [${(meta.participants ?? ["you"]).join(", ")}]`,
    `created: ${date}`,
    `updated: ${date}`,
    "tags: [chat]",
    "---",
    "",
    `# ${meta.title}`,
    meta.attachedTo ? `\n> attached to [[${meta.attachedTo}]]` : "",
    "",
    "## Messages",
    "",
  ].join("\n");
}

/** The appended message block (conversations.ts: `messages.join("\n") + "\n"`). */
export function composeMessageLines(messages: ChatMsg[], date: string): string {
  return messages.map((m) => `**${m.speaker}** · ${m.at ?? date} — ${m.text}`).join("\n") + "\n";
}

/** Rewrite the `updated:` frontmatter line (conversations.ts bump). */
export function bumpUpdated(content: string, date: string): string {
  return content.replace(/updated:\s*.+/, `updated: ${date}`);
}

/** Append messages to an EXISTING chat file's content + bump `updated`. */
export function appendMessages(existing: string, messages: ChatMsg[], date: string): string {
  return bumpUpdated(existing + composeMessageLines(messages, date), date);
}

/** Build the full bytes of a brand-NEW chat (header + any initial messages),
 *  matching conversations.ts's create-then-append net result. */
export function composeNewChat(
  meta: ChatMeta,
  messages: ChatMsg[],
  date: string,
): { slug: string; contents: string } {
  const slug = chatSlug(meta);
  const header = composeChatFile({ ...meta, slug }, date);
  const contents = messages.length ? appendMessages(header, messages, date) : header;
  return { slug, contents };
}

/** Rewrite (or insert) the `attachedTo:` frontmatter line on an EXISTING chat
 * file — the lazy chat↔note link (the note materializes on first open, then the
 * chat points at its staging stem). Pure; only the FIRST frontmatter block is
 * touched, so a message line that happens to start "attachedTo:" never matches. */
export function setAttachedTo(contents: string, stem: string): string {
  const line = `attachedTo: [[${stem}]]`;
  const fm = /^---\n([\s\S]*?)\n---/.exec(contents);
  if (!fm || fm[1] === undefined) return contents; // no frontmatter — leave the file alone
  const block = fm[1];
  const next = /^attachedTo:.*$/m.test(block) ? block.replace(/^attachedTo:.*$/m, line) : `${block}\n${line}`;
  return `${contents.slice(0, fm.index)}---\n${next}\n---${contents.slice(fm.index + fm[0].length)}`;
}

/** Rewrite (or insert) the `pinned:` frontmatter line on an EXISTING chat file —
 * the sidebar's pin-to-top (Seth #4 fast-follow, 2026-07-08). Pure; same
 * first-frontmatter-block discipline as setAttachedTo. Unpinning a chat that was
 * never pinned is a no-op (no line is added just to say `false`). */
export function setChatPinned(contents: string, pinned: boolean): string {
  const fm = /^---\n([\s\S]*?)\n---/.exec(contents);
  if (!fm || fm[1] === undefined) return contents; // no frontmatter — leave the file alone
  const block = fm[1];
  let next: string;
  if (/^pinned:.*$/m.test(block)) next = block.replace(/^pinned:.*$/m, `pinned: ${pinned}`);
  else if (pinned) next = `${block}\npinned: true`;
  else return contents;
  return `${contents.slice(0, fm.index)}---\n${next}\n---${contents.slice(fm.index + fm[0].length)}`;
}

/** Mark a chat as SECURE-CONTEXT: a turn's tool trace read a secure note, so
 * the transcript may carry its prose and must never ride to a remote model —
 * even after a model switch (audit 2026-07-29 #7). One-way: nothing unsets it.
 * Pure; same first-frontmatter-block discipline as setChatPinned. */
export function setChatSecureContext(contents: string): string {
  const fm = /^---\n([\s\S]*?)\n---/.exec(contents);
  if (!fm || fm[1] === undefined) return contents; // no frontmatter — leave the file alone
  const block = fm[1];
  if (/^secureContext:\s*true\s*$/m.test(block)) return contents;
  const next = /^secureContext:.*$/m.test(block)
    ? block.replace(/^secureContext:.*$/m, "secureContext: true")
    : `${block}\nsecureContext: true`;
  return `${contents.slice(0, fm.index)}---\n${next}\n---${contents.slice(fm.index + fm[0].length)}`;
}

/** Whether a chat file carries the secure-context marker (first frontmatter
 * block only — a message line can never match). */
export function hasSecureContext(contents: string): boolean {
  const fm = /^---\n([\s\S]*?)\n---/.exec(contents);
  return !!fm && fm[1] !== undefined && /^secureContext:\s*true\s*$/m.test(fm[1]);
}

const CHAT_ARTIFACTS_KEY = "rotliArtifacts";
const CHAT_ARTIFACT_TURNS_KEY = "rotliArtifactTurns";

function validChatArtifact(value: unknown): value is ChatArtifact {
  if (!value || typeof value !== "object") return false;
  const artifact = value as { kind?: unknown; id?: unknown; label?: unknown };
  return (
    (artifact.kind === "note" || artifact.kind === "file" || artifact.kind === "canvas") &&
    typeof artifact.id === "string" &&
    artifact.id.length > 0 &&
    artifact.id.length <= 1024 &&
    !/[\r\n\0]/.test(artifact.id) &&
    (artifact.label === undefined ||
      (typeof artifact.label === "string" &&
        artifact.label.length > 0 &&
        artifact.label.length <= 256 &&
        !/[\r\n\0]/.test(artifact.label)))
  );
}

/** Parse Rotli's additive artifact metadata from the first frontmatter block.
 * Unknown/malformed values fail to an empty list; body text never participates. */
export function parseChatArtifacts(contents: string): ChatArtifact[] {
  const fm = /^---\n([\s\S]*?)\n---/.exec(contents);
  if (!fm || fm[1] === undefined) return [];
  const raw = new RegExp(`^${CHAT_ARTIFACTS_KEY}:\\s*(.*)$`, "m").exec(fm[1])?.[1];
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const unique = new Map<string, ChatArtifact>();
    for (const artifact of parsed.slice(-100)) {
      if (!validChatArtifact(artifact)) continue;
      unique.set(`${artifact.kind}\0${artifact.id}`, artifact);
    }
    return [...unique.values()];
  } catch {
    return [];
  }
}

/** Idempotently attach one artifact reference without touching chat messages. */
export function addChatArtifact(contents: string, artifact: ChatArtifact): string {
  if (!validChatArtifact(artifact)) return contents;
  const fm = /^---\n([\s\S]*?)\n---/.exec(contents);
  if (!fm || fm[1] === undefined) return contents;
  const artifacts = parseChatArtifacts(contents);
  if (artifacts.some((item) => item.kind === artifact.kind && item.id === artifact.id)) return contents;
  const line = `${CHAT_ARTIFACTS_KEY}: ${JSON.stringify([...artifacts.slice(-99), artifact])}`;
  const block = fm[1];
  const next = new RegExp(`^${CHAT_ARTIFACTS_KEY}:.*$`, "m").test(block)
    ? block.replace(new RegExp(`^${CHAT_ARTIFACTS_KEY}:.*$`, "m"), line)
    : `${block}\n${line}`;
  return `${contents.slice(0, fm.index)}---\n${next}\n---${contents.slice(fm.index + fm[0].length)}`;
}

function validChatArtifactTurn(value: unknown): value is ChatArtifactTurn {
  if (!value || typeof value !== "object") return false;
  const turn = value as { assistant?: unknown; artifacts?: unknown };
  return (
    Number.isSafeInteger(turn.assistant) &&
    Number(turn.assistant) >= 0 &&
    Number(turn.assistant) <= 10_000 &&
    Array.isArray(turn.artifacts)
  );
}

/** Read durable per-response artifact ownership from frontmatter only. */
export function parseChatArtifactTurns(contents: string): ChatArtifactTurn[] {
  const fm = /^---\n([\s\S]*?)\n---/.exec(contents);
  if (!fm || fm[1] === undefined) return [];
  const raw = new RegExp(`^${CHAT_ARTIFACT_TURNS_KEY}:\\s*(.*)$`, "m").exec(fm[1])?.[1];
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const turns = new Map<number, ChatArtifactTurn>();
    for (const value of parsed.slice(-100)) {
      if (!validChatArtifactTurn(value)) continue;
      const unique = new Map<string, ChatArtifact>();
      for (const artifact of value.artifacts.slice(-24)) {
        if (validChatArtifact(artifact)) unique.set(`${artifact.kind}\0${artifact.id}`, artifact);
      }
      if (unique.size > 0) {
        turns.set(value.assistant, { assistant: value.assistant, artifacts: [...unique.values()] });
      }
    }
    return [...turns.values()].sort((a, b) => a.assistant - b.assistant);
  } catch {
    return [];
  }
}

/** Set one assistant turn's artifact list without changing transcript bytes. */
export function addChatArtifactTurn(
  contents: string,
  assistant: number,
  artifacts: readonly ChatArtifact[],
): string {
  if (!Number.isSafeInteger(assistant) || assistant < 0 || assistant > 10_000) return contents;
  const valid = artifacts.filter(validChatArtifact).slice(-24);
  if (valid.length === 0) return contents;
  const fm = /^---\n([\s\S]*?)\n---/.exec(contents);
  if (!fm || fm[1] === undefined) return contents;
  const turns = parseChatArtifactTurns(contents).filter((turn) => turn.assistant !== assistant);
  turns.push({ assistant, artifacts: valid });
  turns.sort((a, b) => a.assistant - b.assistant);
  const line = `${CHAT_ARTIFACT_TURNS_KEY}: ${JSON.stringify(turns.slice(-100))}`;
  const block = fm[1];
  const next = new RegExp(`^${CHAT_ARTIFACT_TURNS_KEY}:.*$`, "m").test(block)
    ? block.replace(new RegExp(`^${CHAT_ARTIFACT_TURNS_KEY}:.*$`, "m"), line)
    : `${block}\n${line}`;
  return `${contents.slice(0, fm.index)}---\n${next}\n---${contents.slice(fm.index + fm[0].length)}`;
}

/** Keep the attached note's `## Chat` backlink in sync (byte-identical to
 *  conversations.ts ensureChatLink). Pure: returns the new note body; Rust writes it. */
export function ensureChatBacklink(noteBody: string, slug: string): string {
  if (noteBody.includes(`[[${slug}]]`)) return noteBody;
  return /\n## Chat\b/.test(noteBody)
    ? noteBody.replace(/(\n## Chat\b[^\n]*\n)/, `$1- [[${slug}]]\n`)
    : noteBody.replace(/\s*$/, "") + `\n\n## Chat\n- [[${slug}]]\n`;
}

// ── the note surface (v3.5 note contract — wiki/_inbox staging) ───────────────
// A rotli note is a plain-markdown body the user owns, wrapped in the v3.5 frontmatter
// the memex defines (STRUCTURE.md §v3.5). rotli writes it INSTANTLY to wiki/_inbox/
// staging — the AI metadata (area/summary/tags/links) is left blank until a local LLM
// classifies + files the note to wiki/<area>/ in a LATER phase. The stable anchors
// (id/owner/created/updated) and the user metadata (shelf/reach) are set now so links,
// the user's view, and the access catalog survive any (re)filing. The `id` NEVER
// changes. No `title:` field — the title lives in the body's first heading (titleOf),
// exactly like a curated wiki note.

/** Ulid-style id (Crockford base32: time-sortable prefix + random tail). Mirrors
 *  services/notes.ts `ulid` — kept local so the memex codec stays self-contained
 *  (the boundary law: this file never imports the rest of the app). */
const B32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export function ulid(now: number = Date.now()): string {
  let time = "";
  let t = now;
  for (let i = 0; i < 10; i++) {
    time = (B32[t % 32] ?? "0") + time;
    t = Math.floor(t / 32);
  }
  let rand = "";
  for (let i = 0; i < 16; i++) rand += B32[Math.floor(Math.random() * 32)] ?? "0";
  return time + rand;
}

export interface NoteMeta {
  /** ULID — set once, NEVER changes (filing/moving keeps it). */
  id: string;
  /** Title for the slug only (the body carries its own heading). */
  title: string;
  /** The user's folder(s) — drives the projected view, never the disk path. */
  shelf: string[];
  /** Who may access this note (default: the owning user). */
  reach: string[];
  /** Classification area — BLANK in Phase 1 (a later LLM phase fills + files it). */
  area?: string;
  /** Provenance; rotli always writes "rotli". */
  owner?: string;
  /** Corpus security policy. Remote AI is always blocked; local AI is opt-in. */
  secure?: boolean;
}

/** The human-readable staging filename stem. Stable identity remains the
 * frontmatter ULID; Rust adds ` (2)`, ` (3)`, … when a sibling already owns
 * this stem. Empty/punctuation-only titles become `note`. */
export function noteStem(title: string, _id: string): string {
  return noteSlugify(title) || "note";
}

/** Compose the full bytes of a brand-NEW staging note: the v3.5 frontmatter + the
 *  user's body (the body already includes its own `# Title`). AI metadata is blank. */
export function composeNote(meta: NoteMeta, body: string, date: string): string {
  // `key:` (no trailing space) for an empty value, `key: value` otherwise.
  const line = (k: string, v: string) => (v ? `${k}: ${v}` : `${k}:`);
  const head = [
    "---",
    line("id", meta.id),
    line("created", date),
    line("updated", date),
    "pinned: false",
    "aliases: []",
    line("owner", meta.owner ?? ROTLI_SOURCE),
    line("shelf", `[${meta.shelf.join(", ")}]`),
    line("reach", `[${meta.reach.join(", ")}]`),
    line("area", meta.area ?? ""), // blank until the LLM organizer runs
    "summary:", //  ”
    "tags: []", //  ”
    "links: []", //  ”
    ...(meta.secure ? ["secure: true"] : []),
    "---",
    "",
  ].join("\n");
  const out = head + body.replace(/^\n+/, "");
  return out.endsWith("\n") ? out : out + "\n";
}

/** The primary partition from a brain's users.json (mounts.ts `primary`), used as
 *  the default `reach` ("the owning user"). null when single-tenant / unreadable —
 *  the caller then writes `reach: []` (owner-only by the contract's default). */
export function parsePrimaryUser(usersJson: string): string | null {
  try {
    const r = JSON.parse(usersJson);
    return typeof r?.primary === "string" && r.primary ? r.primary : null;
  } catch {
    return null;
  }
}

// ── the spine + the write-permission gate (mirror of the Rust write-guard) ───
export const SPINE = {
  identity: "identity",
  personality: "personality",
  wiki: "wiki",
  /** The note staging area (v3.5) — where NEW rotli notes land before the
   * Brain files them (all of wiki/ is writable for edits since 2026-08-03). */
  wikiInbox: "wiki/_inbox",
  /** Protected note home. It lives inside the Brain but is never an organizer
   * area and is categorically unavailable to remote AI. */
  wikiSecure: "wiki/_secure",
  history: "history",
  chats: "chats",
  inbox: "inbox.md",
  map: "MAP.md",
  memex: "memex.json",
  users: "users.json",
} as const;

/** Whether rotli may WRITE this spine-relative path under the given perms. The
 *  belt to the Rust path-guard's braces: identity/personality/history/MAP are NEVER
 *  writable; ALL of wiki/ is writable since 2026-08-03 (a Librarian-filed note must
 *  stay editable — the read-only curated era ended when filing became automatic),
 *  alongside chats/**. wiki/_secure rides the wiki rule; it stays model-gated on
 *  READ and is never an organizer area.
 *
 *  `inbox.md` is NOT a rotli write surface (#96, audit 2026-07): no rotli code has
 *  ever appended it — quick captures land as staged notes in wiki/_inbox/ — so the
 *  old allowance was dead gate surface that could only rot. Breve owns its own
 *  inbox.md writes through its own gate; rotli only scaffolds the file when it
 *  INITIATES a brand-new memex. */
export function canWrite(relPath: string, perms: Perms): boolean {
  if (perms === "read-only") return false;
  const p = relPath.replace(/^\/+/, "");
  if (p.includes("..")) return false;
  if (p === SPINE.chats || p.startsWith(`${SPINE.chats}/`)) return true;
  if (p === SPINE.wiki || p.startsWith(`${SPINE.wiki}/`)) return true;
  return false;
}

// ── the AI FILER lane (contract v3.7) — mirror of Rust's filer_writable/AI_KEYS ──

/** The metadata keys the AI FILER owns. Written only via the Filer commands; the
 * user's field editor never sets these (mirror of Rust `AI_KEYS`). */
export const AI_KEYS = [
  "area",
  "summary",
  "tags",
  "links",
  "suggested_area",
  "area_confidence",
  "filed_by",
  "filed_at",
] as const;

/** Keys the USER owns on a note — disjoint from AI_KEYS and the Rust-reserved
 * id/created/updated/pinned/origin/locked/secure/local_ai_allowed/owner. */
export const USER_KEYS = ["shelf", "reach"] as const;

/** Whether the FILER may write this spine-relative path (the path gate, mirror of
 * `canWrite` for the AI lane): ONLY the brain — the wiki/_inbox staging AND the
 * curated wiki/** areas. Everything else is refused. */
export function canFile(relPath: string): boolean {
  const p = relPath.replace(/^\/+/, "");
  if (p.includes("..")) return false;
  if (p === SPINE.wikiSecure || p.startsWith(`${SPINE.wikiSecure}/`)) return false;
  return p === "wiki" || p.startsWith("wiki/");
}

/** The FILER's per-note policy layer: never a `locked` note; the target `area` must
 * be in the brain's area vocabulary. The organizer continues to skip secure
 * notes entirely. Interactive local retrieval has its own explicit-permission
 * gate at the corpus read boundary; remote retrieval can never cross it. */
export function mayFile(fm: { locked?: boolean; area?: string }, areaVocab: readonly string[]): boolean {
  if (fm.locked) return false;
  if (fm.area && !areaVocab.includes(fm.area)) return false;
  return true;
}
