// Rotli Web: what clicking Chat does before chat can work here. Chat runs the
// AI tools on the user's own computer, so the web needs Rotli Helper — a small
// program, not the Mac app — paired with this page, plus the tool itself
// signed in. This dialog walks those steps in order, pairs the helper, and
// says what is true about each step right now.

import { useQueries } from "@tanstack/react-query";
import { useState } from "react";

import { type GuideOs, guideOs } from "../ai/connectorGuides";
import { PROVIDER_LABELS, type ProviderId } from "../ai/models";
import { type CliDetect, connectorDetectionQuery } from "../services/connectorSetup";
import { pairHelper, unpairHelper, verifyHelper } from "../services/helperLink";
import { useChatSetupGuide } from "../state/chatSetupGuide";
import { useHelperLink } from "../state/helperLink";
import { useUiStore } from "../state/ui";
import { ConnectorGuide, CopyCommand, GuideStep, GuideSteps } from "./settings/connectorGuide";
import { WebDialogFrame } from "./webDialogFrame";

const LANES: readonly ProviderId[] = ["claude", "codex", "cursor"];

function PairHelper() {
  const link = useHelperLink((s) => s.link);
  const reachable = useHelperLink((s) => s.reachable);
  const problem = useHelperLink((s) => s.problem);
  const [checking, setChecking] = useState(false);
  const checkAgain = async () => {
    setChecking(true);
    await verifyHelper();
    setChecking(false);
  };
  if (link) {
    return (
      <span className="guide-actions">
        <span className="guide-step-detail" role="status">
          {problem === "refused"
            ? `Rotli Helper on port ${link.port} refused this pairing — it printed a new code. Unpair, then paste the new one.`
            : reachable === false || problem === "unreachable"
              ? `Paired on port ${link.port}, but nothing answers right now — is Rotli Helper running?`
              : `Paired with Rotli Helper on port ${link.port}.`}
        </span>
        <button
          type="button"
          className="ghostbtn guide-check"
          disabled={checking}
          onClick={() => void checkAgain()}
        >
          {checking ? "Checking…" : "Check again"}
        </button>
        <button type="button" className="ghostbtn guide-check" onClick={() => void unpairHelper()}>
          Unpair
        </button>
      </span>
    );
  }
  return <PairingCodeForm id="helper-pairing-code" label="Paste the pairing code the helper printed:" />;
}

/** Paste the code Rotli Helper printed; proven with one call before it is
 * kept. Shared by chat setup and vault setup. */
