// Settings → General → Leftover note names (2026-09-28, the owner: "a full
// clean up removing all of the untitles"). Notes no longer pick up
// `Untitled` placeholders or half-typed titles as aliases, but older notes
// still carry them; this counts them on open and removes them on a click.
// An alias some note links to is kept. Mac app only (Rust does the pass).

import { aliasCleanup, type AliasCleanupReport } from "../../lib/vaultRepair";
import type { VaultPass } from "./vaultPass";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function kept(report: AliasCleanupReport): string {
  return report.keptLinked > 0
    ? ` ${plural(report.keptLinked, "name stays because a link uses it", "names stay because links use them")}.`
    : "";
}

/** The status line: what a check found, or what a clean-up did. */
export function cleanupSummary(report: AliasCleanupReport, done: boolean): string {
  const names = plural(report.aliases, "leftover name", "leftover names");
  const notes = plural(report.notes, "note", "notes");
  const line =
    report.aliases === 0
      ? done
        ? "Nothing left to clean up."
        : "No leftover names."
      : done
        ? `Removed ${names} from ${notes}.`
        : `${names} in ${notes}.`;
  return line + kept(report);
}

export const ALIAS_PASS: VaultPass<AliasCleanupReport> = {
  title: "Leftover note names",
  lead: "Older notes can remember names they never really had: “Untitled”, or a title caught half-typed. Cleaning up removes those from every note’s metadata. A name a link still uses is kept.",
  run: aliasCleanup,
  summary: cleanupSummary,
  pending: (report) => report.aliases > 0,
  action: "Clean up",
  busy: "Cleaning up…",
};
