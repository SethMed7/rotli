// Safe-default locks on the settings parse. The load-bearing one: the organizer
// daemon's trust rung must fall back to "suggest" (applies nothing) on any
// unknown/corrupt value — a bad parse must never GRANT auto-apply.

import { describe, expect, test } from "bun:test";

import { DEFAULT_QUOKKA_ACCESSORY_HUE, DEFAULT_QUOKKA_CUSTOM_HUE } from "../brand/quokka";
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
    expect(parseSettings('{"userName":"the maintainer"}').userName).toBe("the maintainer");
  });

  test("falls back to empty on a non-string value", () => {
    expect(parseSettings('{"userName":42}').userName).toBe("");
    expect(parseSettings('{"userName":null}').userName).toBe("");
  });
});

describe("pane vault mode", () => {
  test("normalizes old multi-vault settings to one active vault", () => {
    expect(parseSettings("{}").paneVaultMode).toBe("single");
    expect(parseSettings('{"paneVaultMode":"single"}').paneVaultMode).toBe("single");
    expect(parseSettings('{"paneVaultMode":"multiple"}').paneVaultMode).toBe("single");
    expect(parseSettings('{"paneVaultMode":"window"}').paneVaultMode).toBe("single");
  });
});

describe("onboarding checkpoint", () => {
  test("survives a vault-selection relaunch and rejects unknown phases", () => {
    expect(parseSettings("{}").onboardingPhase).toBe("preferences");
    expect(parseSettings('{"onboardingPhase":"vault"}').onboardingPhase).toBe("vault");
    expect(parseSettings('{"onboardingPhase":"models"}').onboardingPhase).toBe("models");
    expect(parseSettings('{"onboardingPhase":"workspace"}').onboardingPhase).toBe("preferences");
  });
});

describe("automatic housekeeping settings", () => {
  test("both policies default off and preserve valid day counts", () => {
    const defaults = parseSettings("{}");
    expect(defaults.mainAutoRemoveDays).toBeNull();
    expect(defaults.chatAutoArchiveDays).toBeNull();

    const enabled = parseSettings('{"mainAutoRemoveDays":45,"chatAutoArchiveDays":90}');
    expect(enabled.mainAutoRemoveDays).toBe(45);
    expect(enabled.chatAutoArchiveDays).toBe(90);
  });

  test("invalid values fail closed instead of enabling cleanup", () => {
    const parsed = parseSettings('{"mainAutoRemoveDays":0,"chatAutoArchiveDays":"30"}');
    expect(parsed.mainAutoRemoveDays).toBeNull();
    expect(parsed.chatAutoArchiveDays).toBeNull();
  });
});

describe("raw Markdown syntax palette", () => {
  test("defaults to Rotli, preserves Mono, and rejects unknown palettes", () => {
    expect(parseSettings("{}").syntaxPalette).toBe("rotli");
    expect(parseSettings('{"syntaxPalette":"mono"}').syntaxPalette).toBe("mono");
    expect(parseSettings('{"syntaxPalette":"neon"}').syntaxPalette).toBe("rotli");
  });
});

describe("custom primary color", () => {
  test("keeps a safe hue and falls back cleanly on invalid settings", () => {
    const custom = parseSettings('{"accentColor":"custom","accentHue":287}');
    expect(custom.accentColor).toBe("custom");
    expect(custom.accentHue).toBe(287);

    expect(parseSettings('{"accentHue":999}').accentHue).toBe(210);
    expect(parseSettings('{"accentHue":"blue"}').accentHue).toBe(210);
  });
});

describe("appearance personality", () => {
  test("defaults to an optional filled quokka and paw navigator", () => {
    const settings = parseSettings("{}");
    expect(settings.quokkaCompanionEnabled).toBe(false);
    expect(settings.quokkaStyle).toBe("cocoa");
    expect(settings.quokkaCustomHue).toBe(DEFAULT_QUOKKA_CUSTOM_HUE);
    expect(settings.quokkaLineColor).toBe("auto");
    expect(settings.quokkaAccessory).toBe("none");
    expect(settings.quokkaAccessoryHue).toBe(DEFAULT_QUOKKA_ACCESSORY_HUE);
    expect(settings.quokkaIdlePose).toBe("rest");
    expect(settings.chatNavigatorStyle).toBe("paws");
  });

  test("round-trips supported treatments and rejects unknown values", () => {
    const settings = parseSettings(
      JSON.stringify({
        quokkaCompanionEnabled: true,
        quokkaStyle: "custom",
        quokkaCustomHue: 287,
        quokkaLineColor: "white",
        quokkaAccessory: "bucket-hat",
        quokkaAccessoryHue: 128,
        quokkaIdlePose: "thoughtful",
        chatNavigatorStyle: "dots",
      }),
    );
    expect(settings.quokkaCompanionEnabled).toBe(true);
    expect(settings.quokkaStyle).toBe("custom");
    expect(settings.quokkaCustomHue).toBe(287);
    expect(settings.quokkaLineColor).toBe("white");
    expect(settings.quokkaAccessory).toBe("bucket-hat");
    expect(settings.quokkaAccessoryHue).toBe(128);
    expect(settings.quokkaIdlePose).toBe("thoughtful");
    expect(settings.chatNavigatorStyle).toBe("dots");
    expect(parseSettings('{"quokkaStyle":"redrawn","chatNavigatorStyle":"runes"}').quokkaStyle).toBe("cocoa");
    expect(
      parseSettings(JSON.stringify({ quokkaCustomColor: ["#", "4a90e2"].join("") })).quokkaCustomHue,
    ).toBe(212);
    expect(parseSettings('{"quokkaCustomColor":"night"}').quokkaCustomHue).toBe(DEFAULT_QUOKKA_CUSTOM_HUE);
    expect(parseSettings('{"quokkaAccessory":"crown"}').quokkaAccessory).toBe("none");
    expect(parseSettings('{"quokkaAccessory":"scarf"}').quokkaAccessory).toBe("none");
    expect(parseSettings('{"quokkaIdlePose":"dancing"}').quokkaIdlePose).toBe("rest");
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
    const raw = JSON.stringify({
      expandedDests: { "sec:system": false, "sec:notes": false },
    });
    const dests = parseSettings(raw).expandedDests;
    expect(dests["sec:system"]).toBe(false);
    // the retired section key is preserved, not seeded over — a downgrade
    // (or the parked Inbox front's return) finds its state where it left it
    expect(dests["sec:notes"]).toBe(false);
  });
});

