// Settings → General → Ambient audio (the owner, 2026-09-28): the studio's
// ambient tracks, always there in the sidebar player when this is on. A tab
// playing a video (or any sound) takes over, and ambient comes back when it
// stops (src/lib/ambient.ts).

import { AMBIENT_TRACKS, type AmbientPrefs, DEFAULT_AMBIENT, trackForFamily } from "../../lib/ambient";
import { useAmbient } from "../../state/ambient";
import { useUiStore } from "../../state/ui";
import { Seg } from "./seg";
import { Toggle } from "./toggle";

/** The switch's change: turning it on starts it (a click, so the Mac lets it
 * play) on the track that sounds like the current theme, unless one was
 * already picked; off stops it. */
export function toggledAmbient(prefs: AmbientPrefs, family: string): Partial<AmbientPrefs> {
  if (prefs.enabled) return { enabled: false, playing: false };
  const track = prefs.track === DEFAULT_AMBIENT.track ? trackForFamily(family) : prefs.track;
  return { enabled: true, playing: true, track };
}

export function AmbientSettings() {
  const prefs = useAmbient((s) => s.prefs);
  const setPrefs = useAmbient((s) => s.setPrefs);
  const family = useUiStore((s) => s.themeFamily);
  return <AmbientSection prefs={prefs} setPrefs={setPrefs} family={family} />;
}

/** The section for one preference (tests render it directly). */
export function AmbientSection({
  prefs,
  setPrefs,
  family,
}: {
  prefs: AmbientPrefs;
  setPrefs: (change: Partial<AmbientPrefs>) => void;
  family: string;
}) {
  const toggle = () => setPrefs(toggledAmbient(prefs, family));
  return (
    <>
      <h4 className="sethead">Ambient audio</h4>
      <div className="swgroup">
        <Toggle
          on={prefs.enabled}
          title="Ambient audio"
          desc="Quiet music from the Rotli studio, played from the player above the sidebar's footer. A video or anything else playing in a tab takes over, and the music comes back when it stops. Off: the player shows only while a tab is playing."
          onChange={toggle}
        />
      </div>
      {prefs.enabled && (
        <Seg<string>
          value={prefs.track}
          options={AMBIENT_TRACKS.map((track) => [track.id, track.title])}
          onPick={(track) => setPrefs({ track })}
        />
      )}
    </>
  );
}
