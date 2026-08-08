// Safe-default locks on the settings parse. The load-bearing one: the organizer
// daemon's trust rung must fall back to "suggest" (applies nothing) on any
// unknown/corrupt value — a bad parse must never GRANT auto-apply.

import { describe, expect, test } from "bun:test";

import type { Tab } from "../types";
import {
  createPersistDrain,
  parseHybridPresets,
  parseSettings,
  pruneMap,
  unknownAppSettingsKeys,
  unknownSettingsKeys,
  validTab,
} from "./persist";

describe("userName", () => {
  test("defaults to empty and survives a round-trip", () => {
    expect(parseSettings("{}").userName).toBe("");
    expect(parseSettings('{"userName":"Seth"}').userName).toBe("Seth");
  });

  test("falls back to empty on a non-string value", () => {
    expect(parseSettings('{"userName":42}').userName).toBe("");
    expect(parseSettings('{"userName":null}').userName).toBe("");
  });
});

describe("raw Markdown syntax palette", () => {
  test("defaults to Rotli, preserves Mono, and rejects unknown palettes", () => {
    expect(parseSettings("{}").syntaxPalette).toBe("rotli");
    expect(parseSettings('{"syntaxPalette":"mono"}').syntaxPalette).toBe("mono");
    expect(parseSettings('{"syntaxPalette":"neon"}').syntaxPalette).toBe("rotli");
  });
});

describe("sidebarView (the Home/Chat front, 2026-08-01)", () => {
  test("defaults a missing key to Home", () => {
    expect(parseSettings("{}").sidebarView).toBe("home");
  });

  test("round-trips Chat and rejects an unknown front", () => {
    expect(parseSettings('{"sidebarView":"chat"}').sidebarView).toBe("chat");
    expect(parseSettings('{"sidebarView":"dashboard"}').sidebarView).toBe("home");
    expect(parseSettings('{"sidebarView":7}').sidebarView).toBe("home");
  });

  test("a retired chatSidebarLimit rides the unknown-key passthrough", () => {
    // the 5/10/15 cap is gone with the Chat accordion (the front shows every
    // chat) — but a downgrade must still find the user's value (#35)
    expect(unknownSettingsKeys('{"chatSidebarLimit":10}').chatSidebarLimit).toBe(10);
  });

  test("a fresh config seeds the System zone OPEN", () => {
    // an empty expandedDests means "first run" — the System zone must arrive
    // unfolded, or Library/Assets/Archive/Trash would be hidden out of the box
    expect(parseSettings("{}").expandedDests["sec:system"]).toBe(true);
  });

  test("a stored System fold survives the parse untouched", () => {
    const raw = JSON.stringify({ expandedDests: { "sec:system": false, "sec:notes": false } });
    const dests = parseSettings(raw).expandedDests;
    expect(dests["sec:system"]).toBe(false);
    // the retired section key is preserved, not seeded over — a downgrade
    // (or the parked Inbox front's return) finds its state where it left it
    expect(dests["sec:notes"]).toBe(false);
  });
});

describe("parseSettings — Breve sidebar lens", () => {
  test("defaults to Notes and the Briefs view", () => {
    const s = parseSettings("{}");
    expect(s.sidebarMode).toBe("notes");
    expect(s.breveView).toBe("briefs");
  });

  test("keeps every valid Breve view", () => {
    for (const view of ["briefs", "routines", "watchlist", "settings"] as const) {
      const s = parseSettings(JSON.stringify({ sidebarMode: "breve", breveView: view }));
      expect(s.sidebarMode).toBe("breve");
      expect(s.breveView).toBe(view);
    }
  });

  test("migrates the retired Models/Configure views into Settings", () => {
    for (const view of ["models", "configure"]) {
      const s = parseSettings(JSON.stringify({ sidebarMode: "breve", breveView: view }));
      expect(s.breveView).toBe("settings");
    }
  });

  test("coerces unknown values to the safe workspace defaults", () => {
    const s = parseSettings('{"sidebarMode":"mail","breveView":"accounts"}');
    expect(s.sidebarMode).toBe("notes");
    expect(s.breveView).toBe("briefs");
  });
});

