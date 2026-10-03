// Thank you (2026-09-28): the card after setup, before the guided tour. A
// short note, a banner made from the person's own choices (their quokka, their
// theme, their name), and ways to pass Rotli on: a GitHub star, an invite for
// a friend, a post on X, and the banner to keep. Then the tour, or straight in
// (the owner, 2026-10-01: "Take tour" or "Start now", so skipping the tour is
// one click); closing the card is Start now.

import { type RefObject, useEffect, useRef, useState } from "react";

import { QUOKKA_ACCESSORY_PRESENTATIONS, QUOKKA_STYLE_PRESENTATIONS } from "../brand/quokka";
import { ROTLI_REPO_URL } from "../lib/feedback";
import { bannerText, FRIEND_INVITE, shareOnXUrl } from "../lib/thanksBanner";
import {
  bannerSavesToAssets,
  copyBannerImage,
  copyText,
  openLink,
  saveBanner,
} from "../services/thanksShare";
import { useOnboardingThanks } from "../state/onboardingThanks";
import { showSettingsHintNow } from "../state/settingsHint";
import { isDarkDataTheme, readDataTheme } from "../state/theme";
import { THEME_FAMILY_PRESENTATIONS } from "../state/themeChoices";
import { startTour } from "../state/tour";
import { useUiStore } from "../state/ui";
import { Character } from "./character";
import { composeBanner } from "./onboarding/bannerCanvas";
import { GitHubMarkGlyph, XMarkGlyph } from "./onboarding/shareMarks";
import { WebDialogFrame } from "./webDialogFrame";

type Banner = { kind: "drawing" } | { kind: "ready"; blob: Blob; url: string } | { kind: "failed" };

/** Frames to wait for the quokka's art (loaded on demand) to mount. */
const ART_WAIT_FRAMES = 120;

function themeLabel(): string {
  const dark = isDarkDataTheme(readDataTheme());
  const family = useUiStore.getState().themeFamily;
  const presentation = THEME_FAMILY_PRESENTATIONS.find((entry) => entry.family === family);
  if (!presentation) return "Rotli";
  if (family === "warm") return dark ? "Rotli Dark" : "Rotli Light";
  return dark ? presentation.darkLabel : presentation.lightLabel;
}

function currentBannerText() {
  const ui = useUiStore.getState();
  const style = QUOKKA_STYLE_PRESENTATIONS.find((entry) => entry.style === ui.quokkaStyle);
  const accessory = QUOKKA_ACCESSORY_PRESENTATIONS.find((entry) => entry.accessory === ui.quokkaAccessory);
  return bannerText({
    userName: ui.userName,
    themeLabel: themeLabel(),
    quokkaLabel: style && style.style !== "line" ? style.label : null,
    accessoryLabel: accessory && accessory.accessory !== "none" ? accessory.label : null,
  });
}

function waitForArt(host: HTMLElement): Promise<void> {
  return new Promise((resolve, reject) => {
    let frames = 0;
    const tick = () => {
      if (host.querySelector(".quokka-line, .quokka-ink-layer")) return resolve();
      if (++frames > ART_WAIT_FRAMES) return reject(new Error("the quokka didn’t load"));
      requestAnimationFrame(tick);
    };
    tick();
  });
}

