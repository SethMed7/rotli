// The version and the update action sit at the foot of the Settings menu (the
// owner, 2026-11-11: "move check for updates / update available to the bottom
// of the settings left menu, more reachable"), so they're one click from every
// pane instead of at the end of a long General page. General keeps only the
// automatic-check switch.

import { useEffect, useState } from "react";

import { checkForUpdateNow, installUpdateAndRelaunch, installedVersion } from "../../services/updateCheck";
import { useUiStore } from "../../state/ui";

export type CheckState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "current" }
  | { kind: "available"; version: string | null }
  | { kind: "installing"; pct: number }
  | { kind: "error"; message: string };

/** The installed bundle version (null outside the Mac app) — the one source
 * for the Settings menu's update footer and About. */
export function useAppVersion(): string | null {
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void installedVersion()
      .then((v) => {
        if (alive && v) setVersion(v);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  return version;
}

export function statusLine(state: CheckState): string | null {
  switch (state.kind) {
    case "current":
      return "Up to date";
    case "available":
      return state.version ? `Update available: v${state.version}` : "Update available";
    case "installing":
      return "Installing…";
    default:
      return null;
  }
}

/** What the footer shows: its own check or install while one runs, otherwise
 * an update the routine background check found. */
export function shownState(
  local: CheckState,
  updateAvailable: boolean,
  updateVersion: string | null,
): CheckState {
  return updateAvailable && (local.kind === "idle" || local.kind === "current")
    ? { kind: "available", version: updateVersion }
    : local;
}

export function SettingsNavUpdates() {
  const updateAvailable = useUiStore((s) => s.updateAvailable);
  const updateVersion = useUiStore((s) => s.updateVersion);
  const setUpdateAvailable = useUiStore((s) => s.setUpdateAvailable);
  const setUpdateVersion = useUiStore((s) => s.setUpdateVersion);
  const version = useAppVersion();
  const [local, setState] = useState<CheckState>({ kind: "idle" });
  // An update the routine background check found shows here the moment it
  // lands, unless a check or install of this footer's own is under way.
  const state = shownState(local, updateAvailable, updateVersion);

  const check = () => {
    setState({ kind: "checking" });
    void checkForUpdateNow()
      .then((status) => {
        if (status.available) {
          const v = status.version ?? null;
          setUpdateAvailable(true);
          setUpdateVersion(v);
          setState({ kind: "available", version: v });
        } else {
          setUpdateAvailable(false);
          setUpdateVersion(null);
          setState({ kind: "current" });
        }
      })
      .catch((err: unknown) => {
        setState({ kind: "error", message: err instanceof Error ? err.message : String(err) });
      });
  };

  const install = () => {
    setState({ kind: "installing", pct: 0 });
    // resolves only if the relaunch doesn't happen (it normally does); on any
    // error, say so and stay on the current build
    void installUpdateAndRelaunch((pct) => setState({ kind: "installing", pct })).catch((err: unknown) => {
      setState({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    });
  };

  const installing = state.kind === "installing";
  const offer = state.kind === "available" || installing;
  const status = statusLine(state);

  return (
    <div className={offer ? "set-nav-update has-update" : "set-nav-update"}>
      <div className="set-nav-update-text" aria-live="polite">
        <span className="set-nav-version">{version ? `Rotli ${version}` : "Rotli"}</span>
        {status && <span className="set-nav-update-status">{status}</span>}
      </div>
      {state.kind === "error" && (
        <p className="set-nav-update-err" role="alert" title={state.message}>
          Couldn’t check for updates.
        </p>
      )}
      {offer ? (
        <button type="button" className="ghostbtn primary" onClick={install} disabled={installing}>
          {installing ? `Updating… ${state.pct}%` : "Install & relaunch"}
        </button>
      ) : (
        <button type="button" className="ghostbtn" onClick={check} disabled={state.kind === "checking"}>
          {state.kind === "checking" ? "Checking…" : "Check for updates"}
        </button>
      )}
    </div>
  );
}
