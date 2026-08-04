// The routine → pipeline derivation. These tests are the DRIFT ALARM: each one
// names the executor script its expectation comes from, so if a script's real
// stages change and this file isn't updated, the failure says where to look.
//
// The graph is derived, never stored — so "is it true?" is the only thing worth
// asserting, and truth means "matches what breve-runtime actually runs".

import { describe, expect, test } from "bun:test";

import type { BreveRoutine } from "../lib/tauri";
import { routinePipeline } from "./pipeline";

const routine = (over: Partial<BreveRoutine> = {}): BreveRoutine => ({
  id: "morning",
  label: "Morning brief",
  kind: "brief",
  enabled: true,
  schedule: { kind: "dailyAt", hhmm: "07:00", leadMinutes: 60 },
  lanes: ["inApp", "signal", "email"],
  ...over,
});

const ids = (r: BreveRoutine) => routinePipeline(r).stages.map((s) => s.id);

describe("built-in briefs — morning-brief.sh", () => {
  test("the full chain, in the order the script runs it", () => {
    expect(ids(routine())).toEqual([
      "trigger",
      "model",
      "sandbox",
      "secret",
      "generate",
      "fallback",
      "render",
      "audio",
      "image",
      "hold",
      "deliver-inApp",
      "deliver-signal",
      "deliver-email",
    ]);
    expect(routinePipeline(routine()).exact).toBe(true);
  });

  test("the spine is linear and every lane hangs off its tail", () => {
    const p = routinePipeline(routine());
    // the last spine stage before the lanes is `hold`
    const lanes = p.edges.filter((e) => e.from === "hold").map((e) => e.to);
    expect(lanes).toEqual(["deliver-inApp", "deliver-signal", "deliver-email"]);
    // no edge points INTO the trigger — it is the only root
    expect(p.edges.some((e) => e.to === "trigger")).toBe(false);
  });

  test("a switched-off lane is still SHOWN, but marked inert", () => {
    const p = routinePipeline(routine({ lanes: ["inApp"] }));
    const byId = Object.fromEntries(p.stages.map((s) => [s.id, s]));
    expect(byId["deliver-inApp"]?.enabled).toBe(true);
    expect(byId["deliver-signal"]?.enabled).toBe(false);
    expect(byId["deliver-email"]?.enabled).toBe(false);
  });

  test("a disabled routine shows its trigger as inert without losing the graph", () => {
    const p = routinePipeline(routine({ enabled: false }));
    expect(p.stages[0]?.enabled).toBe(false);
    expect(p.stages.length).toBeGreaterThan(5);
  });

  test("the lead time is spelled out — it's the confusing part of Breve", () => {
    expect(routinePipeline(routine()).stages[0]?.detail).toBe(
      "07:00 delivery — generation starts 60 min earlier",
    );
    expect(
      routinePipeline(routine({ schedule: { kind: "dailyAt", hhmm: "12:30", leadMinutes: 0 } })).stages[0]
        ?.detail,
    ).toBe("12:30 daily");
  });
});

describe("custom briefs — custom-brief.sh is TEXT-ONLY", () => {
  const custom = routine({ id: "reading-log", label: "Reading log", lanes: ["signal"], prompt: "…" });

  test("shares the generating spine but runs no render/audio/image/hold", () => {
    expect(ids(custom)).toEqual([
      "trigger",
      "model",
      "sandbox",
      "secret",
      "generate",
      "fallback",
      "deliver-inApp",
      "deliver-signal",
      "deliver-email",
    ]);
  });

  test("its email lane advertises no PDF (the built-ins' attachment is theirs alone)", () => {
    const email = routinePipeline(custom).stages.find((s) => s.id === "deliver-email");
    expect(email?.detail).not.toContain("PDF");
    expect(routinePipeline(routine()).stages.find((s) => s.id === "deliver-email")?.detail).toContain("PDF");
  });
});

describe("the other kinds", () => {
  test("a reminder never calls a model — reminder.ts", () => {
    const p = routinePipeline(routine({ id: "standup", kind: "reminder", prompt: "…" }));
    expect(ids(routine({ id: "standup", kind: "reminder" }))).toEqual([
      "trigger",
      "compose",
      "deliver-inApp",
      "deliver-signal",
      "deliver-email",
    ]);
    expect(p.stages.some((s) => s.kind === "model")).toBe(false);
    expect(p.stages.find((s) => s.id === "compose")?.detail).toContain("no model");
  });

  test("producers check and notify — watcher-check / creator-alerts / breve-doctor", () => {
    for (const kind of ["watchers", "creators", "doctor"] as const) {
      const p = routinePipeline(routine({ id: kind, kind, schedule: { kind: "everySecs", secs: 3600 } }));
      expect(p.stages.map((s) => s.kind)).toEqual(["trigger", "check", "deliver", "deliver", "deliver"]);
      expect(p.stages[0]?.detail).toBe("every 1h");
      expect(p.exact).toBe(true);
    }
  });

  test("the Signal daemon just listens — no delivery fan-out", () => {
    const p = routinePipeline(routine({ id: "signal", kind: "signal", schedule: { kind: "alwaysOn" } }));
    expect(p.stages.map((s) => s.kind)).toEqual(["trigger", "listen"]);
    expect(p.stages[0]?.detail).toBe("always on");
    expect(p.edges).toEqual([{ from: "trigger", to: "listen" }]);
  });

  test("an UNKNOWN kind is sketched honestly, flagged inexact — never invented", () => {
    const p = routinePipeline(routine({ kind: "sorcery" as BreveRoutine["kind"] }));
    expect(p.exact).toBe(false);
    expect(p.stages.map((s) => s.id)).toEqual([
      "trigger",
      "run",
      "deliver-inApp",
      "deliver-signal",
      "deliver-email",
    ]);
  });
});

describe("graph integrity (what the layout engine will rely on)", () => {
  const all: BreveRoutine[] = [
    routine(),
    routine({ id: "reading-log", prompt: "…" }),
    routine({ id: "standup", kind: "reminder" }),
    routine({ id: "watchers", kind: "watchers", schedule: { kind: "everySecs", secs: 900 } }),
    routine({ id: "signal", kind: "signal", schedule: { kind: "alwaysOn" } }),
  ];

  test("every edge names real stages, and stage ids are unique", () => {
    for (const r of all) {
      const p = routinePipeline(r);
      const known = new Set(p.stages.map((s) => s.id));
      expect(known.size).toBe(p.stages.length);
      for (const e of p.edges) {
        expect(known.has(e.from)).toBe(true);
        expect(known.has(e.to)).toBe(true);
      }
    }
  });

  test("exactly one root, and every stage is reachable from it", () => {
    for (const r of all) {
      const p = routinePipeline(r);
      const hasParent = new Set(p.edges.map((e) => e.to));
      const roots = p.stages.filter((s) => !hasParent.has(s.id));
      expect(roots.map((s) => s.id)).toEqual(["trigger"]);

      const seen = new Set(["trigger"]);
      let grew = true;
      while (grew) {
        grew = false;
        for (const e of p.edges) {
          if (seen.has(e.from) && !seen.has(e.to)) {
            seen.add(e.to);
            grew = true;
          }
        }
      }
      expect(seen.size).toBe(p.stages.length);
    }
  });
});
