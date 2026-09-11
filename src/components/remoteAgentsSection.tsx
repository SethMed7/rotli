// Settings → Connections → Remote agents: pair this Mac with a relay you
// operate so a cloud MCP client can reach the running app for one session.
// Development builds only (feature policy `agents`); the caller gates the mount.
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import {
  REMOTE_AGENT_STATUS_KEY,
  type RemoteAgentPairing,
  invalidateRemoteAgentStatus,
  remoteAgentPair,
  remoteAgentStart,
  remoteAgentStatus,
  remoteAgentStop,
  remoteAgentUnpair,
  remoteAgentsNative,
} from "../services/remoteAgent";
import { useUiStore } from "../state/ui";
import { CopyGlyph } from "./glyphs";

export function RemoteAgentsSection() {
  const native = remoteAgentsNative();
  const relayUrl = useUiStore((state) => state.remoteAgentRelayUrl);
  const setRelayUrl = useUiStore((state) => state.setRemoteAgentRelayUrl);
  const [pairing, setPairing] = useState<RemoteAgentPairing | null>(null);
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);
  const [confirmUnpair, setConfirmUnpair] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; err: boolean } | null>(null);
  const status = useQuery({
    queryKey: REMOTE_AGENT_STATUS_KEY,
    queryFn: remoteAgentStatus,
    enabled: native,
    refetchInterval: 2000,
  });
  const refresh = () => void invalidateRemoteAgentStatus();
  const run = (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    setNote(null);
    action()
      .then(() => {
        setNote({ text: success, err: false });
        refresh();
      })
      .catch((error) => setNote({ text: error instanceof Error ? error.message : String(error), err: true }))
      .finally(() => setBusy(false));
  };
  const copyPairing = async () => {
    if (!pairing || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(
        `MCP URL: ${pairing.mcpUrl}\nAuthorization: ${pairing.authorizationHeader}`,
      );
      setNote({ text: "MCP URL and bearer header copied.", err: false });
    } catch {
      setNote({ text: "Rotli couldn’t access the clipboard.", err: true });
    }
  };
  const current = status.data;
  const statusLabel = !native
    ? "Unavailable"
    : status.isPending
      ? "Checking…"
      : current?.connected
        ? "Connected"
        : current?.active
          ? current.lastError
            ? "Retrying"
            : "Connecting…"
          : current?.paired
            ? "Ready"
            : "Off";
  const feedback = current?.lastError ? { text: current.lastError, err: true } : note;
  const createPairing = () => {
    setBusy(true);
    setNote(null);
    remoteAgentPair(relayUrl)
      .then((next) => {
        setPairing(next);
        setRelayUrl(next.mcpUrl);
        setConfirmRegenerate(false);
        setConfirmUnpair(false);
        setNote({
          text: "New pairing created. Copy it now—Rotli cannot reveal this client token after you leave this screen.",
          err: false,
        });
        refresh();
      })
      .catch((error) => setNote({ text: error instanceof Error ? error.message : String(error), err: true }))
      .finally(() => setBusy(false));
  };

  return (
    <section className="aisection remote-agents" aria-labelledby="remote-agents-title">
      <div className="remote-agents-head">
        <div>
          <h4 className="set-subhead" id="remote-agents-title">
            Remote agents
          </h4>
          <p className="setnote">
            Let a cloud MCP client reach this Mac through your relay. Notes stay in the vault; Rotli must be
            open and connected for every request.
          </p>
        </div>
        <span className={`ailane-chip ${current?.connected ? "ok" : current?.active ? "busy" : ""}`}>
          {statusLabel}
        </span>
      </div>

      <label className="remote-agents-field">
        <span>Relay MCP URL</span>
        <input
          type="url"
          value={relayUrl}
          disabled={!native || busy}
          maxLength={2048}
          placeholder="https://your-relay.example/mcp"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          onChange={(event) => {
            setRelayUrl(event.target.value);
            setConfirmRegenerate(false);
            setConfirmUnpair(false);
          }}
          onKeyDown={(event) => event.stopPropagation()}
        />
      </label>

      <div className="remote-agents-actions">
        <button
          type="button"
          className="ghostbtn"
          disabled={!native || busy || !relayUrl.trim()}
          onClick={() => {
            if (current?.paired && !confirmRegenerate) {
              setConfirmRegenerate(true);
              setConfirmUnpair(false);
              setNote({
                text: "Replacing the pairing disconnects this session and permanently invalidates the old client token.",
                err: false,
              });
              return;
            }
            createPairing();
          }}
        >
          {confirmRegenerate ? "Replace pairing" : current?.paired ? "Regenerate pairing" : "Create pairing"}
        </button>
        {confirmRegenerate && (
          <button
            type="button"
            className="ghostbtn quiet"
            disabled={busy}
            onClick={() => {
              setConfirmRegenerate(false);
              setNote(null);
            }}
          >
            Cancel
          </button>
        )}
        {current?.paired && (
          <button
            type="button"
            className={`ghostbtn${confirmUnpair ? " danger" : " quiet"}`}
            disabled={!native || busy}
            onClick={() => {
              if (!confirmUnpair) {
                setConfirmUnpair(true);
                setConfirmRegenerate(false);
                setNote({
                  text: "Removing the pairing disconnects this session and deletes both remote-agent tokens from Keychain.",
                  err: false,
                });
                return;
              }
              setBusy(true);
              setNote(null);
              remoteAgentUnpair()
                .then(() => {
                  setPairing(null);
                  setConfirmUnpair(false);
                  setNote({
                    text: "Pairing removed from Keychain. This Mac is no longer available remotely.",
                    err: false,
                  });
                  refresh();
                })
                .catch((error) =>
                  setNote({ text: error instanceof Error ? error.message : String(error), err: true }),
                )
                .finally(() => setBusy(false));
            }}
          >
            {confirmUnpair ? "Confirm removal" : "Remove pairing"}
          </button>
        )}
        {current?.active ? (
          <button
            type="button"
            className="ghostbtn quiet"
            disabled={busy}
            onClick={() => run(remoteAgentStop, "Remote agents disconnected for this app session.")}
          >
            Disconnect
          </button>
        ) : (
          <button
            type="button"
            className="ghostbtn primary"
            disabled={!native || busy || !current?.paired || !relayUrl.trim()}
            onClick={() => run(() => remoteAgentStart(relayUrl), "Connecting this app session to the relay…")}
          >
            Connect this session
          </button>
        )}
      </div>

      {pairing && (
        <div className="remote-agents-pairing">
          <div>
            <strong>Paste into Grok Bot</strong>
            <span>{pairing.mcpUrl}</span>
            <span>{pairing.authorizationHeader}</span>
          </div>
          <button type="button" className="ghostbtn" onClick={() => void copyPairing()}>
            <CopyGlyph size={13} /> Copy setup
          </button>
        </div>
      )}
      <p className="setnote remote-agents-boundary">
        Remote access starts disconnected after every launch. The bearer token lives in macOS Keychain; each
        pairing is bound to the relay URL used to create it, and changing relays requires a new pairing.
        Regenerating invalidates the old pairing on this Mac. Secure notes stay hidden, locked notes stay
        read-only, and stale revisions are refused. Switching vaults disconnects the current remote session.
      </p>
      {!native && <p className="setnote">Pairing is available only in the native Mac app.</p>}
      {feedback && (
        <p className={feedback.err ? "setnote err" : "setnote"} aria-live="polite">
          {feedback.text}
        </p>
      )}
    </section>
  );
}
