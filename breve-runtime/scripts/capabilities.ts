#!/usr/bin/env bun
/**
 * Capability FULFILLMENT engine — the bridge between the brain's capability MATRIX
 * (the memex's clients/capabilities.json: what each model CAN'T do natively) and Breve's
 * own integrations that fill the gap (./capabilities.json: PDF → headless Chrome,
 * web → safe-fetch). The brain only DECLARES; Breve FULFILLS (Rule #9).
 *
 * Flow: ask `ensureCapability(model, cap)` — native if the model has it, else routed to
 * the configured tool, else an alert so the owner wires it up. Matching mirrors policy.ts /
 * models.json: substring against the lowercased model id, first match wins, unknown →
 * `default` (safe: lacks everything). Missing config degrades to empty/safe defaults.
 */
import { join } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import { clientsPath } from "./config";

type MatrixEntry = { match: string[]; label?: string; has?: string[]; lacks?: string[]; notes?: string };
type Matrix = { models: MatrixEntry[]; default: Omit<MatrixEntry, "match"> };
type FulfillEntry = { tool: string; command?: string; configured?: boolean };
type Fulfillment = { fulfillment: Record<string, FulfillEntry> };

// Brain capability MATRIX (what models can't do) — empty/safe if absent.
const MATRIX: Matrix = (() => {
  try {
    return JSON.parse(readFileSync(join(clientsPath(), "capabilities.json"), "utf8")) as Matrix;
  } catch {
    return { models: [], default: { has: [], lacks: [] } };
  }
})();

// Breve's FULFILLMENT map (how Breve fills the gap) — empty if absent.
const FULFILL: Fulfillment = (() => {
  try {
    const root = process.env.ROTLI_BREVE_HOME ?? join(import.meta.dir, "..");
    return JSON.parse(readFileSync(join(root, "capabilities.json"), "utf8")) as Fulfillment;
  } catch {
    return { fulfillment: {} };
  }
})();

/** Can this model do `cap` natively? Substring-match the brain matrix (first wins; unknown → default).
 *  True only if `cap` is in `has` and not in `lacks` — default safe is false. */
export function modelCan(model: string, cap: string): boolean {
  const id = (model || "").toLowerCase();
  const entry = MATRIX.models.find((m) => m.match.some((s) => id.includes(s))) ?? MATRIX.default;
  const has = entry.has ?? [];
  const lacks = entry.lacks ?? [];
  return has.includes(cap) && !lacks.includes(cap);
}

/** Breve's fulfillment for `cap` (or null if none). A `command` path is verified on disk —
 *  if the binary is gone the tool counts as unconfigured. */
export function fulfill(cap: string): { tool: string; configured: boolean } | null {
  const f = FULFILL.fulfillment?.[cap];
  if (!f) return null;
  const configured = (f.configured ?? false) && (f.command ? existsSync(f.command) : true);
  return { tool: f.tool, configured };
}

/** Resolve a needed capability: native if the model has it; else routed to a configured
 *  Breve tool; else an alert telling the owner where to wire it. */
export function ensureCapability(
  model: string,
  cap: string
): { ok: true; via: string } | { ok: false; alert: string } {
  if (modelCan(model, cap)) return { ok: true, via: "native" };
  const f = fulfill(cap);
  if (f?.configured) return { ok: true, via: f.tool };
  return {
    ok: false,
    alert: `${model} can't do ${cap} and no fulfillment is configured — set it in ${process.env.ROTLI_BREVE_HOME ?? "Rotli's Breve home"}/capabilities.json`,
  };
}

// CLI selftest — Breve fulfils what the model can't (Gamma → PDF), and alerts when nothing is wired.
if (import.meta.main && process.argv.includes("--selftest")) {
  const show = (label: string, r: ReturnType<typeof ensureCapability>) =>
    console.log(`${label.padEnd(34)} → ${r.ok ? `OK via ${r.via}` : `ALERT: ${r.alert}`}`);
  show('ensureCapability("gamma","pdf")', ensureCapability("gamma", "pdf"));
  show('ensureCapability("gamma","youtube")', ensureCapability("gamma", "youtube"));
}