describe("parseSettings — organizerTrust", () => {
  // Organize is the default rung (Seth, 2026-07-02): the daemon touches only
  // location + metadata (journaled, undoable), never a note's words.
  test("defaults a missing key to organize", () => {
    expect(parseSettings("{}").organizerTrust).toBe("organize");
  });

  test("keeps every known rung — an explicit choice always wins", () => {
    for (const t of ["off", "suggest", "tidy", "organize"] as const) {
      expect(parseSettings(JSON.stringify({ organizerTrust: t })).organizerTrust).toBe(t);
    }
  });

  test("coerces an unknown rung (hand-edit / future build) to the default", () => {
    expect(parseSettings('{"organizerTrust":"autopilot"}').organizerTrust).toBe("organize");
    expect(parseSettings('{"organizerTrust":42}').organizerTrust).toBe("organize");
  });

  test("survives corrupt json entirely", () => {
    expect(parseSettings("not json").organizerTrust).toBe("organize");
  });
});

describe("parseSettings — the Brain master switch (vault-vs-brain, 2026-07-26)", () => {
  test("a MISSING field means ON — every existing vault keeps today's behavior", () => {
    expect(parseSettings("{}").brainEnabled).toBe(true);
    expect(parseSettings("not json").brainEnabled).toBe(true);
  });

  test("an explicit raw-vault choice survives the round trip", () => {
    expect(parseSettings('{"brainEnabled":false}').brainEnabled).toBe(false);
    expect(parseSettings('{"brainEnabled":true}').brainEnabled).toBe(true);
  });

  test("a garbage value falls to the safe default (on = today)", () => {
    expect(parseSettings('{"brainEnabled":"nope"}').brainEnabled).toBe(true);
    expect(parseSettings('{"brainEnabled":0}').brainEnabled).toBe(true);
  });
});

describe("parseSettings — creation and Brain model", () => {
  test("new tabs default to Markdown and only accept known item kinds", () => {
    expect(parseSettings("{}").newTabDefault).toBe("markdown");
    expect(parseSettings('{"newTabDefault":"document"}').newTabDefault).toBe("document");
    expect(parseSettings('{"newTabDefault":"database"}').newTabDefault).toBe("markdown");
  });

  test("Gemini 3.5 is an explicit organizer choice; unknown values fail closed to local", () => {
    expect(parseSettings('{"organizerModel":"gemini35"}').organizerModel).toBe("gemini35");
    expect(parseSettings('{"organizerModel":"future"}').organizerModel).toBe("local");
  });

  test("quick-note and quick-capture vault choices are independent and optional", () => {
    expect(parseSettings("{}").quickVaultId).toBeNull();
    expect(parseSettings("{}").captureVaultId).toBeNull();
    const settings = parseSettings('{"quickVaultId":"quick","captureVaultId":"work"}');
    expect(settings.quickVaultId).toBe("quick");
    expect(settings.captureVaultId).toBe("work");
    expect(parseSettings('{"quickVaultId":7,"captureVaultId":false}').quickVaultId).toBeNull();
    expect(parseSettings('{"quickVaultId":7,"captureVaultId":false}').captureVaultId).toBeNull();
  });
});

describe("parseSettings — fileMetadata (Show file metadata)", () => {
  test("defaults a missing key to hide", () => {
    expect(parseSettings("{}").fileMetadata).toBe("hide");
  });

  test("keeps show when persisted", () => {
    expect(parseSettings('{"fileMetadata":"show"}').fileMetadata).toBe("show");
  });

  test("coerces an unknown value (hand-edit / future build) back to hide", () => {
    expect(parseSettings('{"fileMetadata":"always"}').fileMetadata).toBe("hide");
    expect(parseSettings('{"fileMetadata":true}').fileMetadata).toBe("hide");
  });
});

describe("parseSettings — chatWeb (#7: no session keys in the durable map)", () => {
  test("keeps real per-slug toggles, drops the legacy '' and unsaved: keys", () => {
    const raw = '{"chatWeb":{"":true,"unsaved:pane-1":true,"my-chat":true,"other":false}}';
    expect(parseSettings(raw).chatWeb).toEqual({ "my-chat": true, other: false });
  });

  test("drops non-boolean entries entirely", () => {
    expect(parseSettings('{"chatWeb":{"a":"yes","b":true}}').chatWeb).toEqual({ b: true });
  });
});

