import { describe, expect, test } from "bun:test";

import type { MemexConfig, MemexInstance } from "../memex/config";
import { captureDestination, captureWireId } from "./captureRouting";

const instance = (id: string, perms: MemexInstance["perms"] = "chats+inbox"): MemexInstance => ({
  id,
  label: id === "corpus" ? "Personal" : "Quick thoughts",
  root: `/vaults/${id}`,
  role: id === "corpus" ? "corpus" : "brain",
  memexId: `mx_${id}`,
  mode: "local",
  perms,
  brainEnabled: true,
});

const config: MemexConfig = {
  activeId: "corpus",
  instances: [instance("corpus"), instance("quick"), instance("readonly", "read-only")],
  developmentReadOnly: false,
};

describe("capture vault routing", () => {
  test("an explicit writable vault outranks the active vault", () => {
    expect(captureDestination(config, "quick")).toEqual(instance("quick"));
    expect(captureWireId(instance("quick"), "01QUICK")).toBe("quick:01QUICK");
  });

  test("the empty preference preserves the active-vault default", () => {
    expect(captureDestination(config, null)).toEqual(instance("corpus"));
    expect(captureWireId(instance("corpus"), "01LOCAL")).toBe("01LOCAL");
  });

  test("an explicit missing or read-only vault never silently falls back", () => {
    expect(() => captureDestination(config, "missing")).toThrow("no longer available");
    expect(() => captureDestination(config, "readonly")).toThrow("write access");
  });
});
