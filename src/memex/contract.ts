// The memex contract — MIRRORED BY VALUE, never imported.
//
// rotli is a separate repo. The memex (memex-vault) is a SIBLING resolved by path at
// runtime; it may be ABSENT or a DRIFTED copy, and its engine (mounts.ts /
// conversations.ts / validate.ts) is bun/node — it CANNOT run in this webview at
// all. So, exactly like Breve's scripts/config.ts (see ~/breve/docs/memex-boundary.md),
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
// personality/ and added the org layer — but rotli's WRITE surfaces (chats/, inbox.md,
// wiki/_inbox/) are untouched by that, so rotli stays fully compatible; the band just
// extends to 3.6 so a v3.6 brain is in-range. It still WRITES to a v3.4 brain (the
// chat/inbox shape didn't change; a 3.4 brain just warns on the new note fields, never
// errors), so the supported band is [MIN_CONTRACT, CONTRACT_VERSION] — a brain whose
// memex.json still reads "3.4" stays writable. Out of the band ⇒ the brain opens read-only.
export const CONTRACT_VERSION = "3.6";
export const MIN_CONTRACT = "3.4";

/** Sources allowed on the chats surface (conversations.ts SURFACES.chats.sources).
 *  rotli always writes as "rotli". */
export const CHAT_SOURCES = ["rotli", "app", "claude", "manual", "signal"] as const;
export const ROTLI_SOURCE = "rotli";

export type AccessMode = "local" | "open" | "secure";
export type Perms = "chats+inbox" | "read-only";

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

// ── dates (mirror conversations.ts `today`) ──────────────────────────────────
// conversations.ts stamps YYYY-MM-DD in the home tz. The composition helpers take
// an explicit `date` so they stay pure/testable; the service passes today().
const TZ = "America/New_York";
export const today = (now: Date = new Date(), tz: string = TZ): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(now);

// ── slug (byte-identical to conversations.ts) ────────────────────────────────
export const slugify = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);

// ── contract-version handshake (mirror mounts.ts verNum/requireContract) ─────
const verNum = (v: string): number =>
  v.split(".").map(Number).reduce((a, n, i) => a + n / Math.pow(1000, i), 0);

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
    throw new Error(
      `chat source "${source}" not allowed on the chats surface (${CHAT_SOURCES.join("/")})`,
    );
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
}

/** `<slug>-<id6>` — the staging filename stem (home() = wiki/_inbox/<stem>.md).
 *  id6 = the LAST 6 of the ULID (its RANDOM tail), lowercased so it survives the
 *  Rust safe_slug (lowercase-alnum-dash). The random tail — NOT the time prefix
 *  (first 10 chars, which two notes minutes apart share) — is what disambiguates,
 *  so the same title written twice never collides and overwrites. Empty title ⇒
 *  "note" so the stem never starts with "-". */
export function noteStem(title: string, id: string): string {
  const base = slugify(title) || "note";
  return `${base}-${id.slice(-6).toLowerCase()}`;
}

/** Compose the full bytes of a brand-NEW staging note: the v3.5 frontmatter + the
 *  user's body (the body already includes its own `# Title`). AI metadata is blank. */
export function composeNote(meta: NoteMeta, body: string, date: string): string {
  // `key:` (no trailing space) for an empty value, `key: value` otherwise.
  const line = (k: string, v: string) => (v ? `${k}: ${v}` : `${k}:`);
  const head = [
    "---",
    line("id", meta.id),
    line("owner", meta.owner ?? ROTLI_SOURCE),
    line("created", date),
    line("updated", date),
    line("area", meta.area ?? ""), // blank until the LLM organizer runs
    "summary:", //  ”
    "tags: []", //  ”
    "links:", //  ”
    line("shelf", `[${meta.shelf.join(", ")}]`),
    line("reach", `[${meta.reach.join(", ")}]`),
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
  /** The note staging area (v3.5) — the ONLY part of wiki/ rotli writes. */
  wikiInbox: "wiki/_inbox",
  history: "history",
  chats: "chats",
  inbox: "inbox.md",
  map: "MAP.md",
  memex: "memex.json",
  users: "users.json",
} as const;

/** Whether rotli may WRITE this spine-relative path under the given perms. The
 *  belt to the Rust path-guard's braces: identity/personality/history/MAP are NEVER
 *  writable; the REST of wiki/ (curated notes) is read-only — only its wiki/_inbox/
 *  staging is writable (v3.5), alongside chats/** and inbox.md. */
export function canWrite(relPath: string, perms: Perms): boolean {
  if (perms === "read-only") return false;
  const p = relPath.replace(/^\/+/, "");
  if (p.includes("..")) return false;
  if (p === SPINE.inbox) return true;
  if (p === SPINE.chats || p.startsWith(`${SPINE.chats}/`)) return true;
  if (p === SPINE.wikiInbox || p.startsWith(`${SPINE.wikiInbox}/`)) return true;
  return false;
}
