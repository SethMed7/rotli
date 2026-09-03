// The main window's appearance broadcast: once on start, again on every
// store change that alters the payload, never twice for the same payload,
// and silent after unsubscribe (0.85 shipped this loop untested).
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { useBindingsStore } from "../keys/bindings";
import { startAppearanceBroadcast } from "./appearanceSync";
import { DEFAULT_NOTE_STYLE, useNoteStyleStore } from "./noteStyle";
import { appearanceBroadcast, applyAppearanceBroadcast } from "./persist";
import { useUiStore } from "./ui";

const ui = useUiStore.getState();
const bindings = useBindingsStore.getState();

beforeEach(() => {
  useUiStore.setState({ theme: "light", themeFamily: "warm", accentColor: ui.accentColor });
  useBindingsStore.setState({ overrides: {} });
  useNoteStyleStore.setState({ styles: {} });
});
afterEach(() => {
  useUiStore.setState({ theme: ui.theme, themeFamily: ui.themeFamily, accentColor: ui.accentColor });
  useBindingsStore.setState({ overrides: bindings.overrides });
});

describe("startAppearanceBroadcast", () => {
  test("emits once on start and once per payload-changing store write", () => {
    const themes: string[] = [];
    const stop = startAppearanceBroadcast((payload) => themes.push(JSON.parse(payload.app).theme));
    expect(themes).toEqual(["light"]);

    useUiStore.setState({ theme: "dark" });
    useBindingsStore.setState({ overrides: { "quick.search": "Meta+Shift+P" } });
    useNoteStyleStore.setState({ styles: { n1: { ...useNoteStyleStore.getState().styles.n1!, size: 19 } } });
    expect(themes).toEqual(["light", "dark", "dark", "dark"]);
    stop();
  });

  test("a store write that leaves the payload unchanged does not re-emit", () => {
    let emits = 0;
    const stop = startAppearanceBroadcast(() => emits++);
    expect(emits).toBe(1);
    useUiStore.setState({ theme: "light" }); // same value
    useUiStore.setState({ sidebarWidth: 999 } as never); // not part of the payload
    expect(emits).toBe(1);
    stop();
  });

  test("after unsubscribe no store write reaches the emitter", () => {
    let emits = 0;
    const stop = startAppearanceBroadcast(() => emits++);
    stop();
    useUiStore.setState({ theme: "dark" });
    useBindingsStore.setState({ overrides: { "quick.search": "Meta+Shift+P" } });
    expect(emits).toBe(1);
  });
});

describe("appearance broadcast (main → quick/capture webviews)", () => {
  test("every app setting and the per-note typography round-trip through the payload", () => {
    const ui = useUiStore.getState();
    useUiStore.setState({
      theme: "dark",
      themeFamily: "ocean",
      syntaxPalette: "mono",
      hotkeyPeek: "off",
      accentColor: "green",
      accentHue: 141,
      quokkaLineColor: "black",
      quokkaAccessoryHue: 77,
      quokkaIdlePose: "thoughtful",
      timeFormat: "24",
    });
    useBindingsStore.setState({ overrides: { "quick.search": "Meta+Shift+P" } });
    useNoteStyleStore.setState({ styles: { n1: { ...DEFAULT_NOTE_STYLE, size: 19 } } });
    const payload = appearanceBroadcast();

    // a stale receiver
    useUiStore.setState({
      theme: "light",
      themeFamily: "warm",
      syntaxPalette: ui.syntaxPalette,
      hotkeyPeek: "badges",
      accentColor: ui.accentColor,
      accentHue: ui.accentHue,
      quokkaLineColor: "auto",
      quokkaAccessoryHue: ui.quokkaAccessoryHue,
      quokkaIdlePose: ui.quokkaIdlePose,
      timeFormat: ui.timeFormat,
    });
    useBindingsStore.setState({ overrides: {} });
    useNoteStyleStore.setState({ styles: {} });

    applyAppearanceBroadcast(payload);
    const after = useUiStore.getState();
    expect(after.theme).toBe("dark");
    expect(after.themeFamily).toBe("ocean");
    expect(after.syntaxPalette).toBe("mono");
    expect(after.hotkeyPeek).toBe("off");
    // the 0.85 regression: accent, quokka, and time format were missing from
    // the payload, so the quick window drifted after a Settings change
    expect(after.accentColor).toBe("green");
    expect(after.accentHue).toBe(141);
    expect(after.quokkaLineColor).toBe("black");
    expect(after.quokkaAccessoryHue).toBe(77);
    expect(after.quokkaIdlePose).toBe("thoughtful");
    expect(after.timeFormat).toBe("24");
    expect(useBindingsStore.getState().overrides["quick.search"]).toBe("Meta+Shift+P");
    expect(useNoteStyleStore.getState().styles.n1?.size).toBe(19);
  });
});
