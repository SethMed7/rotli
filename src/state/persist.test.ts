// Safe-default locks on the settings parse. The load-bearing one: the organizer
// daemon's trust rung must fall back to "suggest" (applies nothing) on any
// unknown/corrupt value — a bad parse must never GRANT auto-apply.

import { describe, expect, it } from "bun:test";
import type { Tab } from "../types";
import { parseHybridPresets, parseSettings, pruneMap, unknownSettingsKeys, validTab } from "./persist";
import { clampChatSidebarLimit } from "./ui";

describe("userName", () => {
  it("defaults to empty and survives a round-trip", () => {
    expect(parseSettings("{}").userName).toBe("");
    expect(parseSettings('{"userName":"Seth"}').userName).toBe("Seth");
  });

  it("falls back to empty on a non-string value", () => {
    expect(parseSettings('{"userName":42}').userName).toBe("");
    expect(parseSettings('{"userName":null}').userName).toBe("");
  });
});

describe("chatSidebarLimit (#17 — chat list cap)", () => {
  it("defaults a missing key to 5", () => {
    expect(parseSettings("{}").chatSidebarLimit).toBe(5);
  });

  it("keeps every allowed cap (5/10/15)", () => {
    for (const n of [5, 10, 15]) {
      expect(parseSettings(JSON.stringify({ chatSidebarLimit: n })).chatSidebarLimit).toBe(n);
    }
  });

  it("coerces an out-of-set value (hand-edit / future build) to the default", () => {
    expect(parseSettings('{"chatSidebarLimit":12}').chatSidebarLimit).toBe(5);
    expect(parseSettings('{"chatSidebarLimit":0}').chatSidebarLimit).toBe(5);
    expect(parseSettings('{"chatSidebarLimit":"10"}').chatSidebarLimit).toBe(5);
  });

  it("clampChatSidebarLimit is pure + safe on junk", () => {
    expect(clampChatSidebarLimit(10)).toBe(10);
    expect(clampChatSidebarLimit(7)).toBe(5);
    expect(clampChatSidebarLimit(undefined)).toBe(5);
    expect(clampChatSidebarLimit(null)).toBe(5);
    expect(clampChatSidebarLimit("15")).toBe(5);
  });
});

describe("parseSettings — Breve sidebar lens", () => {
  it("defaults to Notes and the Briefs view", () => {
    const s = parseSettings("{}");
    expect(s.sidebarMode).toBe("notes");
    expect(s.breveView).toBe("briefs");
  });

  it("keeps every valid Breve view", () => {
    for (const view of ["briefs", "watchlist", "routines", "models", "configure"] as const) {
      const s = parseSettings(JSON.stringify({ sidebarMode: "breve", breveView: view }));
      expect(s.sidebarMode).toBe("breve");
      expect(s.breveView).toBe(view);
    }
  });

  it("coerces unknown values to the safe workspace defaults", () => {
    const s = parseSettings('{"sidebarMode":"mail","breveView":"accounts"}');
    expect(s.sidebarMode).toBe("notes");
    expect(s.breveView).toBe("briefs");
  });
});

describe("parseSettings — organizerTrust", () => {
  // Organize is the default rung (Seth, 2026-07-02): the daemon touches only
  // location + metadata (journaled, undoable), never a note's words.
  it("defaults a missing key to organize", () => {
    expect(parseSettings("{}").organizerTrust).toBe("organize");
  });

  it("keeps every known rung — an explicit choice always wins", () => {
    for (const t of ["off", "suggest", "tidy", "organize"] as const) {
      expect(parseSettings(JSON.stringify({ organizerTrust: t })).organizerTrust).toBe(t);
    }
  });

  it("coerces an unknown rung (hand-edit / future build) to the default", () => {
    expect(parseSettings('{"organizerTrust":"autopilot"}').organizerTrust).toBe("organize");
    expect(parseSettings('{"organizerTrust":42}').organizerTrust).toBe("organize");
  });

  it("survives corrupt json entirely", () => {
    expect(parseSettings("not json").organizerTrust).toBe("organize");
  });
});

