import { describe, expect, test } from "bun:test";

import { providerSetupStatus } from "./modelSetup";

describe("model onboarding provider status", () => {
  test("distinguishes detection, installation, sign-in, and readiness", () => {
    expect(providerSetupStatus(undefined)).toBe("Checking…");
    expect(providerSetupStatus({ installed: false, authenticated: false, version: null })).toBe(
      "Not installed",
    );
    expect(providerSetupStatus({ installed: true, authenticated: false, version: "1" })).toBe(
      "Sign in needed",
    );
    expect(providerSetupStatus({ installed: true, authenticated: true, version: "1" })).toBe("Ready");
  });
});
