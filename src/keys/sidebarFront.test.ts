// The sidebar-front hotkeys (Seth, 2026-08-04: "the ability to toggle through
// the home and chat with hotkeys"). ⌃1/⌃2 have always jumped directly; this
// covers the new ONE-key flip and proves all three stay in step with the
// sidebar state the switcher pill reads.

import { beforeEach, describe, expect, test } from "bun:test";

import { useUiStore } from "../state/ui";
import { registerDefaultActions } from "./actions";
import { currentChord, dispatch } from "./registry";

registerDefaultActions();

describe("sidebar front actions", () => {
  beforeEach(() => {
    useUiStore.setState({ sidebarView: "home", sidebarMode: "notes", contentView: "panes" });
  });

  test("the flip alternates Home ↔ Chat on every press", () => {
    dispatch("modules.toggleFront");
    expect(useUiStore.getState().sidebarView).toBe("chat");
    dispatch("modules.toggleFront");
    expect(useUiStore.getState().sidebarView).toBe("home");
  });

  test("flipping back to Home returns to the note panes", () => {
    useUiStore.setState({ sidebarView: "chat", contentView: "allChats" });
    dispatch("modules.toggleFront");
    expect(useUiStore.getState().sidebarView).toBe("home");
    expect(useUiStore.getState().contentView).toBe("panes");
  });

  test("the flip leaves Breve and returns to the notes world", () => {
    useUiStore.setState({ sidebarMode: "breve" });
    dispatch("modules.toggleFront");
    expect(useUiStore.getState().sidebarMode).toBe("notes");
  });

  test("the direct jumps still land on their own front", () => {
    dispatch("modules.chat");
    expect(useUiStore.getState().sidebarView).toBe("chat");
    dispatch("modules.notes");
    expect(useUiStore.getState().sidebarView).toBe("home");
  });

  test("all three are bound out of the box, on distinct chords", () => {
    const chords = ["modules.notes", "modules.chat", "modules.toggleFront"].map(currentChord);
    expect(chords.every((c) => typeof c === "string" && c.length > 0)).toBe(true);
    expect(new Set(chords).size).toBe(3);
  });

  test("front chords include the held Command key advertised by the live overlay", () => {
    expect(currentChord("modules.notes")).toBe("Meta+Ctrl+1");
    expect(currentChord("modules.chat")).toBe("Meta+Ctrl+2");
    expect(currentChord("chat.new")).toBe("Meta+Ctrl+Shift+2");
  });
});
