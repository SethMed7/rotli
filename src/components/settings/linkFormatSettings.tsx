// Settings → General → Link format (owner decisions 2026-10-13). New images
// are linked with a standard Markdown path and new embeds written as
// Obsidian's ![[file]]; older notes still carry Rotli's `storage:` links and
// ```sheet / ```board / ```document fences. This counts them on open, shows a
// few before → after lines, and converts them on a click. Mac app only (Rust
// does the pass); a folder opened in place is never converted.

import { convertLinks, type LinkConvertReport } from "../../lib/vaultRepair";
import type { VaultPass } from "./vaultPass";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The status line: what a check found, or what a conversion did. */
export function convertSummary(report: LinkConvertReport, done: boolean): string {
  const parts = [
    report.links > 0 ? plural(report.links, "image or file link", "image and file links") : "",
    report.embeds > 0 ? plural(report.embeds, "embed", "embeds") : "",
  ].filter(Boolean);
  if (parts.length === 0)
    return done ? "Every link is already in the shared format." : "Every link already reads in Obsidian.";
  const what = parts.join(" and ");
  const notes = plural(report.notes, "note", "notes");
  const verb = report.links + report.embeds === 1 ? "uses" : "use";
  return done ? `Converted ${what} in ${notes}.` : `${what} in ${notes} ${verb} Rotli’s own format.`;
}

export const LINK_PASS: VaultPass<LinkConvertReport> = {
  title: "Link format",
  lead: "New images and embeds are written the way Obsidian and any Markdown app read them. Older notes may still use Rotli’s own format. Converting rewrites only those links, and only in this vault’s notes.",
  run: convertLinks,
  summary: convertSummary,
  pending: (report) => report.links + report.embeds > 0,
  action: "Convert links",
  busy: "Converting…",
  details: (report) =>
    report.examples.map((example) => (
      <p className="setnote" key={`${example.title}\u0000${example.before}`}>
        {example.title}: <code>{example.before}</code> → <code>{example.after}</code>
      </p>
    )),
};
