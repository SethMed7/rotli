// The sidebar player (the owner, 2026-09-28: "right above [the footer] have
// like a little music player: prev, pause, stop, next, open tab"), just above
// Files · Librarian · Settings · Feedback. It controls whatever a browser tab
// is playing; with Ambient audio on it is always there for the ambient track,
// which steps aside for a tab's media as the small toggle on the left
// (src/lib/ambient.ts has the rules, services/ambient.ts the machinery).

import type { ReactNode } from "react";
import { useSyncExternalStore } from "react";

import { type PlayerView, playerView, trackTitle } from "../../lib/ambient";
import {
  privateBrowserTabTitle,
  privateBrowserTitleSnapshot,
  subscribePrivateBrowserTitles,
} from "../../lib/privateBrowser";
import {
  openMediaTab,
  stepAmbient,
  stopAmbient,
  tabMediaAction,
  toggleAmbient,
} from "../../services/ambient";
import { useAmbient, useTabMedia } from "../../state/ambient";
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
export const LABELS = { play: "Play", pause: "Pause", stop: "Stop", open: "Open the tab" } as const;

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
  useSyncExternalStore(subscribePrivateBrowserTitles, privateBrowserTitleSnapshot);
  const view = playerView(prefs, media, recent, inApp);
  if (!view.visible) return null;
  return (
    <Player
      view={view}
      title={view.tab ? privateBrowserTabTitle(view.tab) : `Ambient · ${trackTitle(prefs.track)}`}
      ambientTitle={trackTitle(prefs.track)}
      ambientWanted={prefs.playing}
      onAmbientPlay={() => setPrefs({ playing: !prefs.playing })}
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
}: {
  view: PlayerView;
  title: string;
  ambientTitle: string;
  ambientWanted: boolean;
  onAmbientPlay: () => void;
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
        <span className="sb-player-title" title={title}>
          {!tab && <AmbientGlyph />}
          <span>{title}</span>
        </span>
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
            <Control label={LABELS.open} onClick={() => openMediaTab(tab)}>
              <ExternalLinkGlyph size={13} />
            </Control>
          </div>
        ) : (
          <div className="sb-player-controls">
            <Control label={SKIP.back.ambient} onClick={() => stepAmbient(SKIP.back.step)}>
              <SkipGlyph back />
            </Control>
            <Control label={ambientWanted ? LABELS.pause : LABELS.play} onClick={onAmbientPlay}>
              {ambientWanted ? <PauseGlyph /> : <PlayGlyph />}
            </Control>
            <Control label={LABELS.stop} onClick={stopAmbient}>
              <SquareGlyph size={13} />
            </Control>
            <Control label={SKIP.ahead.ambient} onClick={() => stepAmbient(SKIP.ahead.step)}>
              <SkipGlyph />
            </Control>
          </div>
        )}
      </div>
    </section>
  );
}
