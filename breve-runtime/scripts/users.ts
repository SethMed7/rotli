/**
 * BREVE identity & access — WHO may talk to Breve and which memex partition(s) each reaches.
 *
 * The split (see ~/memex multi-tenancy, v3.3):
 *   • memex's users.json (in the knowledge base) owns WHERE partitions live (name → path) + role.
 *   • THIS file (access.json) owns WHO: a Signal identity (phone/uuid) → the memex user(s) it may
 *     reach + its powers. memex stays integration-neutral; the phone↔user binding lives only here.
 *
 * access.json is gitignored (it holds phone numbers); access.example.json is the LEGACY/local-mode
 * template — only consulted when there is no memex users.json registry, or mode === "local" (in
 * secure/open mode the memex policy in identities.local.json + users.json is authoritative).
 * Secrets stay in the Keychain — never here. With NO access.json, Breve synthesizes a single admin
 * binding from signal.json's owner (the sentinel user "__default__" ⇒ today's flat memex root), so the
 * single-user install is byte-identical to before.
 */
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { readMemexRegistry, readMemexIdentities, accessMode, DEFAULT_USER } from "./config.ts";

const BREVE = join(import.meta.dir, "..");
const ACCESS_PATH = process.env.BREVE_ACCESS ?? join(BREVE, "access.json");
export { DEFAULT_USER }; // the sentinel partition for a single-tenant install (today's flat root)

export type Role = "admin" | "member";
export type Power = "knowledge" | "email" | "briefs" | "actions";
export type Binding = { phone?: string; uuid?: string; role: Role; users: string[]; primaryUser?: string; powers?: Power[] };
export type Principal = {
  phone: string | null;
  uuid: string | null;
  role: Role;
  allowedUsers: string[];
  primaryUser: string;
  powers: Power[];
};

type Access = { version?: number; memexRoot?: string; bindings: Binding[] };

let _access: Access | null | undefined; // undefined = not loaded; null = no file (legacy mode)
function access(): Access | null {
  if (_access !== undefined) return _access;
  try { _access = JSON.parse(readFileSync(ACCESS_PATH, "utf8")) as Access; }
  catch { _access = null; }
  return _access;
}
/** Re-read access.json after a /user-add writes a new binding (no daemon restart). */
export function reloadAccess(): void { _access = undefined; }

/** The legacy single-owner admin, synthesized from signal.json when there's no access.json. */
function legacyAdmin(): Binding | null {
  try {
    const sig = JSON.parse(readFileSync(join(BREVE, "signal.json"), "utf8"));
    if (!sig.owner) return null;
    return {
      phone: sig.owner, uuid: sig.ownerUuid, role: "admin",
      users: [DEFAULT_USER], primaryUser: DEFAULT_USER, powers: ["knowledge", "email", "briefs", "actions"],
    };
  } catch { return null; }
}

function bindings(): Binding[] {
  const a = access();
  if (a?.bindings?.length) return a.bindings;
  const legacy = legacyAdmin();
  return legacy ? [legacy] : [];
}

/** The memex partition names declared in the knowledge base's registry ([] when single-tenant). */
export function memexUsers(): string[] {
  return readMemexRegistry()?.users.map((u) => u.name) ?? [];
}

const norm = (s: string | null | undefined) => (s ?? "").trim();

/**
 * Resolve a Signal sender to a Principal, or null to DROP (the hard allowlist).
 *
 * PRIMARY path — the shared memex policy: identities.local.json (phone/uuid → user name) + users.json
 * (role/powers). This is app-neutral: Rotli resolves the SAME store by email/phone. When identities
 * are present, they are authoritative. LEGACY fallback — Breve's own access.json bindings (then the
 * synthesized owner) — keeps a not-yet-migrated install working.
 */
