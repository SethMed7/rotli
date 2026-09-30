// Setup's music player (the owner, 2026-09-30: "something to mimic what we
// have in the sidebar that moves through the next steps with you, in one of
// the corners"). Once music is on, from the Sound step through the vault and
// model steps, the sidebar player's controls sit quietly in the top-right
// corner: the track, previous and next (a live stream has none), pause, and
// the studio track's volume. It plays through the same machinery as the
// sidebar (services/ambient.ts).

import { isStream, trackTitle } from "../../lib/ambient";
import { stepAmbient } from "../../services/ambient";
import { useAmbient } from "../../state/ambient";
import { AmbientVolume } from "../settings/ambientSettings";
import { AmbientGlyph, PauseGlyph, PlayGlyph, SKIP, SkipGlyph } from "../sidebar/mediaPlayer";

export function SetupPlayer() {
  const prefs = useAmbient((s) => s.prefs);
  const setPrefs = useAmbient((s) => s.setPrefs);
  if (!prefs.enabled) return null;
  const stream = isStream(prefs.track);
  return (
    <section className="setup-player" aria-label="Music">
      <span className="setup-player-title">
        <AmbientGlyph />
        <span>{trackTitle(prefs.track)}</span>
      </span>
      {!stream && (
        <button
          type="button"
          className="sb-player-btn"
          aria-label={SKIP.back.ambient}
          title={SKIP.back.ambient}
          onClick={() => stepAmbient(SKIP.back.step)}
        >
          <SkipGlyph back />
        </button>
      )}
      <button
        type="button"
        className="sb-player-btn"
        aria-label={prefs.playing ? "Pause music" : "Play music"}
        title={prefs.playing ? "Pause" : "Play"}
        onClick={() => setPrefs({ playing: !prefs.playing })}
      >
        {prefs.playing ? <PauseGlyph /> : <PlayGlyph />}
      </button>
      {!stream && (
        <button
          type="button"
          className="sb-player-btn"
          aria-label={SKIP.ahead.ambient}
          title={SKIP.ahead.ambient}
          onClick={() => stepAmbient(SKIP.ahead.step)}
        >
          <SkipGlyph />
        </button>
      )}
      <AmbientVolume prefs={prefs} setPrefs={setPrefs} className="setup-player-volume" />
    </section>
  );
}
