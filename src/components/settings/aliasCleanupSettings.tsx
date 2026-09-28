// Settings → General → Leftover note names (2026-09-28, the owner: "a full
// clean up removing all of the untitles"). Notes no longer pick up
// `Untitled` placeholders or half-typed titles as aliases, but older notes
// still carry them; this counts them on open and removes them on a click.
// An alias some note links to is kept. Mac app only (Rust does the pass).

import { useEffect, useState } from "react";

import { aliasCleanup, type AliasCleanupReport } from "../../lib/vaultRepair";
import { invalidateNotes } from "../../services/hooks";

type View =
  | { kind: "checking" }
  | { kind: "found"; report: AliasCleanupReport }
  | { kind: "cleaning"; report: AliasCleanupReport }
  | { kind: "done"; report: AliasCleanupReport }
  | { kind: "error"; message: string };

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

export function AliasCleanupSettings({ native }: { native: boolean }) {
  const [view, setView] = useState<View>({ kind: "checking" });

  useEffect(() => {
    if (!native) return;
    let live = true;
    aliasCleanup(false)
      .then((report) => live && setView({ kind: "found", report }))
      .catch((error) => live && setView({ kind: "error", message: String(error) }));
    return () => {
      live = false;
    };
  }, [native]);

  const clean = async (report: AliasCleanupReport) => {
    setView({ kind: "cleaning", report });
    try {
      const done = await aliasCleanup(true);
      await invalidateNotes();
      setView({ kind: "done", report: done });
    } catch (error) {
      setView({ kind: "error", message: error instanceof Error ? error.message : String(error) });
    }
  };

  return (
    <>
      <h4 className="sethead">Leftover note names</h4>
      <p className="lead">
        Older notes can remember names they never really had: “Untitled”, or a title caught half-typed.
        Cleaning up removes those from every note’s metadata. A name a link still uses is kept.
      </p>
      {!native ? (
        <p className="setnote">In the Mac app.</p>
      ) : view.kind === "checking" ? (
        <p className="setnote" role="status">
          Checking your notes…
        </p>
      ) : view.kind === "error" ? (
        <p className="setnote err" role="alert">
          Couldn’t check your notes — {view.message}
        </p>
      ) : (
        <>
          <p className="setnote" role="status">
            {cleanupSummary(view.report, view.kind === "done")}
          </p>
          {view.kind !== "done" && view.report.aliases > 0 && (
            <button
              type="button"
              className="ghostbtn"
              disabled={view.kind === "cleaning"}
              onClick={() => void clean(view.report)}
            >
              {view.kind === "cleaning" ? "Cleaning up…" : "Clean up"}
            </button>
          )}
        </>
      )}
    </>
  );
}