describe("parseSettings — the AI Models keys (Seth, 2026-07-02)", () => {
  test("defaults: every lane OFF, no presets, codex engine, note opens as tab", () => {
    const s = parseSettings("{}");
    expect(s.aiProviders).toEqual({ claude: false, codex: false, agy: false, gemini: false });
    expect(s.hybridPresets).toEqual([]);
    expect(s.imageEngine).toBe("codex");
    expect(s.chatNoteOpen).toBe("tab");
    expect(s.chatMeasure).toEqual({});
  });

  test("round-trips enabled lanes; unknown lanes and non-booleans are ignored", () => {
    const s = parseSettings('{"aiProviders":{"claude":true,"gemini":true,"evil":true,"codex":"yes"}}');
    expect(s.aiProviders).toEqual({ claude: true, codex: false, agy: false, gemini: true });
    expect("evil" in s.aiProviders).toBe(false);
  });

  test("chatMeasure keeps valid measures only and drops session keys", () => {
    const raw = '{"chatMeasure":{"my-chat":"wide","other":"huge","unsaved:p1":"narrow"}}';
    expect(parseSettings(raw).chatMeasure).toEqual({ "my-chat": "wide" });
  });

  test("imageEngine / chatNoteOpen fall to safe defaults on garbage", () => {
    expect(parseSettings('{"imageEngine":"dalle"}').imageEngine).toBe("codex");
    expect(parseSettings('{"imageEngine":"agy"}').imageEngine).toBe("agy");
    expect(parseSettings('{"chatNoteOpen":"window"}').chatNoteOpen).toBe("tab");
    expect(parseSettings('{"chatNoteOpen":"split"}').chatNoteOpen).toBe("split");
  });

  test("hotkeyPeek round-trips; anything unknown reads as badges, never off", () => {
    // an absent/typo'd value must not silently REMOVE a discoverability aid —
    // only an explicit "off" turns the hold-⌘ peek off (Seth, 2026-08-04)
    expect(parseSettings("{}").hotkeyPeek).toBe("badges");
    expect(parseSettings('{"hotkeyPeek":"nonsense"}').hotkeyPeek).toBe("badges");
    expect(parseSettings('{"hotkeyPeek":"panel"}').hotkeyPeek).toBe("panel");
    expect(parseSettings('{"hotkeyPeek":"off"}').hotkeyPeek).toBe("off");
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

  test("keeps a well-shaped preset byte-for-byte", () => {
    expect(parseHybridPresets([good])).toEqual([good]);
  });

  test("drops entries missing id/name/organizer or with no usable routes", () => {
    expect(parseHybridPresets([{ ...good, id: "" }])).toEqual([]);
    expect(parseHybridPresets([{ ...good, name: 42 }])).toEqual([]);
    expect(parseHybridPresets([{ ...good, organizer: undefined }])).toEqual([]);
    expect(parseHybridPresets([{ ...good, routes: [] }])).toEqual([]);
    expect(parseHybridPresets([{ ...good, routes: [{ when: "x", model: "" }] }])).toEqual([]);
  });

  test("scrubs bad routes + a non-string fallback, keeps the rest", () => {
    const messy = {
      ...good,
      routes: [{ when: "ok", model: "sonnet" }, { model: 3 }, "junk"],
      fallback: 7,
    };
    expect(parseHybridPresets([messy])).toEqual([
      { id: "p1", name: "My hybrid", organizer: "gemma-3", routes: [{ when: "ok", model: "sonnet" }] },
    ]);
  });

  test("non-arrays return []", () => {
    expect(parseHybridPresets("nope")).toEqual([]);
    expect(parseHybridPresets(undefined)).toEqual([]);
  });
});

describe("unknownSettingsKeys — the round-trip remainder (#35)", () => {
  test("returns keys this build has no field for, and only those", () => {
    const raw = '{"theme":"dark","organizerThreshold":0.9,"futureKnob":{"x":1}}';
    expect(unknownSettingsKeys(raw)).toEqual({ organizerThreshold: 0.9, futureKnob: { x: 1 } });
  });

  test("is empty for a fully-known or corrupt file", () => {
    expect(unknownSettingsKeys('{"theme":"dark"}')).toEqual({});
    expect(unknownSettingsKeys("not json")).toEqual({});
  });

  test("drops retired Glass keys instead of preserving them forever", () => {
    const raw = '{"theme":"dark","themeFamily":"mono","glassMode":true,"glassTint":"dusk","futureKnob":1}';
    expect(parseSettings(raw).theme).toBe("dark");
    expect(parseSettings(raw).themeFamily).toBe("mono");
    expect(unknownSettingsKeys(raw)).toEqual({ futureKnob: 1 });
  });
});

describe("unknownAppSettingsKeys — machine settings stay additive", () => {
  test("keeps future app-shell keys without duplicating known keys", () => {
    expect(unknownAppSettingsKeys('{"theme":"dark","futureShellMode":{"quiet":true}}')).toEqual({
      futureShellMode: { quiet: true },
    });
  });

  test("corrupt input has no passthrough payload", () => {
    expect(unknownAppSettingsKeys("not json")).toEqual({});
  });
});

describe("validTab — every surfaceKind survives a relaunch (#34)", () => {
  const alive = new Set(["note-1"]);
  const roundTrips = (tab: Tab) => {
    // what the pane store persisted must revalidate to itself
    expect(validTab(JSON.parse(JSON.stringify(tab)), alive)).toEqual(tab);
  };

  test("round-trips all five tab kinds", () => {
    roundTrips({ id: "t1", surfaceKind: "note", noteId: "note-1" });
    roundTrips({ id: "t2", surfaceKind: "canvas", boardId: "Inbox/b.excalidraw" });
    roundTrips({ id: "t3", surfaceKind: "chat", chatSlug: "my-chat" });
    roundTrips({ id: "t4", surfaceKind: "chat", chatSlug: null });
    roundTrips({ id: "t5", surfaceKind: "file", fileId: "storage/report.xlsx" });
    roundTrips({ id: "t6", surfaceKind: "activity" });
  });

  test("still drops the malformed ones", () => {
    expect(validTab({ id: "x", surfaceKind: "file", fileId: "" }, alive)).toBeNull();
    expect(validTab({ id: "x", surfaceKind: "note", noteId: "gone" }, alive)).toBeNull();
    expect(validTab({ id: "x", surfaceKind: "hologram" }, alive)).toBeNull();
    expect(validTab({ surfaceKind: "activity" }, alive)).toBeNull(); // no id
  });
});

describe("pruneMap — the persisted-map GC primitive (#78)", () => {
  test("drops entries whose key fails the predicate", () => {
    const live = new Set(["kept-chat"]);
    expect(
      pruneMap(
        { "kept-chat": true, "deleted-chat": false, "unsaved:p1": true },
        (k) => live.has(k) || k.startsWith("unsaved:"),
      ),
    ).toEqual({ "kept-chat": true, "unsaved:p1": true });
  });

  test("returns the SAME object when nothing was dropped (no pointless store write)", () => {
    const m = { a: true, b: false };
    expect(pruneMap(m, () => true)).toBe(m);
  });

  test("empty map stays itself", () => {
    const m: Record<string, boolean> = {};
    expect(pruneMap(m, () => false)).toBe(m);
  });
});

// Correctness #4 from the 2026-07-30 perf audit: the writer used to advance
// its high-water mark BEFORE the write landed, so one transient failure meant
// the payload was never retried — theme/keys/panes reverted at next launch.
describe("createPersistDrain — settings survive a transient write failure", () => {
  test("a failed write leaves the mark behind, so the next drain retries the payload", async () => {
    const landed: string[] = [];
    let fail = true;
    const drain = createPersistDrain(
      // oxlint-disable-next-line typescript/no-misused-promises -- tsgolint preview misreads comma-expression arrow bodies as a Promise in a boolean conditional
      (_key, payload) => (fail ? Promise.reject(new Error("io")) : (landed.push(payload), Promise.resolve())),
      { settings: () => "A", viewstate: () => "" },
      { settings: "init", viewstate: "" },
      () => {},
    );
    await drain(); // transient failure — nothing landed
    expect(landed).toEqual([]);
    fail = false;
    await drain(); // no store change since, but the payload MUST retry
    expect(landed).toEqual(["A"]);
  });

  test("a landed payload is not rewritten", async () => {
    let writes = 0;
    const drain = createPersistDrain(
      // oxlint-disable-next-line typescript/no-misused-promises -- tsgolint preview misreads comma-expression arrow bodies as a Promise in a boolean conditional
      () => (writes++, Promise.resolve()),
      { settings: () => "A", viewstate: () => "" },
      { settings: "init", viewstate: "" },
      () => {},
    );
    await drain();
    await drain();
    expect(writes).toBe(1);
  });

  test("onFailure fires so the saver can re-arm, and only settled keys advance", async () => {
    let failures = 0;
    const landed: string[] = [];
    const drain = createPersistDrain(
      // oxlint-disable typescript/no-misused-promises -- tsgolint preview misreads comma-expression arrow bodies as a Promise in a boolean conditional
      (key, payload) =>
        key === "viewstate" ? Promise.reject(new Error("io")) : (landed.push(payload), Promise.resolve()),
      // oxlint-enable typescript/no-misused-promises
      { settings: () => "S", viewstate: () => "V" },
      { settings: "init-s", viewstate: "init-v" },
      () => failures++,
    );
    await drain();
    expect(landed).toEqual(["S"]);
    expect(failures).toBe(1);
    await drain(); // settings already landed; only viewstate retries
    expect(landed).toEqual(["S"]);
    expect(failures).toBe(2);
  });
});