describe("parseSettings — creation and Brain model", () => {
  it("new tabs default to Markdown and only accept known item kinds", () => {
    expect(parseSettings("{}").newTabDefault).toBe("markdown");
    expect(parseSettings('{"newTabDefault":"document"}').newTabDefault).toBe("document");
    expect(parseSettings('{"newTabDefault":"database"}').newTabDefault).toBe("markdown");
  });

  it("Gemini 3.5 is an explicit organizer choice; unknown values fail closed to local", () => {
    expect(parseSettings('{"organizerModel":"gemini35"}').organizerModel).toBe("gemini35");
    expect(parseSettings('{"organizerModel":"future"}').organizerModel).toBe("local");
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

describe("parseSettings — the AI Models keys (Seth, 2026-07-02)", () => {
  it("defaults: every lane OFF, no presets, codex engine, note opens as tab", () => {
    const s = parseSettings("{}");
    expect(s.aiProviders).toEqual({ claude: false, codex: false, agy: false, gemini: false });
    expect(s.hybridPresets).toEqual([]);
    expect(s.imageEngine).toBe("codex");
    expect(s.chatNoteOpen).toBe("tab");
    expect(s.chatMeasure).toEqual({});
  });

  it("round-trips enabled lanes; unknown lanes and non-booleans are ignored", () => {
    const s = parseSettings('{"aiProviders":{"claude":true,"gemini":true,"evil":true,"codex":"yes"}}');
    expect(s.aiProviders).toEqual({ claude: true, codex: false, agy: false, gemini: true });
    expect("evil" in s.aiProviders).toBe(false);
  });

  it("chatMeasure keeps valid measures only and drops session keys", () => {
    const raw = '{"chatMeasure":{"my-chat":"wide","other":"huge","unsaved:p1":"narrow"}}';
    expect(parseSettings(raw).chatMeasure).toEqual({ "my-chat": "wide" });
  });

  it("imageEngine / chatNoteOpen fall to safe defaults on garbage", () => {
    expect(parseSettings('{"imageEngine":"dalle"}').imageEngine).toBe("codex");
    expect(parseSettings('{"imageEngine":"agy"}').imageEngine).toBe("agy");
    expect(parseSettings('{"chatNoteOpen":"window"}').chatNoteOpen).toBe("tab");
    expect(parseSettings('{"chatNoteOpen":"split"}').chatNoteOpen).toBe("split");
  });
});

describe("parseHybridPresets — shape-validated, invalid entries dropped", () => {
  const good = {
    id: "p1",
    name: "My hybrid",
    organizer: "gemma-3",
    routes: [{ when: "quick", model: "sonnet" }],
    fallback: "gpt-5.5",
  };

  it("keeps a well-shaped preset byte-for-byte", () => {
    expect(parseHybridPresets([good])).toEqual([good]);
  });

  it("drops entries missing id/name/organizer or with no usable routes", () => {
    expect(parseHybridPresets([{ ...good, id: "" }])).toEqual([]);
    expect(parseHybridPresets([{ ...good, name: 42 }])).toEqual([]);
    expect(parseHybridPresets([{ ...good, organizer: undefined }])).toEqual([]);
    expect(parseHybridPresets([{ ...good, routes: [] }])).toEqual([]);
    expect(parseHybridPresets([{ ...good, routes: [{ when: "x", model: "" }] }])).toEqual([]);
  });

  it("scrubs bad routes + a non-string fallback, keeps the rest", () => {
    const messy = {
      ...good,
      routes: [{ when: "ok", model: "sonnet" }, { model: 3 }, "junk"],
      fallback: 7,
    };
    expect(parseHybridPresets([messy])).toEqual([
      { id: "p1", name: "My hybrid", organizer: "gemma-3", routes: [{ when: "ok", model: "sonnet" }] },
    ]);
  });

  it("non-arrays return []", () => {
    expect(parseHybridPresets("nope")).toEqual([]);
    expect(parseHybridPresets(undefined)).toEqual([]);
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

  it("drops retired Glass keys instead of preserving them forever", () => {
    const raw = '{"theme":"dark","themeFamily":"mono","glassMode":true,"glassTint":"dusk","futureKnob":1}';
    expect(parseSettings(raw).theme).toBe("dark");
    expect(parseSettings(raw).themeFamily).toBe("mono");
    expect(unknownSettingsKeys(raw)).toEqual({ futureKnob: 1 });
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
