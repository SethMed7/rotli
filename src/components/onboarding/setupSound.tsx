// Setup's Sound step (the owner, 2026-09-28: "have the music part be part of
// the onboarding"): quiet, the studio track that matches the chosen theme, or
// Claude FM (Mac only: it plays in a private browser page). Picking one plays
// it at once, a click the Mac lets start sound, so the person hears the choice.

import { type AmbientPrefs, CLAUDE_FM, isStream, trackForFamily, trackTitle } from "../../lib/ambient";
import { PLATFORM } from "../../lib/featurePolicy";
import { useAmbient } from "../../state/ambient";
import { useUiStore } from "../../state/ui";
import { AmbientVolume } from "../settings/ambientSettings";
import { PauseGlyph, PlayGlyph } from "../sidebar/mediaPlayer";
import { type SetupOption, SetupChoiceGroup } from "./setupControls";

export type SetupSoundChoice = "off" | "studio" | "claude-fm";

export function setupSoundChoice(prefs: AmbientPrefs): SetupSoundChoice {
  if (!prefs.enabled) return "off";
  return isStream(prefs.track) ? "claude-fm" : "studio";
}

/** The studio track a pick lands on: the one already chosen, else the theme's. */
function studioTrack(prefs: AmbientPrefs, family: string): string {
  return prefs.enabled && !isStream(prefs.track) ? prefs.track : trackForFamily(family);
}

export function setupSoundChange(
  choice: SetupSoundChoice,
  prefs: AmbientPrefs,
  family: string,
): Partial<AmbientPrefs> {
  if (choice === "off") return { enabled: false, playing: false };
  const track = choice === "claude-fm" ? CLAUDE_FM.id : studioTrack(prefs, family);
  return { enabled: true, playing: true, track };
}

export function SetupSound() {
  const prefs = useAmbient((s) => s.prefs);
  const setPrefs = useAmbient((s) => s.setPrefs);
  const family = useUiStore((s) => s.themeFamily);
  const options: SetupOption<SetupSoundChoice>[] = [
    { value: "off", title: "Quiet", description: "No music. The player still shows when a tab plays." },
    {
      value: "studio",
      title: `Studio music · ${trackTitle(studioTrack(prefs, family))}`,
      description: "Soft music from the Rotli studio, matched to your theme. Plays offline.",
    },
  ];
  if (PLATFORM !== "web") {
    options.push({
      value: "claude-fm",
      title: "Claude FM",
      description: "Anthropic’s live lo-fi stream, played in a private page. Needs the internet.",
    });
  }
  return (
    <>
      <p className="setup-eyebrow">Set the mood</p>
      <h1 id="setup-title">Music while you write?</h1>
      <p className="setup-lede">
        It plays from the player above the sidebar’s footer, where you can pause it or pick another track. A
        video in a tab takes over, and the music comes back when it stops.
      </p>
      <SetupChoiceGroup
        label="Music"
        value={setupSoundChoice(prefs)}
        onChange={(choice) => setPrefs(setupSoundChange(choice, prefs, family))}
        options={options}
      />
      {/* a quiet pause and volume (the owner, 2026-09-30: "they might want it
          enabled but not listen to it now, or it's too high") */}
      {prefs.enabled && (
        <div className="setup-sound-controls" role="group" aria-label="Music playback">
          <button
            type="button"
            className="setup-sound-play"
            aria-label={prefs.playing ? "Pause music" : "Play music"}
            title={prefs.playing ? "Pause" : "Play"}
            onClick={() => setPrefs({ playing: !prefs.playing })}
          >
            {prefs.playing ? <PauseGlyph /> : <PlayGlyph />}
          </button>
          <AmbientVolume prefs={prefs} setPrefs={setPrefs} className="setup-sound-volume" />
          <small>
            {prefs.playing
              ? `Playing · ${trackTitle(prefs.track)}`
              : `Paused · ${trackTitle(prefs.track)} · stays on for later`}
          </small>
        </div>
      )}
      <p className="setup-arrow-note">
        <kbd>←</kbd>
        <kbd>→</kbd> moves and selects
      </p>
    </>
  );
}
