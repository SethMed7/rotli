// Thank you (2026-09-28): the card after setup, before the guided tour. A
// short note, a thank-you banner — the person's name and quokka in their
// theme's scenery — and ways to pass Rotli on. Then the tour, or straight in
// (the owner, 2026-10-01: "Take tour" or "Start now", so skipping the tour is
// one click); closing the card is Start now.
//
// 2026-10-15 (the owner, after a fresh-onboarding pass): the banner is a full
// scene; Share opens the share sheet (Messages, Mail, AirDrop, Notes…) in
// place of the mail-draft invite; the GitHub and X logos stand on their own,
// no chip around them; the banner is no longer saved or downloaded; and Take
// the tour comes first, with Start now the primary on the right.

import { useState } from "react";

import { ROTLI_REPO_URL } from "../lib/feedback";
import { shareOnXUrl, shareStatus } from "../lib/thanksBanner";
import { openLink, shareRotli } from "../services/thanksShare";
import { useOnboardingThanks } from "../state/onboardingThanks";
import { showSettingsHintNow } from "../state/settingsHint";
import { startTour } from "../state/tour";
import { GitHubMarkGlyph, ShareGlyph, XMarkGlyph } from "./onboarding/shareMarks";
import { ThanksBannerScene } from "./onboarding/thanksBannerScene";
import { WebDialogFrame } from "./webDialogFrame";

export function ThanksDialog() {
  const open = useOnboardingThanks((s) => s.open);
  return open ? <ThanksCard /> : null;
}

function ThanksCard() {
  const hide = useOnboardingThanks((s) => s.hide);
  const [status, setStatus] = useState("");
  const [sharing, setSharing] = useState(false);

  const takeTour = () => {
    hide();
    startTour();
  };
  const startNow = () => {
    hide();
    showSettingsHintNow();
  };
  const share = async (button: HTMLElement) => {
    setSharing(true);
    setStatus("");
    try {
      setStatus(shareStatus(await shareRotli(button)));
    } finally {
      setSharing(false);
    }
  };

  return (
    <WebDialogFrame
      id="thanks"
      title="Thank you for trying Rotli"
      className="thanks-card"
      onClose={startNow}
      actions={
        <>
          <div className="thanks-actions" role="group" aria-label="Share Rotli">
            <button
              type="button"
              className="rename-btn thanks-share"
              disabled={sharing}
              onClick={(event) => void share(event.currentTarget)}
            >
              <ShareGlyph size={14} />
              Share
            </button>
            {/* the brands' own logos, nothing around them: people know them */}
            <button
              type="button"
              className="thanks-logo"
              aria-label="Star Rotli on GitHub"
              title="Star Rotli on GitHub"
              onClick={() => void openLink(ROTLI_REPO_URL)}
            >
              <GitHubMarkGlyph size={18} />
            </button>
            <button
              type="button"
              className="thanks-logo"
              aria-label="Share on X"
              title="Share on X"
              onClick={() => void openLink(shareOnXUrl())}
            >
              <XMarkGlyph size={16} />
            </button>
            <span className="thanks-status" role="status">
              {status}
            </span>
          </div>
          {/* then what's next, on its own row so neither button is squeezed */}
          <div className="thanks-next">
            <button type="button" className="rename-btn" onClick={takeTour}>
              Take the tour
            </button>
            <button type="button" className="rename-btn primary" onClick={startNow}>
              Start now
            </button>
          </div>
        </>
      }
    >
      <p className="thanks-note">
        Rotli is made in the open. If it earns a place on your Mac, a star on GitHub helps other people find
        it, and sharing it with a friend helps even more.
      </p>
      <ThanksBannerScene />
    </WebDialogFrame>
  );
}
