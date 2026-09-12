// Sidebar expansion-state locks (the maintainer, 2026-07-27: "collapse all isn't
// working") — collapse-all folds the TREES (folders + default-open rows) but
// must never touch the "sec:" ZONE fold states: replacing the whole map wiped
// the persisted sec:* entries back to default-open, so pressing collapse-all
// silently RE-EXPANDED anything the user had folded. Stage 2 folds the SYSTEM
// zone, which replaced the old Chat/Notes sections when the fronts landed
// (2026-08-01, docs/design/sidebar-home-chat.md).

import { beforeEach, describe, expect, test } from "bun:test";

import { QUOKKA_STYLES } from "../brand/quokka";
import {
  CHAT_NAVIGATOR_STYLES,
  resetUiForVaultSwitch,
  SEC_SYSTEM,
  SOLID_THEMES,
  THEME_FAMILY_PRESENTATIONS,
  useUiStore,
} from "./ui";

describe("theme presentation", () => {
  test("organizes every environment as a complete light and dark family", () => {
    // the default family leads the picker so key 1 is the first-run choice
    expect(THEME_FAMILY_PRESENTATIONS.map((theme) => theme.label)).toEqual([
      "Rotli",
      "Paper & Charcoal",
      "Ocean",
      "Grove",
      "Iris",
      "Midnight",
    ]);
    expect(
      new Set(THEME_FAMILY_PRESENTATIONS.flatMap(({ family }) => [`${family}:light`, `${family}:dark`])),
    ).toEqual(new Set(SOLID_THEMES.map(({ family, mode }) => `${family}:${mode}`)));
  });

  test("offers only canonical companion and long-chat navigator treatments", () => {
    expect(QUOKKA_STYLES).toEqual(["line", "cocoa", "green", "ocean", "iris", "berry", "amber", "custom"]);
    expect(CHAT_NAVIGATOR_STYLES).toEqual(["lines", "dots", "paws", "ears"]);
  });
});

describe("collapseAllDests", () => {
  beforeEach(() => {
    useUiStore.setState({
      expandedDests: {
        [SEC_SYSTEM]: true, // the System zone, open
        "sec:notes": false, // a RETIRED zone key the user had folded
        Inbox: true, // a default-closed dest the user opened
        "main:Review": true, // a default-OPEN Main folder
      },
    });
  });

  test("closes default-open folders explicitly and default-closed rows by omission", () => {
    useUiStore.getState().collapseAllDests(["main:Review"]);
    const d = useUiStore.getState().expandedDests;
    expect(d["main:Review"]).toBe(false); // default-open needs an explicit false
    expect(d.Inbox).toBeUndefined(); // default-closed falls back to closed
  });

  test("never re-expands a zone the user folded", () => {
    useUiStore.getState().collapseAllDests(["main:Review"]);
    const d = useUiStore.getState().expandedDests;
    expect(d["sec:notes"]).toBe(false); // stays folded — collapse-all must not open things
    expect(d[SEC_SYSTEM]).toBe(true); // an open zone stays exactly as the user left it
  });

  // Two-stage collapse (the maintainer, 2026-07-31): folders first, the System zone second.
  test("stage 1 folds trees only; stage 2 folds the System zone", () => {
    const ids = ["main:Review", "chatfolder:abc"];
    useUiStore.getState().collapseAllDests(ids);
    let d = useUiStore.getState().expandedDests;
    expect(d["main:Review"]).toBe(false);
    expect(d["chatfolder:abc"]).toBe(false); // chat folders fold too (missed pre-07-31)
    expect(d[SEC_SYSTEM]).toBe(true); // zones untouched on stage 1

    useUiStore.getState().collapseAllDests(ids);
    d = useUiStore.getState().expandedDests;
    expect(d[SEC_SYSTEM]).toBe(false); // stage 2: the System zone itself folds
  });

  test("an explicitly-open dest row keeps the press on stage 1", () => {
    // Inbox:true is the only thing open — the press must fold it, not the zone
    useUiStore.setState({ expandedDests: { [SEC_SYSTEM]: true, Inbox: true, "main:Review": false } });
    useUiStore.getState().collapseAllDests(["main:Review"]);
    const d = useUiStore.getState().expandedDests;
    expect(d.Inbox).toBeUndefined(); // folded by omission
    expect(d[SEC_SYSTEM]).toBe(true); // the zone survives stage 1
  });
});

describe("sidebarView — the Home/Chat fronts (2026-08-01)", () => {
  beforeEach(() => {
    useUiStore.setState({ sidebarView: "chat" });
  });

  test("an explicit reveal always lands the sidebar on Home", () => {
    // a reveal points at NOTE content; revealing into Chat would be a silent
    // no-op, so the store action moves the front as part of the same set
    useUiStore.getState().revealFocusedNote("brain", "note-1");
    expect(useUiStore.getState().sidebarView).toBe("home");
    expect(useUiStore.getState().revealNoteId).toBe("note-1");
    expect(useUiStore.getState().revealMode).toBe("brain");
  });

  test("setSidebarView is the plain switch", () => {
    useUiStore.getState().setSidebarView("home");
    expect(useUiStore.getState().sidebarView).toBe("home");
    useUiStore.getState().setSidebarView("chat");
    expect(useUiStore.getState().sidebarView).toBe("chat");
  });

  test("a vault switch always returns to the Home notes workspace", () => {
    useUiStore.setState({ sidebarMode: "breve", sidebarView: "chat", contentView: "allChats" });

    resetUiForVaultSwitch();

    const state = useUiStore.getState();
    expect(state.sidebarMode).toBe("notes");
    expect(state.sidebarView).toBe("home");
    expect(state.contentView).toBe("panes");
  });
});
