// The sidebar player (the owner, 2026-09-28: "right above [the footer] have
// like a little music player: prev, pause, stop, next, open tab"), just above
// Files · Librarian · Settings · Feedback. It controls whatever a browser tab
// is playing; with Ambient audio on it is always there for the ambient track,
// which steps aside for a tab's media as the small toggle on the left
// (src/lib/ambient.ts has the rules, services/ambient.ts the machinery).

import type { ReactNode } from "react";
import { useSyncExternalStore } from "react";

import { AMBIENT_SOURCES, isStream, type PlayerView, playerView, trackTitle } from "../../lib/ambient";
import { PLATFORM } from "../../lib/featurePolicy";
import {
  privateBrowserTabTitle,
  privateBrowserTitleSnapshot,
  subscribePrivateBrowserTitles,
} from "../../lib/privateBrowser";
import {
  chooseAmbient,
  openClaudeFmTab,
  openMediaTab,
  stepAmbient,
  stopAmbient,
  tabMediaAction,
  toggleAmbient,
} from "../../services/ambient";
import { bringBackTab, closeTuckedTab, tuckTab } from "../../services/mediaDock";
import { useAmbient, useTabMedia } from "../../state/ambient";
import { useContextMenu } from "../../state/contextMenu";
import { useMediaDock } from "../../state/mediaDock";
import { ExternalLinkGlyph, SquareGlyph } from "../glyphs";

function Svg({ children }: { children: ReactNode }) {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      {children}
    </svg>
  );
}
const PlayGlyph = () => (
  <Svg>
    <path d="M8 5.5v13l10.5-6.5z" />
  </Svg>
);
const PauseGlyph = () => (
  <Svg>
    <rect x="6.5" y="5.5" width="4" height="13" rx="1" />
    <rect x="13.5" y="5.5" width="4" height="13" rx="1" />
  </Svg>
);
const SkipGlyph = ({ back = false }: { back?: boolean }) => (
  <Svg>
    <path d={back ? "M17 6v12L8.5 12zM7 6h2v12H7z" : "M7 6v12l8.5-6zM15 6h2v12h-2z"} />
  </Svg>
);
/** Two eighth notes: the ambient track. */
export const AmbientGlyph = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M9 18V6l11-2v12" />
    <circle cx="6.5" cy="18" r="2.5" />
    <circle cx="17.5" cy="16" r="2.5" />
  </svg>
);

/** The other buttons' names (tests read them from here too). */
export const LABELS = {
  play: "Play",
  pause: "Pause",
  stop: "Stop",
  open: "Open the tab",
  tuck: "Tuck into the player",
  close: "Close the tab",
  choose: "Choose the ambient sound",
  openStream: "Open Claude FM in a tab",
} as const;

/** A tab folding down into a bar: tuck it into the player. */
const TuckGlyph = () => (
  <Svg>
    <path d="M11 4h2v8.2l3.3-3.3 1.4 1.4L12 16l-5.7-5.7 1.4-1.4 3.3 3.3zM5 18h14v2H5z" />
  </Svg>
);
const CloseGlyph = () => (
  <Svg>
    <path d="M7.4 6 12 10.6 16.6 6 18 7.4 13.4 12l4.6 4.6-1.4 1.4-4.6-4.6L7.4 18 6 16.6l4.6-4.6L6 7.4z" />
  </Svg>
);

/** The ambient sources as a menu under the player's title; the one playing
 * is the highlighted row. */
function openSourceMenu(anchor: HTMLElement, current: string): void {
  const rect = anchor.getBoundingClientRect();
  useContextMenu.getState().open(
    rect.left,
    rect.bottom + 4,
    // Claude FM plays in the Mac app's private browser, which Rotli Web hasn't
    AMBIENT_SOURCES.filter((source) => PLATFORM !== "web" || !isStream(source.id)).map((source) => ({
      kind: "action" as const,
      label: source.title,
      checked: source.id === current,
      checkedMark: "highlight" as const,
      onClick: () => chooseAmbient(source.id),
    })),
  );
}

/** The skip buttons, for a tab's media and for the ambient tracks. */
export const SKIP = {
  back: { action: "previous", tab: "Previous", ambient: "Previous track", step: -1 },
  ahead: { action: "next", tab: "Next", ambient: "Next track", step: 1 },
} as const;

function Control({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className="sb-player-btn" aria-label={label} title={label} onClick={onClick}>
      {children}
    </button>
  );
}

