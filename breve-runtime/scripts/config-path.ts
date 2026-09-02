/** Where Rotli's routine config lives, resolved without side effects.
 *
 * `paths.ts` re-exports this, but it also creates the storage lanes on import;
 * renderers that may run in a vault Breve was never set up in (the chat's
 * PDF artifact, 2026-09-02) import this module instead so reading the theme
 * never scaffolds `storage/breve*` folders as a side effect. */
import { join } from "node:path";

export const BREVE_HOME = process.env.ROTLI_BREVE_HOME ?? join(import.meta.dir, "..");

/** `<vault>/.rotli/routines/config.json` — timezone, delivery times, brief
 * model, PDF appearance. The supervisor pins it per job; every other entry
 * point (an on-demand render, a terminal run) used to fall back to a
 * `settings.json` a Rotli-managed vault never has and silently rendered the
 * default palette (audit 2026-09-02 §1.4). The managed home sits at
 * `<vault>/.rotli/breve`, so the sibling `routines/` folder is the same file
 * the supervisor would have passed. */
export const CONFIG_PATH =
  process.env.ROTLI_BREVE_CONFIG ?? join(BREVE_HOME, "..", "routines", "config.json");
