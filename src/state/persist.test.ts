// Safe-default locks on the settings parse. The load-bearing one: the organizer
// daemon's trust rung must fall back to "suggest" (applies nothing) on any
// unknown/corrupt value — a bad parse must never GRANT auto-apply.

import { describe, expect, it } from "bun:test";
import type { Tab } from "../types";
import { parseSettings, pruneMap, unknownSettingsKeys, validTab } from "./persist";

describe("parseSettings — organizerTrust", () => {
  it("defaults a missing key to suggest", () => {
    expect(parseSettings("{}").organizerTrust).toBe("suggest");
  });

  it("keeps every known rung", () => {
    for (const t of ["off", "suggest", "tidy", "organize"] as const) {
      expect(parseSettings(JSON.stringify({ organizerTrust: t })).organizerTrust).toBe(t);
    }
  });

  it("coerces an unknown rung (hand-edit / future build) back to suggest", () => {
    expect(parseSettings('{"organizerTrust":"autopilot"}').organizerTrust).toBe("suggest");
    expect(parseSettings('{"organizerTrust":42}').organizerTrust).toBe("suggest");
  });

  it("survives corrupt json entirely", () => {
    expect(parseSettings("not json").organizerTrust).toBe("suggest");
  });
});

describe("parseSettings — fileMetadata (Show file metadata)", () => {
  it("defaults a missing key to hide", () => {
    expect(parseSettings("{}").fileMetadata).toBe("hide");
  });

  it("keeps show when persisted", () => {
    expect(parseSettings('{"fileMetadata":"show"}').fileMetadata).toBe("show");
  });

  it("coerces an unknown value (hand-edit / future build) back to hide", () => {
    expect(parseSettings('{"fileMetadata":"always"}').fileMetadata).toBe("hide");
    expect(parseSettings('{"fileMetadata":true}').fileMetadata).toBe("hide");
  });
});

describe("parseSettings — chatWeb (#7: no session keys in the durable map)", () => {
  it("keeps real per-slug toggles, drops the legacy '' and unsaved: keys", () => {
    const raw = '{"chatWeb":{"":true,"unsaved:pane-1":true,"my-chat":true,"other":false}}';
    expect(parseSettings(raw).chatWeb).toEqual({ "my-chat": true, other: false });
  });

  it("drops non-boolean entries entirely", () => {
    expect(parseSettings('{"chatWeb":{"a":"yes","b":true}}').chatWeb).toEqual({ b: true });
  });
});

describe("unknownSettingsKeys — the round-trip remainder (#35)", () => {
  it("returns keys this build has no field for, and only those", () => {
    const raw = '{"theme":"dark","organizerThreshold":0.9,"futureKnob":{"x":1}}';
    expect(unknownSettingsKeys(raw)).toEqual({ organizerThreshold: 0.9, futureKnob: { x: 1 } });
  });

  it("is empty for a fully-known or corrupt file", () => {
    expect(unknownSettingsKeys('{"theme":"dark"}')).toEqual({});
    expect(unknownSettingsKeys("not json")).toEqual({});
  });
});

describe("validTab — every surfaceKind survives a relaunch (#34)", () => {
  const vs = { cursor: 0, scroll: 0 };
  const alive = new Set(["note-1"]);
  const roundTrips = (tab: Tab) => {
    // what the pane store persisted must revalidate to itself
    expect(validTab(JSON.parse(JSON.stringify(tab)), alive)).toEqual(tab);
  };

  it("round-trips all five tab kinds", () => {
    roundTrips({ id: "t1", surfaceKind: "note", noteId: "note-1", viewState: vs });
    roundTrips({ id: "t2", surfaceKind: "canvas", boardId: "Inbox/b.excalidraw", viewState: vs });
    roundTrips({ id: "t3", surfaceKind: "chat", chatSlug: "my-chat", viewState: vs });
    roundTrips({ id: "t4", surfaceKind: "chat", chatSlug: null, viewState: vs });
    roundTrips({ id: "t5", surfaceKind: "file", fileId: "storage/report.xlsx", viewState: vs });
    roundTrips({ id: "t6", surfaceKind: "activity", viewState: vs });
  });

  it("still drops the malformed ones", () => {
    expect(validTab({ id: "x", surfaceKind: "file", fileId: "" }, alive)).toBeNull();
    expect(validTab({ id: "x", surfaceKind: "note", noteId: "gone" }, alive)).toBeNull();
    expect(validTab({ id: "x", surfaceKind: "hologram" }, alive)).toBeNull();
    expect(validTab({ surfaceKind: "activity" }, alive)).toBeNull(); // no id
  });
});

describe("pruneMap — the persisted-map GC primitive (#78)", () => {
  it("drops entries whose key fails the predicate", () => {
    const live = new Set(["kept-chat"]);
    expect(
      pruneMap({ "kept-chat": true, "deleted-chat": false, "unsaved:p1": true }, (k) =>
        live.has(k) || k.startsWith("unsaved:"),
      ),
    ).toEqual({ "kept-chat": true, "unsaved:p1": true });
  });

  it("returns the SAME object when nothing was dropped (no pointless store write)", () => {
    const m = { a: true, b: false };
    expect(pruneMap(m, () => true)).toBe(m);
  });

  it("empty map stays itself", () => {
    const m: Record<string, boolean> = {};
    expect(pruneMap(m, () => false)).toBe(m);
  });
});
