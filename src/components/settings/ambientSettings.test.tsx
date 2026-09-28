import { describe, expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import { DEFAULT_AMBIENT } from "../../lib/ambient";
import { AmbientSection, toggledAmbient } from "./ambientSettings";

describe("Settings → Ambient audio", () => {
  test("turning it on starts the track that sounds like the theme, unless one was picked", () => {
    expect(toggledAmbient(DEFAULT_AMBIENT, "grove")).toEqual({
      enabled: true,
      playing: true,
      track: "canopy",
    });
    expect(toggledAmbient({ ...DEFAULT_AMBIENT, track: "dusk" }, "grove")).toEqual({
      enabled: true,
      playing: true,
      track: "dusk",
    });
    expect(toggledAmbient({ enabled: true, track: "dusk", playing: true }, "grove")).toEqual({
      enabled: false,
      playing: false,
    });
  });

  test("off, just the switch; on, the tracks to pick from", () => {
    const offMarkup = renderToStaticMarkup(
      <AmbientSection prefs={DEFAULT_AMBIENT} setPrefs={() => {}} family="warm" />,
    );
    expect(offMarkup).toContain('role="switch" aria-checked="false"');
    expect(offMarkup).not.toContain("Lamplight");
    const onMarkup = renderToStaticMarkup(
      <AmbientSection
        prefs={{ enabled: true, track: "tide", playing: true }}
        setPrefs={() => {}}
        family="warm"
      />,
    );
    expect(onMarkup).toContain('aria-checked="true"');
    for (const title of ["Linen", "Graphite", "Tide", "Canopy", "Dusk", "Lamplight"])
      expect(onMarkup).toContain(title);
  });
});