export function resolvePrincipal(sourceNumber: string | null, sourceUuid: string | null): Principal | null {
  const num = norm(sourceNumber), uid = norm(sourceUuid);

  // ── memex policy is AUTHORITATIVE in any non-local mode ──
  // A registry in secure/open mode governs by REGISTRY PRESENCE, not by a populated identities file:
  // resolve via identities ONLY, and ANY miss (incl. an empty/lost identities.local.json) DROPs. The
  // legacy access.json path is NEVER reached past a real policy — closes the file-loss bypass (FORGE H1).
  const ids = readMemexIdentities();
  const reg = readMemexRegistry();
  if (reg && accessMode() !== "local") {
    const name = Object.keys(ids).find((n) => (ids[n].phone && norm(ids[n].phone) === num) || (ids[n].uuid && norm(ids[n].uuid) === uid));
    if (name) {
      const entry = reg.users.find((u) => u.name === name);
      if (entry) {
        const role: Role = entry.role === "admin" ? "admin" : "member";
        const powers = (entry.powers as Power[] | undefined)?.length ? (entry.powers as Power[]) : (role === "admin" ? ["knowledge", "email", "briefs", "actions"] : ["knowledge"]);
        const allowedUsers = role === "admin" ? reg.users.map((u) => u.name) : [name];
        return { phone: ids[name].phone ?? null, uuid: ids[name].uuid ?? null, role, allowedUsers, primaryUser: name, powers };
      }
    }
    return null; // real policy present, sender not in identities → DROP (fail closed)
  }

  // ── legacy access.json / synthesized owner — ONLY when no registry, or mode === "local" ──
  // REACHED ONLY when there is no memex registry, or mode === "local". When a real registry exists in
  // secure/open mode the memex policy above (lines 86-103) is authoritative and this branch is never
  // entered. This is the legacy single-user / local-mode fallback (still load-bearing — do not remove).
  const b = bindings().find((x) => (x.phone && norm(x.phone) === num) || (x.uuid && norm(x.uuid) === uid));
  if (!b) return null;
  const role: Role = b.role === "admin" ? "admin" : "member";
  let users = b.users?.length ? b.users : [DEFAULT_USER];
  // A MEMBER may never be scoped to the primary partition: it's the flat-root brain (path ""), so it
  // would hand a member the whole tree incl. every other persona. Strip it; an empty result is an
  // invalid binding → DROP the sender (defense-in-depth behind /user-add's primary refusal).
  if (role === "member") {
    const primary = readMemexRegistry()?.primary;
    if (primary) users = users.filter((u) => u !== primary);
    if (!users.length) return null;
  }
  const primaryUser = b.primaryUser && users.includes(b.primaryUser) ? b.primaryUser : users[0];
  // Safe default: a member with no explicit powers gets knowledge only.
  const powers: Power[] = b.powers?.length ? b.powers : ["knowledge"];
  return { phone: b.phone ?? null, uuid: b.uuid ?? null, role, allowedUsers: users, primaryUser, powers };
}

/** May this principal operate as partition `user`? Admin spans any registry user; member is siloed. */
export function canUse(p: Principal, user: string): boolean {
  if (user === DEFAULT_USER) return p.allowedUsers.includes(DEFAULT_USER);
  if (p.role === "admin") return p.allowedUsers.includes(user) || memexUsers().includes(user);
  return p.allowedUsers.includes(user);
}

export function hasPower(p: Principal, power: Power): boolean {
  return p.powers.includes(power);
}

/** A stable, filesystem-safe key for a principal (used to namespace per-principal state). */
export function keyOf(p: Principal): string {
  return (p.phone ?? p.uuid ?? "unknown").replace(/[^A-Za-z0-9]/g, "");
}

/** If `user` is BOUND to a real owner's phone (an identity handle), return that phone; else null. A
 *  bound user's own phone reaches it directly; the ADMIN reaching it needs step-up auth (secure mode). */
export function boundPhone(user: string): string | null {
  const id = readMemexIdentities()[user];
  if (id?.phone) return id.phone;
  for (const b of bindings()) if (b.role !== "admin" && b.phone && (b.users ?? []).includes(user)) return b.phone; // legacy
  return null;
}

/** The bound owner's UUID, if any. The step-up gate must check this too — the resolver matches an owner
 *  by phone OR uuid, so a uuid-only binding is still a real protected owner (FORGE M2). */
export function boundUuid(user: string): string | null {
  const id = readMemexIdentities()[user];
  if (id?.uuid) return id.uuid;
  for (const b of bindings()) if (b.role !== "admin" && b.uuid && (b.users ?? []).includes(user)) return b.uuid; // legacy
  return null;
}

// CLI: `bun scripts/users.ts whoami <number> [uuid]` — preview principal resolution (redacts nothing).
if (import.meta.main) {
  const [number, uuid] = process.argv.slice(2);
  const p = resolvePrincipal(number ?? null, uuid ?? null);
  console.log(p ? JSON.stringify(p, null, 2) : "DROP (no matching binding)");
  console.log("memex users:", memexUsers().join(", ") || "(single-tenant)");
}