/** Draws the banner once the hidden quokka has its art. */
function useBanner(quokkaHost: RefObject<HTMLSpanElement | null>): Banner {
  const [banner, setBanner] = useState<Banner>({ kind: "drawing" });
  useEffect(() => {
    let live = true;
    let url = "";
    const host = quokkaHost.current?.querySelector<HTMLElement>(".quokka");
    const drawn = host
      ? waitForArt(host).then(() => composeBanner(host, currentBannerText()))
      : Promise.reject();
    drawn
      .then((blob) => {
        if (!live) return;
        url = URL.createObjectURL(blob);
        setBanner({ kind: "ready", blob, url });
      })
      .catch(() => {
        if (live) setBanner({ kind: "failed" });
      });
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [quokkaHost]);
  return banner;
}

export function ThanksDialog() {
  const open = useOnboardingThanks((s) => s.open);
  return open ? <ThanksCard /> : null;
}

function ThanksCard() {
  const hide = useOnboardingThanks((s) => s.hide);
  const quokkaHost = useRef<HTMLSpanElement | null>(null);
  const banner = useBanner(quokkaHost);
  const [status, setStatus] = useState("");

  const takeTour = () => {
    hide();
    startTour();
  };
  const startNow = () => {
    hide();
    showSettingsHintNow();
  };

  const shareOnX = async () => {
    if (banner.kind !== "ready") return;
    // copy first, inside the click, and open X only once the write settles:
    // WebKit refuses a clipboard write whose window has lost focus
    const copied = await copyBannerImage(banner.blob);
    void openLink(shareOnXUrl());
    setStatus(
      copied
        ? "Your banner is copied. Paste it into the post with ⌘V."
        : "Opening X. Save the banner to add it to your post.",
    );
  };

  const tellAFriend = async () => {
    setStatus(
      (await copyText(FRIEND_INVITE))
        ? "An invite is copied. Send it to a friend."
        : "Couldn’t copy the invite.",
    );
  };

  const keepBanner = async () => {
    if (banner.kind !== "ready") return;
    try {
      const where = await saveBanner(banner.blob);
      setStatus(where === "assets" ? "Saved to your vault’s Assets." : "Banner downloaded.");
    } catch (error) {
      setStatus(`Couldn’t save the banner — ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const ready = banner.kind === "ready";
  return (
    <WebDialogFrame
      id="thanks"
      title="Thank you for trying Rotli"
      className="thanks-card"
      onClose={startNow}
      actions={
        <>
          {/* the shares and the tour share one row (the owner, 2026-09-30) */}
          <div className="thanks-actions" role="group" aria-label="Share Rotli">
            <button
              type="button"
              className="rename-btn thanks-mark"
              aria-label="Star on GitHub"
              title="Star Rotli on GitHub"
              onClick={() => void openLink(ROTLI_REPO_URL)}
            >
              <GitHubMarkGlyph />
              Star
            </button>
            <button type="button" className="rename-btn" onClick={() => void tellAFriend()}>
              Tell a friend
            </button>
            <button
              type="button"
              className="rename-btn thanks-mark"
              aria-label="Share on X"
              title="Share on X"
              disabled={!ready}
              onClick={() => void shareOnX()}
            >
              <XMarkGlyph />
              Share
            </button>
            <button type="button" className="rename-btn" disabled={!ready} onClick={() => void keepBanner()}>
              {bannerSavesToAssets() ? "Save banner" : "Download banner"}
            </button>
          </div>
          <span className="thanks-status" role="status">
            {status}
          </span>
          <button type="button" className="rename-btn" onClick={startNow}>
            Start now
          </button>
          <button type="button" className="rename-btn primary" onClick={takeTour}>
            Take the tour
          </button>
        </>
      }
    >
      <p className="thanks-note">
        Rotli is made in the open. If it earns a place on your Mac, a star on GitHub helps other people find
        it, and telling a friend helps even more.
      </p>
      <span ref={quokkaHost} className="thanks-quokka-source" aria-hidden="true">
        <Character name="celebrating" size={440} />
      </span>
      <div className="thanks-banner" aria-busy={banner.kind === "drawing"}>
        {banner.kind === "ready" && <img src={banner.url} alt="Your Rotli welcome banner" />}
        {banner.kind === "drawing" && <p className="thanks-note">Drawing your banner…</p>}
        {banner.kind === "failed" && (
          <p role="alert" className="rename-error">
            Couldn’t draw your banner. Everything else still works.
          </p>
        )}
      </div>
    </WebDialogFrame>
  );
}
