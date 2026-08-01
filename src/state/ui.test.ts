// Sidebar expansion-state locks (Seth, 2026-07-27: "collapse all isn't
// working") — collapse-all folds the TREES (folders + default-open rows) but
// must never touch the SECTION fold states: replacing the whole map wiped the
// persisted sec:* entries back to default-open, so pressing collapse-all
// silently RE-EXPANDED any section the user had folded.

import { beforeEach, describe, expect, test } from "bun:test";

import { SEC_CHAT, SEC_MAIN, useUiStore } from "./ui";

describe("collapseAllDests", () => {
  beforeEach(() => {
    useUiStore.setState({
      expandedDests: {
        [SEC_CHAT]: false, // the user folded Chat — their arrangement
        [SEC_MAIN]: true, // Main explicitly open
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

  test("never re-expands a section the user folded", () => {
    useUiStore.getState().collapseAllDests(["main:Review"]);
    const d = useUiStore.getState().expandedDests;
    expect(d[SEC_CHAT]).toBe(false); // stays folded — collapse-all must not open things
    expect(d[SEC_MAIN]).toBe(true); // an open section stays exactly as the user left it
  });

  // Two-stage collapse (Seth, 2026-07-31): folders first, sections second.
  test("stage 1 folds trees only; stage 2 folds the sections", () => {
    const ids = ["main:Review", "chatfolder:abc"];
    useUiStore.getState().collapseAllDests(ids);
    let d = useUiStore.getState().expandedDests;
    expect(d["main:Review"]).toBe(false);
    expect(d["chatfolder:abc"]).toBe(false); // chat folders fold too (missed pre-07-31)
    expect(d[SEC_MAIN]).toBe(true); // sections untouched on stage 1

    useUiStore.getState().collapseAllDests(ids);
    d = useUiStore.getState().expandedDests;
    expect(d["sec:notes"]).toBe(false); // stage 2: the sections themselves fold
    expect(d[SEC_CHAT]).toBe(false);
  });

  test("an explicitly-open dest row keeps the press on stage 1", () => {
    // Inbox:true is the only thing open — the press must fold it, not sections
    useUiStore.setState({ expandedDests: { "sec:notes": true, Inbox: true, "main:Review": false } });
    useUiStore.getState().collapseAllDests(["main:Review"]);
    const d = useUiStore.getState().expandedDests;
    expect(d.Inbox).toBeUndefined(); // folded by omission
    expect(d["sec:notes"]).toBe(true); // section survives stage 1
  });
});