export function PairingCodeForm({
  id,
  label,
  initialCode = "",
  onPaired,
}: {
  id: string;
  label: string;
  /** A code the installer handed this tab (`#pair=`): shown filled in. */
  initialCode?: string;
  onPaired?: () => void;
}) {
  const [code, setCode] = useState(initialCode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pair = async () => {
    setBusy(true);
    setError(null);
    try {
      await pairHelper(code);
      setCode("");
      onPaired?.();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="guide-pair"
      onSubmit={(event) => {
        event.preventDefault();
        void pair();
      }}
    >
      <label className="guide-step-detail" htmlFor={id}>
        {label}
      </label>
      <span className="guide-actions">
        <input
          id={id}
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
      {busy && (
        <span className="guide-step-detail" role="status">
          If your browser asks whether this page may connect to apps on this device, choose Allow.
        </span>
      )}
      {error && (
        <span role="alert" className="guide-step-detail guide-pair-error">
          {error}
        </span>
      )}
    </form>
  );
}

/** The installer line for this OS. The scripts live on the site
 * (site/public/helper) and download a prebuilt binary; no toolchain needed. */
export function helperInstall(os: GuideOs): { command: string; detail: string; start: string } {
  // the installers live beside this page: rotli.co in production, the dev
  // server in development (which also serves the locally built binary)
  const origin = typeof location === "undefined" ? "https://rotli.co" : location.origin;
  if (os === "windows") {
    return {
      // the installer registers a logon task, then opens ${origin}/app/ with
      // the pairing code in the URL fragment (never sent to a server)
      command: `& ([scriptblock]::Create((irm ${origin}/helper/install.ps1))) -Open ${origin}/app/`,
      detail: "Paste it into PowerShell (open it from the Start menu).",
      start: String.raw`& "$HOME\.rotli\bin\rotli-helper.exe"`,
    };
  }
  return {
    command: `curl -fsSL ${origin}/helper/install.sh | sh -s -- --open ${origin}/app/`,
    detail:
      os === "mac"
        ? "Paste it into Terminal (in Applications → Utilities, or search for it with ⌘Space)."
        : "Paste it into your terminal. Linux needs the webkit2gtk library your distribution ships.",
    start: "~/.rotli/bin/rotli-helper",
  };
}

export function WebChatSetupDialog() {
  const open = useChatSetupGuide((s) => s.open);
  const install = helperInstall(guideOs(navigator.platform || navigator.userAgent));
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
        <GuideStep n={1} done={linked} title="Install and start Rotli Helper">
          <span className="guide-step-detail">
            A small program for Mac, Windows, and Linux — not the Mac app — that runs your AI tools where your
            files are and listens only on your own computer. One line in a terminal downloads it and starts
            it:
          </span>
          <CopyCommand command={install.command} />
          <span className="guide-step-detail">
            {install.detail} It prints a pairing code. Keep the window open while you chat; Ctrl+C stops it.
            Next time, start it with:
          </span>
          <CopyCommand command={install.start} />
        </GuideStep>
        <GuideStep n={2} done={linked} title="Pair this page with the helper">
          <PairHelper />
          <span className="guide-step-detail">
            If your browser asks to allow local network access, allow it. Safari does not allow a page to
            reach the helper; use Chrome, Edge, Brave, Arc, Firefox, or Zen.
          </span>
        </GuideStep>
        {linked ? (
          <LaneScan lane={lane} setLane={setLane} />
        ) : (
          <GuideStep n={3} done={false} title="Install and sign in to an AI tool">
            <span className="guide-step-detail">
              Pair first and Rotli checks what is already installed on this computer. Until then, the steps:
            </span>
            <LaneButtons lane={lane} setLane={setLane} />
            <ConnectorGuide lane={lane} detection={undefined} />
          </GuideStep>
        )}
      </GuideSteps>
    </WebDialogFrame>
  );
}

function laneStatus(d: CliDetect | undefined, pending: boolean): { label: string; ready: boolean } {
  if (!d) return { label: pending ? "Checking…" : "Not checked", ready: false };
  if (!d.installed) return { label: "Not installed", ready: false };
  if (!d.authenticated) return { label: "Sign in needed", ready: false };
  return { label: "Connected", ready: true };
}

function LaneButtons({
  lane,
  setLane,
  badges,
}: {
  lane: ProviderId;
  setLane: (id: ProviderId) => void;
  badges?: Partial<Record<ProviderId, { label: string; ready: boolean }>> | undefined;
}) {
  return (
    <div className="guide-lanes" role="group" aria-label="AI tool">
      {LANES.map((id) => {
        const badge = badges?.[id];
        return (
          <button
            key={id}
            type="button"
            aria-pressed={lane === id}
            className={lane === id ? "ghostbtn guide-lane on" : "ghostbtn guide-lane"}
            onClick={() => setLane(id)}
          >
            {PROVIDER_LABELS[id]}
            {badge && (
              <span className={badge.ready ? "guide-lane-badge ok" : "guide-lane-badge"}>{badge.label}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Paired: scan every tool on this computer; a ready one reads Connected and
 * needs no install steps, only the switch that puts it in the chat. */
function LaneScan({ lane, setLane }: { lane: ProviderId; setLane: (id: ProviderId) => void }) {
  const checks = useQueries({ queries: LANES.map((id) => connectorDetectionQuery(id)) });
  const aiProviders = useUiStore((s) => s.aiProviders);
  const setAiProvider = useUiStore((s) => s.setAiProvider);
  const badges: Partial<Record<ProviderId, { label: string; ready: boolean }>> = {};
  LANES.forEach((id, index) => {
    badges[id] = laneStatus(checks[index]?.data, checks[index]?.isFetching ?? false);
  });
  const index = LANES.indexOf(lane);
  const check = checks[index];
  const detection = check?.data;
  const status = badges[lane] ?? { label: "Not checked", ready: false };
  const enabled = aiProviders[lane];
  const version = detection?.version?.match(/\d+(?:\.\d+)+/)?.[0];
  const anyOn = LANES.some((id) => badges[id]?.ready && aiProviders[id]);
  const recheck = () => void check?.refetch();
  return (
    <GuideStep n={3} done={anyOn} title={anyOn ? "An AI tool is connected" : "Connect an AI tool"}>
      <LaneButtons lane={lane} setLane={setLane} badges={badges} />
      {status.ready ? (
        <span className="guide-actions">
          <span className="guide-step-detail" role="status">
            Connected — {PROVIDER_LABELS[lane]}
            {version ? ` v${version}` : ""} is installed and signed in on this computer.
            {enabled ? " It is on: pick it in the chat's model menu." : ""}
          </span>
          {enabled ? (
            <button
              type="button"
              className="ghostbtn guide-check"
              onClick={recheck}
              disabled={check?.isFetching}
            >
              {check?.isFetching ? "Checking…" : "Check again"}
            </button>
          ) : (
            <button type="button" className="ghostbtn guide-check" onClick={() => setAiProvider(lane, true)}>
              Use {PROVIDER_LABELS[lane]} in chat
            </button>
          )}
        </span>
      ) : (
        <>
          <span className="guide-step-detail" role="status">
            {detection
              ? `${PROVIDER_LABELS[lane]}: ${status.label.toLowerCase()} on this computer. The steps:`
              : "Checking this computer…"}
          </span>
          <ConnectorGuide
            lane={lane}
            detection={detection}
            onRecheck={recheck}
            checking={check?.isFetching ?? false}
          />
        </>
      )}
    </GuideStep>
  );
}
