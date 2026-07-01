// Safe-default locks on the settings parse. The load-bearing one: the organizer
// daemon's trust rung must fall back to "suggest" (applies nothing) on any
// unknown/corrupt value — a bad parse must never GRANT auto-apply.

import { describe, expect, it } from "bun:test";
import { parseSettings } from "./persist";

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