export function MediaPlayer() {
  const prefs = useAmbient((s) => s.prefs);
  const setPrefs = useAmbient((s) => s.setPrefs);
  const media = useTabMedia((s) => s.media);
  const recent = useTabMedia((s) => s.recent);
  const inApp = useTabMedia((s) => s.inApp);
  const docked = useMediaDock((s) => s.tabId);
  useSyncExternalStore(subscribePrivateBrowserTitles, privateBrowserTitleSnapshot);
  const view = playerView(prefs, media, recent, inApp);
  if (!view.visible) return null;
  return (
    <Player
      view={view}
      title={view.tab ? privateBrowserTabTitle(view.tab) : trackTitle(prefs.track)}
      ambientTitle={trackTitle(prefs.track)}
      ambientWanted={prefs.playing}
      onAmbientPlay={() => setPrefs({ playing: !prefs.playing })}
      tucked={!!view.tab && view.tab === docked}
      canTuck={!docked}
      stream={isStream(prefs.track)}
      onChooseSource={(anchor) => openSourceMenu(anchor, prefs.track)}
    />
  );
}

/** The player for one moment (tests render it directly). */
export function Player({
  view,
  title,
  ambientTitle,
  ambientWanted,
  onAmbientPlay,
  tucked = false,
  canTuck = true,
  onChooseSource,
  stream = false,
}: {
  view: PlayerView;
  title: string;
  ambientTitle: string;
  ambientWanted: boolean;
  onAmbientPlay: () => void;
  /** The tab is tucked into the player (no pane shows it). */
  tucked?: boolean;
  /** No tab is tucked yet, so this one may be. */
  canTuck?: boolean;
  onChooseSource?: (anchor: HTMLElement) => void;
  /** Ambient is Claude FM: offer its page as a tab. */
  stream?: boolean;
}) {
  const tab = view.tab;
  return (
    <section className="sb-player" aria-label="Now playing">
      {view.ambientDocked && (
        <button
          type="button"
          className={view.ambientPlays ? "sb-player-ambient on" : "sb-player-ambient"}
          aria-pressed={view.ambientPlays}
          aria-label={view.tabPlaying ? `Play ambient ${ambientTitle} instead` : `Ambient ${ambientTitle}`}
          title={view.tabPlaying ? `Pause the tab and play ${ambientTitle}` : `Ambient: ${ambientTitle}`}
          onClick={toggleAmbient}
        >
          <AmbientGlyph />
        </button>
      )}
      <div className="sb-player-main">
        {tab || !onChooseSource ? (
          <span className="sb-player-title" title={title}>
            {!tab && <AmbientGlyph />}
            <span>{title}</span>
          </span>
        ) : (
          <button
            type="button"
            className="sb-player-title sb-player-source"
            title={LABELS.choose}
            aria-label={`${LABELS.choose}: ${ambientTitle}`}
            aria-haspopup="menu"
            onClick={(event) => onChooseSource(event.currentTarget)}
          >
            <AmbientGlyph />
            <span>{title}</span>
          </button>
        )}
        {tab ? (
          <div className="sb-player-controls">
            <Control label={SKIP.back.tab} onClick={() => tabMediaAction(tab, SKIP.back.action)}>
              <SkipGlyph back />
            </Control>
            <Control
              label={view.tabPlaying ? LABELS.pause : LABELS.play}
              onClick={() => tabMediaAction(tab, view.tabPlaying ? "pause" : "play")}
            >
              {view.tabPlaying ? <PauseGlyph /> : <PlayGlyph />}
            </Control>
            <Control label={LABELS.stop} onClick={() => tabMediaAction(tab, "stop")}>
              <SquareGlyph size={13} />
            </Control>
            <Control label={SKIP.ahead.tab} onClick={() => tabMediaAction(tab, SKIP.ahead.action)}>
              <SkipGlyph />
            </Control>
            <Control label={LABELS.open} onClick={() => (tucked ? bringBackTab() : openMediaTab(tab))}>
              <ExternalLinkGlyph size={13} />
            </Control>
            {tucked ? (
              <Control label={LABELS.close} onClick={closeTuckedTab}>
                <CloseGlyph />
              </Control>
            ) : (
              canTuck && (
                <Control label={LABELS.tuck} onClick={() => void tuckTab(tab)}>
                  <TuckGlyph />
                </Control>
              )
            )}
          </div>
        ) : (
          <div className="sb-player-controls">
            <Control label={SKIP.back.ambient} onClick={() => stepAmbient(SKIP.back.step)}>
              <SkipGlyph back />
            </Control>
            <Control label={ambientWanted ? LABELS.pause : LABELS.play} onClick={onAmbientPlay}>
              {ambientWanted ? <PauseGlyph /> : <PlayGlyph />}
            </Control>
            {/* a live stream has nothing to rewind: Pause is its stop */}
            {!stream && (
              <Control label={LABELS.stop} onClick={stopAmbient}>
                <SquareGlyph size={13} />
              </Control>
            )}
            <Control label={SKIP.ahead.ambient} onClick={() => stepAmbient(SKIP.ahead.step)}>
              <SkipGlyph />
            </Control>
            {stream && (
              <Control label={LABELS.openStream} onClick={openClaudeFmTab}>
                <ExternalLinkGlyph size={13} />
              </Control>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
