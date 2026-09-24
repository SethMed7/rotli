import { afterEach, describe, expect, test } from "bun:test";

import { useAaPanelRequest } from "../state/aaPanel";
import { usePanesStore } from "../state/panes";
import { useUiStore } from "../state/ui";
import { registerDefaultActions } from "./actions";
import { formatChord, normalizeChord } from "./chords";
import { QUICK_PANE_ID, focusedNoteIdNow, notesWorkspaceActive } from "./focusNow";
import { setQuickHandle } from "./handles";
import { TOGGLE_SECURE_ACTION } from "./noteProtectionActions";
import { QUICK_PICK_ROWS, quickPickChord } from "./quickNoteActions";
import { attachDispatcher, claimingAction, currentChord, dispatch } from "./registry";

registerDefaultActions();

const focusedPane = usePanesStore.getState().focusedPaneId;
let detach: (() => void) | null = null;
function on(surface: "main" | "quick") {
  detach?.();
  detach = attachDispatcher(surface);
}
afterEach(() => {
  detach?.();
  detach = null;
  attachDispatcher("main")(); // the attached surface is module state
  setQuickHandle(null);
  usePanesStore.setState({ focusedPaneId: focusedPane });
  useUiStore.setState({ quickActiveId: null, sidebarMode: "notes" });
});

describe("the Quick Note's own keys", () => {
  test("picker rows 1–9 take ⌘1–⌘9 and rows 10–18 take ⌘⇧1–⌘⇧9", () => {
    expect(QUICK_PICK_ROWS).toBe(18);
    expect(quickPickChord(0)).toBe("Meta+1");
    expect(quickPickChord(8)).toBe("Meta+9");
    expect(quickPickChord(9)).toBe("Meta+Shift+1");
    expect(quickPickChord(17)).toBe("Meta+Shift+9");
  });

  test("the number chords reach the picker in the Quick Note and never in main", () => {
    const opened: number[] = [];
    setQuickHandle({ newNote: () => {}, openSearch: () => {}, openRow: (row) => opened.push(row) });
    on("quick");
    expect(claimingAction(quickPickChord(1))?.id).toBe("quick.pick2");
    expect(claimingAction(normalizeChord("Meta+Shift+1"))?.id).toBe("quick.pick10");
    dispatch("quick.pick2");
    dispatch("quick.pick10");
    expect(opened).toEqual([1, 9]);
    on("main");
    expect(claimingAction(quickPickChord(1))?.id).toBe("tabs.jump2");
  });
});

describe("Archive", () => {
  test("gave ⌘⇧A up to the Aa panel and ships with no chord", () => {
    expect(currentChord("notes.archive")).toBeNull();
  });
});

describe("⌘⇧A opens Aa and ⌘⇧C opens the note's chat (2026-09-24)", () => {
  test("⌘⇧A is the Aa panel, in main and in the Quick Note", () => {
    const chord = currentChord("editor.typography") ?? "";
    expect(formatChord(chord)).toBe("⌘⇧A");
    expect(claimingAction(normalizeChord(chord))?.id).toBe("editor.typography");
    on("quick");
    expect(claimingAction(normalizeChord(chord))?.id).toBe("editor.typography");
  });

  test("⌘⇧C, the note's chat, is live in the Quick Note", () => {
    const chord = currentChord("note.chat") ?? "";
    expect(formatChord(chord)).toBe("⌘⇧C");
    on("quick");
    expect(claimingAction(normalizeChord(chord))?.id).toBe("note.chat");
  });

  test("⌘⇧A asks the focused pane's editor — the Quick Note's own — to toggle its panel", () => {
    usePanesStore.setState({ focusedPaneId: QUICK_PANE_ID });
    useUiStore.setState({ quickActiveId: "quick-note-1" });
    const before = useAaPanelRequest.getState().request?.nonce ?? 0;
    dispatch("editor.typography");
    expect(useAaPanelRequest.getState().request).toEqual({ paneId: QUICK_PANE_ID, nonce: before + 1 });
  });
});

describe("main's note chords in the Quick Note", () => {
  test("⌘⇧L is live in the Quick Note window", () => {
    on("quick");
    expect(claimingAction(normalizeChord("Meta+Shift+L"))?.id).toBe(TOGGLE_SECURE_ACTION);
  });

  test("the focused note there is the note the Quick Note has open, even with Breve up in main", () => {
    usePanesStore.setState({ focusedPaneId: QUICK_PANE_ID });
    useUiStore.setState({ quickActiveId: "quick-note-1", sidebarMode: "breve" });
    expect(focusedNoteIdNow()).toBe("quick-note-1");
    expect(notesWorkspaceActive()).toBe(true);
  });

  test("main still reads its focused pane and stands down under Breve", () => {
    useUiStore.setState({ quickActiveId: "quick-note-1", sidebarMode: "breve" });
    expect(focusedNoteIdNow()).not.toBe("quick-note-1");
    expect(notesWorkspaceActive()).toBe(false);
  });
});
