#!/usr/bin/env bun
/**
 * Print a resolved Breve root for the shell wrappers: knowledge | storage | assets.
 * The single place the brief shells learn where the memex / storage live, so they carry
 * no hardcoded paths — config.local.json (gitignored) owns the real values.
 *   bun scripts/print-root.ts knowledge   → the memex knowledge base
 *   bun scripts/print-root.ts storage     → Breve's output store (audio/PDF/captures)
 *   bun scripts/print-root.ts assets      → the `storage:` root for note binaries
 */
import { knowledgePath, storagePath, assetsPath } from "./config";

const roots: Record<string, () => string> = { knowledge: knowledgePath, storage: storagePath, assets: assetsPath };
const fn = roots[process.argv[2] ?? ""];
if (!fn) { console.error("usage: print-root.ts knowledge|storage|assets"); process.exit(1); }
process.stdout.write(fn());
