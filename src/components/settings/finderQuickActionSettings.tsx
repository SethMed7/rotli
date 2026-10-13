// Settings → General → Finder (docs/design/open-in-rotli.md, stage 3): the
// opt-in "Open in Rotli" Quick Action. Adding it writes one workflow into
// ~/Library/Services — outside the app, so only on this click — and Remove
// takes back only the one Rotli made. Mac app only.

import { useEffect, useState } from "react";

import {
  type QuickActionStatus,
  finderQuickActionSet,
  finderQuickActionStatus,
} from "../../services/finderQuickAction";

export type QuickActionView =
  | { kind: "checking" }
  | { kind: "ready"; status: QuickActionStatus }
  | { kind: "busy"; status: QuickActionStatus }
  | { kind: "error"; status: QuickActionStatus | null; message: string };

/** The row's button labels (the tests read these, not copies). */
export const QUICK_ACTION_LABELS = {
  add: "Add to Finder",
  adding: "Adding…",
  remove: "Remove from Finder",
  removing: "Removing…",
} as const;

const message = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

export function FinderQuickActionSettings({ native }: { native: boolean }) {
  const [view, setView] = useState<QuickActionView>({ kind: "checking" });

  useEffect(() => {
    if (!native) return;
    let live = true;
    finderQuickActionStatus()
      .then((status) => live && setView({ kind: "ready", status }))
      .catch((cause: unknown) => live && setView({ kind: "error", status: null, message: message(cause) }));
    return () => {
      live = false;
    };
  }, [native]);

  const set = async (status: QuickActionStatus, installed: boolean) => {
    setView({ kind: "busy", status });
    try {
      setView({ kind: "ready", status: await finderQuickActionSet(installed) });
    } catch (cause) {
      setView({ kind: "error", status, message: message(cause) });
    }
  };

  return (
    <QuickActionRow native={native} view={view} onSet={(status, installed) => void set(status, installed)} />
  );
}

/** The row itself, for each state (pure — the tests render every one). */
export function QuickActionRow({
  native,
  view,
  onSet,
}: {
  native: boolean;
  view: QuickActionView;
  onSet: (status: QuickActionStatus, installed: boolean) => void;
}) {
  const status = view.kind === "checking" ? null : view.status;
  const busy = view.kind === "busy";
  return (
    <>
      <h4 className="sethead">Open in Rotli from Finder</h4>
      <p className="lead">
        Adds “Open in Rotli” to Finder’s right-click menu, under Quick Actions. A file opens in a tab, and a
        folder opens in its own window. Rotli changes nothing in Finder until you add it here.
      </p>
      {!native ? (
        <p className="setnote">In the Mac app.</p>
      ) : view.kind === "checking" ? (
        <p className="setnote" role="status">
          Checking Finder…
        </p>
      ) : (
        <>
          {view.kind === "error" && (
            <p className="setnote err" role="alert">
              Couldn’t change the Quick Action — {view.message}
            </p>
          )}
          {status === "installed" && (
            <p className="setnote" role="status">
              Added. Right-click a file or folder in Finder, then Quick Actions → Open in Rotli.
            </p>
          )}
          {status === "theirs" && (
            <p className="setnote" role="status">
              You already have a Quick Action named “Open in Rotli”, so Rotli leaves it alone.
            </p>
          )}
          {status === "absent" && (
            <button type="button" className="ghostbtn" disabled={busy} onClick={() => onSet(status, true)}>
              {busy ? QUICK_ACTION_LABELS.adding : QUICK_ACTION_LABELS.add}
            </button>
          )}
          {status === "installed" && (
            <button type="button" className="ghostbtn" disabled={busy} onClick={() => onSet(status, false)}>
              {busy ? QUICK_ACTION_LABELS.removing : QUICK_ACTION_LABELS.remove}
            </button>
          )}
        </>
      )}
    </>
  );
}
