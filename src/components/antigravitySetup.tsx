// Settings → AI Models → Antigravity: the install + sign-in card. Google's
// official ACP agent has no CLI and no login command, so unlike the other
// lanes this one is set up from inside Rotli: download the registry-listed
// runtime (pinned hash), then let the agent run its own Google sign-in in the
// default browser. Rotli never sees the credential; the agent keeps it in a
// private profile. Off by default (ADR docs/decisions/2026-09-03).

import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";

import {
  ANTIGRAVITY_STATUS_KEY,
  antigravityCancelSignIn,
  antigravityInstall,
  antigravityRemove,
  antigravitySignIn,
  antigravitySignOut,
  antigravityStatus,
  invalidateAntigravityStatus,
} from "../services/antigravity";

export function AntigravitySetup({ onChange }: { onChange: () => void }) {
  const status = useQuery({
    queryKey: ANTIGRAVITY_STATUS_KEY,
    queryFn: antigravityStatus,
    staleTime: 15_000,
  });
  const [error, setError] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);
  const settle = (message?: string) => {
    setError(message ?? "");
    invalidateAntigravityStatus();
    onChange();
  };
  const fail = (e: unknown) => settle(e instanceof Error ? e.message : String(e));
  const install = useMutation({ mutationFn: antigravityInstall, onSuccess: () => settle(), onError: fail });
  const signIn = useMutation({ mutationFn: antigravitySignIn, onSuccess: () => settle(), onError: fail });
  const signOut = useMutation({ mutationFn: antigravitySignOut, onSuccess: () => settle(), onError: fail });
  const remove = useMutation({
    mutationFn: antigravityRemove,
    onSuccess: () => {
      setConfirmRemove(false);
      settle();
    },
    onError: fail,
  });
  const s = status.data;
  const busy = install.isPending || signIn.isPending || signOut.isPending || remove.isPending;

  if (!s) return <p className="ailane-desc">Checking the Antigravity runtime…</p>;
  if (!s.platformSupported) {
    return (
      <p className="ailane-desc" role="status">
        Google publishes the Antigravity runtime for Apple Silicon Macs only; this Mac cannot run it.
      </p>
    );
  }
  return (
    <div className="ailane-help">
      <p className="ailane-desc">
        Google&rsquo;s FAQ still says third-party tools may not reuse an Antigravity login and that doing so
        can suspend the account; DeepMind staff have said publicly (September 2026) that the text is out of
        date and not enforced. Rotli uses Google&rsquo;s own published ACP agent, never the IDE&rsquo;s login.
        Turning this lane on is your call.
      </p>
      <div className="ailane-verify">
        {!s.installed || s.updateAvailable ? (
          <button type="button" className="ghostbtn primary" disabled={busy} onClick={() => install.mutate()}>
            {install.isPending
              ? "Downloading 315 MB and verifying…"
              : s.installed
                ? `Update to ${s.latestVersion}`
                : "Install Google's Antigravity agent"}
          </button>
        ) : (
          <span className="ailane-chip ok">runtime {s.version ?? s.latestVersion}</span>
        )}
        {!s.installed && !install.isPending && (
          <span className="ailane-desc">
            This is Google&rsquo;s ACP agent (about 315 MB), separate from the <code>agy</code> command line
            and the Antigravity IDE and their logins; Rotli uses only this runtime.
          </span>
        )}
        {s.installed && !s.signedIn && !signIn.isPending && (
          <button type="button" className="ghostbtn primary" disabled={busy} onClick={() => signIn.mutate()}>
            Sign in with Google
          </button>
        )}
        {signIn.isPending && (
          <>
            <span className="ailane-chip busy">Waiting for Google sign-in in your browser…</span>
            <button type="button" className="ghostbtn quiet" onClick={() => void antigravityCancelSignIn()}>
              Cancel
            </button>
          </>
        )}
        {s.installed && s.signedIn && (
          <>
            <span className="ailane-chip ok">signed in</span>
            <button type="button" className="ghostbtn quiet" disabled={busy} onClick={() => signOut.mutate()}>
              Sign out
            </button>
          </>
        )}
        {s.installed && !confirmRemove && (
          <button
            type="button"
            className="ghostbtn quiet"
            disabled={busy}
            onClick={() => setConfirmRemove(true)}
          >
            Remove runtime…
          </button>
        )}
        {confirmRemove && (
          <>
            <button type="button" className="ghostbtn danger" disabled={busy} onClick={() => remove.mutate()}>
              {remove.isPending ? "Removing…" : "Remove the downloaded runtime"}
            </button>
            <button type="button" className="ghostbtn quiet" onClick={() => setConfirmRemove(false)}>
              Keep it
            </button>
          </>
        )}
      </div>
      {error && (
        <p className="ailane-chip err" role="alert">
          {error}
        </p>
      )}
      {!s.installed && (
        <p className="ailane-desc">
          Rotli downloads the exact release listed on the Agent Client Protocol registry from dl.google.com,
          checks its SHA-256 and size, and keeps it in Application Support. Nothing runs until you sign in.
        </p>
      )}
    </div>
  );
}