describe("parseSettings — Breve sidebar lens", () => {
  test("defaults to Notes and the Breve dashboard", () => {
    const s = parseSettings("{}");
    expect(s.sidebarMode).toBe("notes");
    expect(s.breveView).toBe("dashboard");
  });

  test("keeps every valid Breve view", () => {
    for (const view of [
      "dashboard",
      "briefs",
      "notifications",
      "routines",
      "watchlist",
      "settings",
    ] as const) {
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
    expect(s.breveView).toBe("dashboard");
  });
});

describe("parseSettings — organizerTrust", () => {
  // Organize is the default rung (the maintainer, 2026-07-02): the daemon touches only
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

  test("tab layout defaults to scroll and only accepts the two visible modes", () => {
    expect(parseSettings("{}").tabLayout).toBe("scroll");
    expect(parseSettings('{"tabLayout":"fit"}').tabLayout).toBe("fit");
    expect(parseSettings('{"tabLayout":"compress"}').tabLayout).toBe("scroll");
  });

  test("the legacy Gemini setting remains an explicit organizer choice; unknown values fail closed to local", () => {
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
    expect(parseSettings(raw).chatWeb).toEqual({
      "my-chat": true,
      other: false,
    });
  });

  test("drops non-boolean entries entirely", () => {
    expect(parseSettings('{"chatWeb":{"a":"yes","b":true}}').chatWeb).toEqual({
      b: true,
    });
  });
});

describe("parseSettings — frontier controls", () => {
  test("keeps allowlisted values and drops attacker-shaped/session values", () => {
    const parsed = parseSettings(
      '{"chatReasoning":{"corpus:a":"xhigh","corpus:b":"ultra","unsaved:p":"high"},"chatServiceTier":{"corpus:a":"fast","corpus:b":"priority"}}',
    );
    expect(parsed.chatReasoning).toEqual({ "corpus:a": "xhigh", "corpus:b": "ultra" });
    expect(parsed.chatServiceTier).toEqual({ "corpus:a": "fast" });
  });
});

describe("parseSettings — the AI Models keys (the maintainer, 2026-07-02)", () => {
  test("defaults: every lane OFF, no presets, codex engine, note opens as tab", () => {
    const s = parseSettings("{}");
    expect(s.aiProviders).toEqual({
      claude: false,
      codex: false,
      agy: false,
      gemini: false,
    });
    expect(s.hybridPresets).toEqual([]);
    expect(s.imageEngine).toBe("codex");
    expect(s.chatNoteOpen).toBe("tab");
    expect(s.chatMeasure).toEqual({});
    expect(s.webSearchProvider).toBe("duckduckgo");
  });

  test("keeps the selected web-search provider and rejects unknown destinations", () => {
    expect(parseSettings('{"webSearchProvider":"brave"}').webSearchProvider).toBe("brave");
    expect(parseSettings('{"webSearchProvider":"google"}').webSearchProvider).toBe("duckduckgo");
    expect(parseSettings('{"webSearchProvider":42}').webSearchProvider).toBe("duckduckgo");
  });

  test("round-trips enabled lanes; unknown lanes and non-booleans are ignored", () => {
    const s = parseSettings('{"aiProviders":{"claude":true,"gemini":true,"evil":true,"codex":"yes"}}');
    expect(s.aiProviders).toEqual({
      claude: true,
      codex: false,
      agy: false,
      gemini: true,
    });
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

  test("chat presentation preferences round-trip and reject unknown values", () => {
    const defaults = parseSettings("{}");
    expect(defaults.chatWelcomeStyle).toBe("lively");
    expect(defaults.chatNaming).toBe("ask");
    expect(defaults.chatArtifactOpen).toBe("sidecar");

    const selected = parseSettings(
      '{"chatWelcomeStyle":"calm","chatNaming":"automatic","chatArtifactOpen":"tab"}',
    );
    expect(selected.chatWelcomeStyle).toBe("calm");
    expect(selected.chatNaming).toBe("automatic");
    expect(selected.chatArtifactOpen).toBe("tab");

    const invalid = parseSettings(
      '{"chatWelcomeStyle":"animated","chatNaming":"surprise-me","chatArtifactOpen":"window"}',
    );
    expect(invalid.chatWelcomeStyle).toBe("lively");
    expect(invalid.chatNaming).toBe("ask");
    expect(invalid.chatArtifactOpen).toBe("sidecar");
  });

  test("hotkeyPeek round-trips; anything unknown reads as badges, never off", () => {
    // an absent/typo'd value must not silently REMOVE a discoverability aid —
    // only an explicit "off" turns the hold-⌘ peek off (the maintainer, 2026-08-04)
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
      {
        id: "p1",
        name: "My hybrid",
        organizer: "gemma-3",
        routes: [{ when: "ok", model: "sonnet" }],
      },
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
    expect(unknownSettingsKeys(raw)).toEqual({
      organizerThreshold: 0.9,
      futureKnob: { x: 1 },
    });
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

  test("drops the retired virtual-welcome dismissal", () => {
    expect(unknownSettingsKeys('{"vaultWelcomeSeen":true,"futureSetting":7}')).toEqual({
      futureSetting: 7,
    });
  });

  test("retires independent System mappings without losing the selected family", () => {
    const raw = '{"theme":"system","themeFamily":"ocean","matchLightFamily":"mono","matchDarkFamily":"mono"}';
    const parsed = parseSettings(raw) as unknown as Record<string, unknown>;
    expect(parsed.theme).toBe("system");
    expect(parsed.themeFamily).toBe("ocean");
    expect("matchLightFamily" in parsed).toBeFalse();
    expect("matchDarkFamily" in parsed).toBeFalse();
    expect(unknownSettingsKeys(raw)).toEqual({});
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

  test("validates the installation-wide private-browser search engine", () => {
    expect(parseSettings('{"privateBrowserSearchEngine":"brave"}').privateBrowserSearchEngine).toBe("brave");
    expect(parseSettings('{"privateBrowserSearchEngine":"unknown"}').privateBrowserSearchEngine).toBe(
      "google",
    );
    expect(unknownAppSettingsKeys('{"privateBrowserSearchEngine":"bing"}')).toEqual({});
  });

  test("keeps only a bounded installation-wide relay URL", () => {
    expect(parseSettings('{"remoteAgentRelayUrl":" https://mcp.example/mcp "}').remoteAgentRelayUrl).toBe(
      "https://mcp.example/mcp",
    );
    expect(parseSettings(JSON.stringify({ remoteAgentRelayUrl: "x".repeat(2049) })).remoteAgentRelayUrl).toBe(
      "",
    );
    expect(unknownAppSettingsKeys('{"remoteAgentRelayUrl":"https://mcp.example/mcp"}')).toEqual({});
  });
});

describe("validTab — durable surface kinds survive a relaunch (#34)", () => {
  const alive = new Set(["note-1"]);
  const roundTrips = (tab: Tab) => {
    // what the pane store persisted must revalidate to itself
    expect(validTab(JSON.parse(JSON.stringify(tab)), alive)).toEqual(tab);
  };

  test("round-trips every durable tab kind", () => {
    roundTrips({ id: "t1", surfaceKind: "note", noteId: "note-1" });
    roundTrips({
      id: "t2",
      surfaceKind: "canvas",
      boardId: "Inbox/b.excalidraw",
    });
    roundTrips({ id: "t3", surfaceKind: "chat", chatSlug: "my-chat" });
    roundTrips({ id: "t4", surfaceKind: "chat", chatSlug: null });
    roundTrips({
      id: "t5",
      surfaceKind: "file",
      fileId: "storage/report.xlsx",
    });
    roundTrips({ id: "t6", surfaceKind: "activity" });
  });

  test("drops a private browser tab instead of persisting browsing state", () => {
    expect(validTab({ id: "private", surfaceKind: "browser" }, alive)).toBeNull();
  });

  test("still drops the malformed ones", () => {
    expect(validTab({ id: "x", surfaceKind: "file", fileId: "" }, alive)).toBeNull();
    expect(validTab({ id: "x", surfaceKind: "note", noteId: "gone" }, alive)).toBeNull();
    expect(validTab({ id: "x", surfaceKind: "hologram" }, alive)).toBeNull();
    expect(validTab({ surfaceKind: "activity" }, alive)).toBeNull(); // no id
  });

  test("a chat keeps its exact vault owner across relaunch", () => {
    expect(
      validTab({ id: "chat", surfaceKind: "chat", chatSlug: "daily", vaultId: "project-two" }, new Set()),
    ).toEqual({ id: "chat", surfaceKind: "chat", chatSlug: "daily", vaultId: "project-two" });
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
