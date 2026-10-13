// One Settings row for a vault-wide pass the person runs on purpose (leftover
// note names, link format): it checks on open, says what it found, may show a
// few details, and changes files only on a click. Mac app only (Rust does
// every pass); elsewhere the row says so.

import { type ReactNode, useEffect, useState } from "react";

import { invalidateNotes } from "../../services/hooks";

type View<R> =
  | { kind: "checking" }
  | { kind: "found"; report: R }
  | { kind: "running"; report: R }
  | { kind: "done"; report: R }
  | { kind: "error"; message: string };

export interface VaultPass<R> {
  title: string;
  lead: ReactNode;
  /** Count with `false`, change files with `true`. */
  run: (apply: boolean) => Promise<R>;
  summary: (report: R, done: boolean) => string;
  /** Whether the check found anything to change. */
  pending: (report: R) => boolean;
  action: string;
  busy: string;
  /** Optional preview lines under the summary, before the change. */
  details?: (report: R) => ReactNode;
}

export function VaultPassSettings<R>({ native, pass }: { native: boolean; pass: VaultPass<R> }) {
  const [view, setView] = useState<View<R>>({ kind: "checking" });
  const { run } = pass;

  useEffect(() => {
    if (!native) return;
    let live = true;
    run(false)
      .then((report) => live && setView({ kind: "found", report }))
      .catch((error) => live && setView({ kind: "error", message: String(error) }));
    return () => {
      live = false;
    };
  }, [native, run]);

  const apply = async (report: R) => {
    setView({ kind: "running", report });
    try {
      const done = await run(true);
      await invalidateNotes();
      setView({ kind: "done", report: done });
    } catch (error) {
      setView({ kind: "error", message: error instanceof Error ? error.message : String(error) });
    }
  };

  return (
    <>
      <h4 className="sethead">{pass.title}</h4>
      <p className="lead">{pass.lead}</p>
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
            {pass.summary(view.report, view.kind === "done")}
          </p>
          {view.kind !== "done" && pass.details?.(view.report)}
          {view.kind !== "done" && pass.pending(view.report) && (
            <button
              type="button"
              className="ghostbtn"
              disabled={view.kind === "running"}
              onClick={() => void apply(view.report)}
            >
              {view.kind === "running" ? pass.busy : pass.action}
            </button>
          )}
        </>
      )}
    </>
  );
}
