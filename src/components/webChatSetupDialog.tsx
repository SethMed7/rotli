// Rotli Web: what clicking Chat does before chat can work here. Chat runs the
// AI tools on the user's own computer, so the web needs Rotli Helper — a small
// program, not the Mac app — paired with this page, plus the tool itself
// signed in. This dialog walks those steps in order, pairs the helper, and
// says what is true about each step right now.

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { PROVIDER_LABELS, type ProviderId } from "../ai/models";
import { connectorDetectionQuery } from "../services/connectorSetup";
import { pairHelper, unpairHelper } from "../services/helperLink";
import { useChatSetupGuide } from "../state/chatSetupGuide";
import { useHelperLink } from "../state/helperLink";
import { useUiStore } from "../state/ui";
import { ConnectorGuide, GuideStep, GuideSteps } from "./settings/connectorGuide";
import { WebDialogFrame } from "./webDialogFrame";

const LANES: readonly ProviderId[] = ["claude", "codex", "cursor"];
const HELPER_RUN = "rotli-helper";

function PairHelper() {
  const link = useHelperLink((s) => s.link);
  const reachable = useHelperLink((s) => s.reachable);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pair = async () => {
    setBusy(true);
    setError(null);
    try {
      await pairHelper(code);
      setCode("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };
  if (link) {
    return (
      <span className="guide-actions">
        <span className="guide-step-detail" role="status">
          {reachable === false
            ? `Paired on port ${link.port}, but nothing answers right now — is Rotli Helper running?`
            : `Paired with Rotli Helper on port ${link.port}.`}
        </span>
        <button type="button" className="ghostbtn guide-check" onClick={() => void unpairHelper()}>
          Unpair
        </button>
      </span>
    );
  }
  return (
    <form
      className="guide-pair"
      onSubmit={(event) => {
        event.preventDefault();
        void pair();
      }}
    >
      <label className="guide-step-detail" htmlFor="helper-pairing-code">
        Paste the pairing code the helper printed:
      </label>
      <span className="guide-actions">
        <input
          id="helper-pairing-code"
          className="rename-input guide-pair-input"
          value={code}
          placeholder="43111:…"
          autoComplete="off"
          spellCheck={false}
          disabled={busy}
          onChange={(event) => setCode(event.currentTarget.value)}
        />
        <button type="submit" className="ghostbtn guide-check" disabled={busy || code.trim().length === 0}>
          {busy ? "Pairing…" : "Pair"}
        </button>
      </span>
      {error && (
        <span role="alert" className="guide-step-detail guide-pair-error">
          {error}
        </span>
      )}
    </form>
  );
}

export function WebChatSetupDialog() {
  const open = useChatSetupGuide((s) => s.open);
  const hide = useChatSetupGuide((s) => s.hide);
  const linked = useHelperLink((s) => s.link !== null);
  const [lane, setLane] = useState<ProviderId>("claude");
  if (!open) return null;
  return (
    <WebDialogFrame
      id="web-chat-setup"
      title="Chat on the web"
      className="web-chat-setup"
      onClose={hide}
      actions={
        <button type="button" className="rename-btn primary" onClick={hide}>
          {linked ? "Done" : "Close"}
        </button>
      }
    >
      <p className="web-connect-line">
        Chat runs the AI tools you already use — Claude Code, Codex, Cursor — on your own computer, next to
        your notes. Nothing goes through Rotli's servers; what you send a tool goes to that tool's provider,
        as it does in your terminal. On the web that takes three things:
      </p>
      <GuideSteps>
        <GuideStep n={1} done={linked} title="Run Rotli Helper">
          <span className="guide-step-detail">
            A small program for Mac, Windows, and Linux — not the Mac app — that runs your AI tools where your
            files are and listens only on your own computer. Start it in a terminal and leave it running:
          </span>
          <span className="guide-cmd">
            <code>{HELPER_RUN}</code>
          </span>
          <span className="guide-step-detail">
            Downloads are not published yet: build it from the Rotli source with
            <code> cargo build --release --bin rotli-helper</code>, or ask for the binary. The Mac app has
            chat built in if you would rather.
          </span>
        </GuideStep>
        <GuideStep n={2} done={linked} title="Pair this page with the helper">
          <PairHelper />
          <span className="guide-step-detail">
            If your browser asks to allow local network access, allow it. Safari does not allow a page to
            reach the helper; use Chrome, Edge, Brave, Arc, Firefox, or Zen.
          </span>
        </GuideStep>
        <GuideStep n={3} done={false} title="Install and sign in to an AI tool">
          <div className="guide-lanes" role="group" aria-label="AI tool">
            {LANES.map((id) => (
              <button
                key={id}
                type="button"
                aria-pressed={lane === id}
                className={lane === id ? "ghostbtn guide-lane on" : "ghostbtn guide-lane"}
                onClick={() => setLane(id)}
              >
                {PROVIDER_LABELS[id]}
              </button>
            ))}
          </div>
          <LaneGuide lane={lane} linked={linked} />
        </GuideStep>
      </GuideSteps>
    </WebDialogFrame>
  );
}

/** Paired, the guide can ask the helper what is installed; unpaired it cannot. */
function LaneGuide({ lane, linked }: { lane: ProviderId; linked: boolean }) {
  if (!linked) return <ConnectorGuide lane={lane} detection={undefined} />;
  return <LinkedLaneGuide lane={lane} />;
}

function LinkedLaneGuide({ lane }: { lane: ProviderId }) {
  const detection = useQuery(connectorDetectionQuery(lane));
  const enabled = useUiStore((s) => s.aiProviders[lane]);
  const setAiProvider = useUiStore((s) => s.setAiProvider);
  const ready = !!detection.data?.installed && !!detection.data?.authenticated;
  return (
    <>
      <ConnectorGuide
        lane={lane}
        detection={detection.data}
        onRecheck={() => void detection.refetch()}
        checking={detection.isFetching}
      />
      {ready && (
        <span className="guide-actions">
          <span className="guide-step-detail" role="status">
            {enabled
              ? `${PROVIDER_LABELS[lane]} is on — pick it in the chat's model menu.`
              : `${PROVIDER_LABELS[lane]} is ready on this computer.`}
          </span>
          {!enabled && (
            <button type="button" className="ghostbtn guide-check" onClick={() => setAiProvider(lane, true)}>
              Use {PROVIDER_LABELS[lane]} in chat
            </button>
          )}
        </span>
      )}
    </>
  );
}
