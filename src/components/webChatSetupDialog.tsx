// Rotli Web: what clicking Chat does before chat can work here. Chat runs the
// AI tools on the user's own computer, so the web needs Rotli Helper — a small
// program, not the Mac app — plus the tool itself signed in. This dialog walks
// those steps in order and says plainly which one is not shipped yet, so the
// user can do the parts that are theirs today (install the tool, sign in) and
// never wonders where the chat went.

import { useState } from "react";

import { PROVIDER_LABELS, type ProviderId } from "../ai/models";
import { useChatSetupGuide } from "../state/chatSetupGuide";
import { ConnectorGuide } from "./settings/connectorGuide";
import { WebDialogFrame } from "./webDialogFrame";

const LANES: readonly ProviderId[] = ["claude", "codex", "cursor"];

export function WebChatSetupDialog() {
  const open = useChatSetupGuide((s) => s.open);
  const hide = useChatSetupGuide((s) => s.hide);
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
          Close
        </button>
      }
    >
      <p className="web-connect-line">
        Chat runs the AI tools you already use — Claude Code, Codex, Cursor — on your own computer, next to
        your notes. Nothing goes through Rotli's servers. On the web that takes three things:
      </p>
      <ol className="ailane-steps guide-steps">
        <li className="guide-step">
          <span className="guide-step-n" aria-hidden="true">
            1
          </span>
          <span className="guide-step-body">
            <span className="guide-step-title">Install Rotli Helper</span>
            <span className="guide-step-detail">
              A small program for Mac, Windows, and Linux — not the Mac app — that runs your AI tools where
              your files are and talks only to this page, on your own computer. It is the next thing being
              built and is not released yet; this step turns live the day it ships.
            </span>
            <span className="guide-actions">
              <button type="button" className="ghostbtn guide-check" disabled title="Not released yet">
                Get Rotli Helper · coming soon
              </button>
              <a className="guide-aside" href="/" target="_blank" rel="noopener">
                Prefer the Mac app? It has chat built in.
              </a>
            </span>
          </span>
        </li>
        <li className="guide-step">
          <span className="guide-step-n" aria-hidden="true">
            2
          </span>
          <span className="guide-step-body">
            <span className="guide-step-title">Connect this page to the helper</span>
            <span className="guide-step-detail">
              The helper shows a code; you paste it here. It only ever listens on your own computer.
            </span>
          </span>
        </li>
        <li className="guide-step">
          <span className="guide-step-n" aria-hidden="true">
            3
          </span>
          <span className="guide-step-body">
            <span className="guide-step-title">Install and sign in to an AI tool — you can do this now</span>
            <div className="guide-lanes" role="tablist" aria-label="AI tool">
              {LANES.map((id) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={lane === id}
                  className={lane === id ? "ghostbtn guide-lane on" : "ghostbtn guide-lane"}
                  onClick={() => setLane(id)}
                >
                  {PROVIDER_LABELS[id]}
                </button>
              ))}
            </div>
            <ConnectorGuide lane={lane} detection={undefined} />
          </span>
        </li>
      </ol>
    </WebDialogFrame>
  );
}
