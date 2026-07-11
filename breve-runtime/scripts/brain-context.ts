#!/usr/bin/env bun
/**
 * Bridge to the memex's client layer: hand any model a brain context pack sized + shaped to it.
 * Imported from the shared ground (the memex) so Breve and Rotli use the same packer.
 * Returns "" if the brain or its client layer isn't present (Breve still answers — just
 * without injected brain context).
 */
import { join } from "node:path";
import { existsSync } from "node:fs";
import { knowledgePath } from "./config";

let _packer: ((model: string, opts: any) => { text: string }) | null | undefined;

async function packer() {
  if (_packer !== undefined) return _packer;
  const clientPath = join(knowledgePath(), "scripts", "client.ts");
  // Brain/client genuinely absent — expected on a fresh checkout; stay quiet.
  if (!existsSync(clientPath)) { _packer = null; return _packer; }
  try {
    const mod: any = await import(clientPath);
    _packer = mod.contextPack ?? null;
    // Present but no export = a partial/broken engine; surface it instead of silently losing context.
    if (!_packer) console.error(`[brain-context] client.ts present but exports no contextPack — brain context disabled`);
  } catch (e) {
    _packer = null;
    console.error(`[brain-context] client.ts present but failed to import (partial/broken memex engine?) — brain context disabled: ${String(e).slice(0, 200)}`);
  }
  return _packer;
}

/** Brain context for `model`. `assemble` forces pre-assembled content (for harnesses with no
 *  file access, e.g. local models and Breve's quick-Haiku); leave false for tool-capable tiers.
 *  `root` packs a specific memex partition (multi-user) — defaults inside the shared packer to the
 *  primary/flat root, so single-user callers can omit it. */
export async function brainPack(
  model: string,
  opts: { focus?: string; budgetTokens?: number; assemble?: boolean; root?: string } = {},
): Promise<string> {
  try {
    const fn = await packer();
    return fn ? fn(model, opts).text : "";
  } catch {
    return "";
  }
}
