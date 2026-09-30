// Setup's Sound step (the owner, 2026-09-28: "have the music part be part of
// the onboarding"): quiet, the studio track that matches the chosen theme, or
// Claude FM (Mac only: it plays in a private browser page). Picking one plays
// it at once, a click the Mac lets start sound, so the person hears the choice.

import { useEffect } from "react";

import { type AmbientPrefs, CLAUDE_FM, isStream, trackForFamily, trackTitle } from "../../lib/ambient";
import { PLATFORM } from "../../lib/featurePolicy";
import { useAmbient } from "../../state/ambient";
import { setAmbientPreview, useAmbientPreview } from "../../state/ambient";
import { useUiStore } from "../../state/ui";
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

/** Hear a choice before picking it: its own play button on the card. Only
 * previews sound during setup; the chosen music starts once setup is done. */
function PreviewButton({ track, title }: { track: string; title: string }) {
  const playing = useAmbientPreview((s) => s.track === track);
  return (
    <button
      type="button"
      className="setup-preview"
      aria-label={playing ? `Stop previewing ${title}` : `Preview ${title}`}
      aria-pressed={playing}
      title={playing ? "Stop" : "Preview"}
      onClick={() => setAmbientPreview(playing ? null : track)}
    >
      {playing ? <PauseGlyph /> : <PlayGlyph />}
    </button>
  );
}

export function SetupSound() {
  const prefs = useAmbient((s) => s.prefs);
  const setPrefs = useAmbient((s) => s.setPrefs);
  const family = useUiStore((s) => s.themeFamily);
  // a preview stops when the step does
  useEffect(() => () => setAmbientPreview(null), []);
  const studio = studioTrack(prefs, family);
  const options: SetupOption<SetupSoundChoice>[] = [
    { value: "off", title: "Quiet", description: "No music. The player still shows when a tab plays." },
    {
      value: "studio",
      title: `Studio music · ${trackTitle(studio)}`,
      description: "Soft music from the Rotli studio, matched to your theme. Plays offline.",
      action: <PreviewButton track={studio} title={trackTitle(studio)} />,
    },
  ];
  if (PLATFORM !== "web") {
    options.push({
      value: "claude-fm",
      title: "Claude FM",
      description: "Anthropic’s live lo-fi stream, played in a private page. Needs the internet.",
      action: <PreviewButton track={CLAUDE_FM.id} title="Claude FM" />,
    });
  }
  return (
    <>
      <h1 id="setup-title">Music while you write?</h1>
      <p className="setup-lede">
        Press play on a choice to hear it. What you pick starts once setup is done, from the player above the
        sidebar’s footer, where you can pause it or pick another track.
      </p>
      <SetupChoiceGroup
        label="Music"
        value={setupSoundChoice(prefs)}
        onChange={(choice) => setPrefs(setupSoundChange(choice, prefs, family))}
        options={options}
      />
      <p className="setup-arrow-note">
        <kbd>←</kbd>
        <kbd>→</kbd> moves and selects
      </p>
    </>
  );
}
