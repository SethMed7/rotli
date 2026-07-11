/**
 * BREVE per-phone session — which memex partition a sender is currently "in".
 *
 * File-backed (survives daemon restarts) under signal/sessions/<key>.json = { activeUser, at }.
 * A new conversation defaults to the sender's PRIMARY user: a stored active user only sticks within
 * a TTL window; past it, getActiveUser falls back to primary (lazily, without rewriting). `/use`
 * makes a sticky switch within the window. The daemon caches reads in-process; the file is the
 * source of truth across restarts.
 */
import { join } from "node:path";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { type Principal, canUse, keyOf } from "./users.ts";

const BREVE = process.env.ROTLI_BREVE_HOME ?? join(import.meta.dir, "..");
const SESSIONS = join(BREVE, "signal", "sessions");
const TTL_MS = 12 * 60 * 60 * 1000; // 12h — past this, a new message reverts to the primary user

const sessionFile = (p: Principal): string => join(SESSIONS, `${keyOf(p)}.json`);

/** The partition this sender is currently operating as (sticky within the TTL; else primary). */
export function getActiveUser(p: Principal): string {
  try {
    const s = JSON.parse(readFileSync(sessionFile(p), "utf8"));
    if (s.activeUser && canUse(p, s.activeUser) && Date.now() - (s.at ?? 0) < TTL_MS) return s.activeUser;
  } catch { /* no session yet */ }
  return p.primaryUser;
}

/** Switch the sender's active partition (validates the target is reachable for this principal). */
export function setActiveUser(p: Principal, user: string): { ok: boolean; reason?: string } {
  if (!canUse(p, user)) return { ok: false, reason: "not available to you" };
  try {
    mkdirSync(SESSIONS, { recursive: true });
    writeFileSync(sessionFile(p), JSON.stringify({ activeUser: user, at: Date.now() }));
    return { ok: true };
  } catch (e) { return { ok: false, reason: String(e).slice(0, 60) }; }
}
