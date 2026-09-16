import { describe, expect, test } from "bun:test";

import { connectorGuide, guideOs, stepDone } from "./connectorGuides";

describe("connector guides", () => {
  test("the OS is read from the platform hint, Mac when unsure", () => {
    expect(guideOs("MacIntel")).toBe("mac");
    expect(guideOs("Win32")).toBe("windows");
    expect(guideOs("Linux x86_64")).toBe("linux");
    expect(guideOs("")).toBe("mac");
  });

  test("every lane walks install → sign in → come back, with the tool's official commands", () => {
    for (const lane of ["claude", "codex", "cursor"] as const) {
      const steps = connectorGuide(lane, "mac");
      expect(steps.map((s) => s.id)).toEqual(["install", "login", "check"]);
      expect(steps[1]?.command).toMatch(/login/);
    }
    expect(connectorGuide("claude", "linux")[0]?.command).toBe("npm install -g @anthropic-ai/claude-code");
    expect(connectorGuide("codex", "mac")[0]?.command).toBe("brew install codex");
    expect(connectorGuide("codex", "windows")[0]?.command).toBe("npm install -g @openai/codex");
    expect(connectorGuide("cursor", "windows")[0]?.command).toMatch(/^irm /);
    expect(connectorGuide("antigravity", "mac")).toEqual([]);
  });

  test("detection marks the steps that are already behind the user", () => {
    const [install, login, check] = connectorGuide("claude", "mac");
    expect(stepDone(install!, undefined)).toBe(false);
    expect(stepDone(install!, { installed: true, authenticated: false, version: null })).toBe(true);
    expect(stepDone(login!, { installed: true, authenticated: false, version: null })).toBe(false);
    expect(stepDone(check!, { installed: true, authenticated: true, version: "1" })).toBe(true);
  });
});
