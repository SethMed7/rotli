import { describe, expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import { CLAUDE_FM, DEFAULT_AMBIENT } from "../../lib/ambient";
import { AmbientSection, toggledAmbient } from "./ambientSettings";

/** The player hidden (the default shows it). */
const OFF = { ...DEFAULT_AMBIENT, enabled: false };

describe("Settings → Ambient audio", () => {
  test("turning it on starts the track that sounds like the theme, unless one was picked", () => {
    expect(toggledAmbient(OFF, "grove")).toEqual({
      enabled: true,
      playing: true,
      track: "canopy",
    });
    expect(toggledAmbient({ ...OFF, track: "dusk" }, "grove")).toEqual({
      enabled: true,
      playing: true,
      track: "dusk",
    });
    expect(
      toggledAmbient({ enabled: true, track: "dusk", playing: true, volume: 0.4, stations: [] }, "grove"),
    ).toEqual({
      enabled: false,
      playing: false,
    });
  });

  test("off, just the switch; on, the tracks to pick from", () => {
    const offMarkup = renderToStaticMarkup(<AmbientSection prefs={OFF} setPrefs={() => {}} family="warm" />);
    expect(offMarkup).toContain('role="switch" aria-checked="false"');
    expect(offMarkup).not.toContain("Lamplight");
    const onMarkup = renderToStaticMarkup(
      <AmbientSection
        prefs={{ enabled: true, track: "tide", playing: true, volume: 0.4, stations: [] }}
        setPrefs={() => {}}
        family="warm"
      />,
    );
    expect(onMarkup).toContain('aria-checked="true"');
    for (const title of ["Linen", "Graphite", "Tide", "Canopy", "Dusk", "Lamplight"])
      expect(onMarkup).toContain(title);
  });

  test("the studio track has a volume; off, or Claude FM (its own page's volume), has none", () => {
    const at = (prefs: typeof DEFAULT_AMBIENT) =>
      renderToStaticMarkup(<AmbientSection prefs={prefs} setPrefs={() => {}} family="warm" />);
    const studio = at({ enabled: true, track: "tide", playing: true, volume: 0.25, stations: [] });
    expect(studio).toContain('aria-label="Music volume"');
    expect(studio).toContain('value="25"');
    expect(at(OFF)).not.toContain("Music volume");
    expect(
      at({ enabled: true, track: CLAUDE_FM.id, playing: true, volume: 0.4, stations: [] }),
    ).not.toContain("Music volume");
  });
});
