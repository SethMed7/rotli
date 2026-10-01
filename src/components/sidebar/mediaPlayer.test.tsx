import { describe, expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import { playerView } from "../../lib/ambient";
import { LABELS, Player, SKIP } from "./mediaPlayer";

const on = { enabled: true, track: "tide", playing: true, volume: 0.4, stations: [] };
const render = (view: ReturnType<typeof playerView>, title: string) =>
  renderToStaticMarkup(
    <Player view={view} title={title} ambientTitle="Tide" ambientWanted onAmbientPlay={() => {}} />,
  );
const has = (markup: string, label: string) => markup.includes(`aria-label="${label}"`);

describe("the sidebar player", () => {
  test("with only ambient, it plays the track: skip, pause, stop, and no tab to open", () => {
    const markup = render(playerView(on, {}, null), "Ambient · Tide");
    expect(markup).toContain("Now playing");
    expect(markup).toContain("Ambient · Tide");
    for (const label of [SKIP.back.ambient, LABELS.pause, LABELS.stop, SKIP.ahead.ambient])
      expect(has(markup, label)).toBe(true);
    expect(has(markup, LABELS.open)).toBe(false);
    expect(markup).not.toContain("aria-pressed");
  });

  test("a tab playing: its controls, with ambient waiting as the toggle on the left", () => {
    const markup = render(playerView(on, { t1: "playing" }, "t1"), "Claude FM");
    expect(markup).toContain("Claude FM");
    for (const label of [SKIP.back.tab, LABELS.pause, LABELS.stop, SKIP.ahead.tab, LABELS.open])
      expect(has(markup, label)).toBe(true);
    expect(has(markup, "Play ambient Tide instead")).toBe(true);
    expect(markup).toContain('aria-pressed="false"');
  });

  test("the tab paused: Play for the tab, and ambient sounding again", () => {
    const markup = render(playerView(on, { t1: "paused" }, "t1"), "Claude FM");
    expect(has(markup, LABELS.play)).toBe(true);
    expect(markup).toContain('aria-pressed="true"');
  });
});
