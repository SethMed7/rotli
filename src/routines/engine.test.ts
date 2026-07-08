import { describe, expect, it } from "bun:test";
import { runJob, type RoutineJob } from "./engine";
import type { RoutineKind } from "./types";

describe("routines engine (P0 stubs)", () => {
  const kinds: RoutineKind[] = ["brief", "creators", "watchers", "doctor", "signal"];

  it("returns a well-formed ok result for every routine kind", async () => {
    for (const kind of kinds) {
      const r = await runJob({ id: `job-${kind}`, kind });
      expect(r.ok).toBe(true);
      expect(r.kind).toBe(kind);
      expect(r.artifacts).toEqual([]);
      expect(r.log.length).toBeGreaterThan(0);
      expect(r.error).toBeUndefined();
    }
  });

  it("threads brief params into the stub log", async () => {
    const r = await runJob({ id: "b", kind: "brief", params: { briefKind: "night" } });
    expect(r.ok).toBe(true);
    expect(r.log).toContain("night");
  });

  it("fails safely (never throws) on an unknown kind arriving over the wire", async () => {
    const r = await runJob({ id: "x", kind: "bogus" as RoutineKind });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("unknown routine kind");
  });

  it("never throws on a null or kind-less descriptor, and still emits a kind", async () => {
    const r1 = await runJob(null as unknown as RoutineJob);
    expect(r1.ok).toBe(false);
    expect(r1.kind).toBe("unknown");
    const r2 = await runJob({ id: "y" } as RoutineJob);
    expect(r2.ok).toBe(false);
    expect(r2.kind).toBe("unknown");
  });
});
