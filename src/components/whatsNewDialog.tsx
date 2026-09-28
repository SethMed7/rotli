// What's new (2026-09-28): after an update, the release's top changes in a
// small card, once. The palette's "What's new in Rotli" reopens the newest.
// Which highlights and when is lib/whatsNew.ts; this is the card.

import { useEffect } from "react";

import { dispatch } from "../keys/registry";
import { highlightsFor, platformNote, WHATS_NEW as NOTES, whatsNewDecision } from "../lib/whatsNew";
import { useUiStore } from "../state/ui";
import { hideWhatsNew, showWhatsNew, useWhatsNew } from "../state/whatsNew";
import { Character } from "./character";
import { WebDialogFrame } from "./webDialogFrame";

declare const __APP_VERSION__: string;
const APP_VERSION = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "0.0.0";

/** The launch check, once per mount: show after an update, else quietly note
 * the version as seen (a fresh install never gets a list of "new" things). */
function useWhatsNewOnLaunch(): void {
  useEffect(() => {
    const ui = useUiStore.getState();
    const { show, record } = whatsNewDecision({
      current: APP_VERSION,
      lastSeen: ui.lastSeenVersion,
      onboarded: ui.onboarded,
      onboardingVersion: ui.onboardingVersion,
      notes: NOTES,
    });
    if (show) showWhatsNew(APP_VERSION);
    else if (record) useUiStore.setState({ lastSeenVersion: APP_VERSION });
  }, []);
}

export function WhatsNewDialog() {
  useWhatsNewOnLaunch();
  const version = useWhatsNew((s) => s.version);
  const items = version ? highlightsFor(NOTES, version) : null;
  if (!version || !items) return null;

  const close = () => {
    hideWhatsNew();
    if (useUiStore.getState().lastSeenVersion !== APP_VERSION)
      useUiStore.setState({ lastSeenVersion: APP_VERSION });
  };

  return (
    <WebDialogFrame
      id="whats-new"
      title={`What’s new in Rotli ${version}`}
      className="whats-new-card"
      onClose={close}
      actions={
        <>
          <button type="button" className="rename-btn" onClick={() => dispatch("app.changelog")}>
            See everything new
          </button>
          <button type="button" className="rename-btn primary" onClick={close}>
            Got it
          </button>
        </>
      }
    >
      <Character name="celebrating" size={88} className="whats-new-quokka" />
      <ul className="whats-new-list">
        {items.map((item) => {
          const only = platformNote(item.platform);
          return (
            <li key={item.title}>
              <p className="whats-new-title">
                {item.title}
                {only && <span className="whats-new-platform">{only}</span>}
              </p>
              <p className="whats-new-body">{item.body}</p>
            </li>
          );
        })}
      </ul>
    </WebDialogFrame>
  );
}
