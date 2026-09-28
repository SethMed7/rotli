// Vault repair passes the person runs on purpose (split out of tauri.ts,
// 2026-09-28): each scans first and changes files only on an explicit apply.
// Outside the Mac app they find nothing.

import { invoke } from "@tauri-apps/api/core";

import { isTauri, type SecureRepairCandidate, type SecureRepairReport } from "./tauri";

/** Preview legacy secure-intake state in the default memex (read-only). */
export async function secureRepairScan(): Promise<SecureRepairCandidate[]> {
  if (!isTauri()) return [];
  return invoke<SecureRepairCandidate[]>("corpus_secure_repair_scan");
}

/** Repair every current candidate — Rust re-validates each note on disk, moves
 * it into the protected lane ignore-first, and journals it content-free. */
export async function secureRepairApply(): Promise<SecureRepairReport> {
  if (!isTauri()) return { repaired: 0, failed: [] };
  return invoke<SecureRepairReport>("corpus_secure_repair_apply");
}

/** What the leftover-name cleanup found (or removed, when applied). */
export interface AliasCleanupReport {
  notes: number;
  aliases: number;
  /** Leftovers kept because a link uses them. */
  keptLinked: number;
}

/** Leftover note names — `Untitled` placeholders and half-typed titles — in
 * the vault's aliases: counted, or removed with `apply`. A linked one stays. */
export async function aliasCleanup(apply: boolean): Promise<AliasCleanupReport> {
  if (!isTauri()) return { notes: 0, aliases: 0, keptLinked: 0 };
  return invoke<AliasCleanupReport>("corpus_alias_cleanup", { apply });
}

/** Protect every note already named with a secure keyword (the Librarian
 * rules): Rust scans titles and file names only and moves each into the
 * protected folder, ignore first. Returns how many it protected. */
export async function secureByKeywords(): Promise<number> {
  if (!isTauri()) return 0;
  return invoke<number>("corpus_secure_by_keywords");
}
