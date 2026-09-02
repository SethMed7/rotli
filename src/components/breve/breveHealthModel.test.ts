import { describe, expect, test } from "bun:test";

import type { BreveSnapshot } from "../../routines/briefs";
import { EMPTY_BREVE_SNAPSHOT } from "../../routines/briefs";
import { HEALTH_LABELS, breveHealthSummary, healthReason } from "./breveHealthModel";

const NOW = Date.parse("2026-09-02T13:00:00Z");

function managed(overrides: Partial<BreveSnapshot>): BreveSnapshot {
  return {
    ...EMPTY_BREVE_SNAPSHOT,
    source: "rotli",
    scheduler: "rotli",
    config: {
      ...EMPTY_BREVE_SNAPSHOT.config,
      routines: [
        {
          id: "morning",
          label: "Morning",
          kind: "brief",
          enabled: true,
          schedule: { kind: "dailyAt", hhmm: "07:00", leadMinutes: 60 },
          lanes: ["inApp"],
        },
        {
          id: "lunch",
          label: "Lunch",
          kind: "brief",
          enabled: false,
          schedule: { kind: "dailyAt", hhmm: "12:00", leadMinutes: 30 },
          lanes: ["inApp"],
        },
        {
          id: "doctor",
          label: "Doctor",
          kind: "doctor",
          enabled: true,
          schedule: { kind: "everySecs", secs: 1800 },
          lanes: ["inApp"],
        },
      ],
    },
    briefs: [
      {
        stem: "2026-08-16",
        title: "Breve — Aug 16",
        kind: "morning",
        date: "2026-08-16",
        imported: false,
        path: "wiki/reference/briefs/2026-08-16.md",
      },
    ],
    ...overrides,
  };
}

describe("breveHealthSummary", () => {
  test("a failing brief slot is a warning that says how long it has been", () => {
    const summary = breveHealthSummary(
      managed({
        health: [
          {
            id: "morning",
            lastOk: false,
            lastSlot: "2026-08-16",
            pendingSlot: "2026-09-02",
            lastError: "writer exited without a brief: stderr noise",
          },
          { id: "doctor", lastOk: true },
        ],
      }),
      NOW,
    );
    expect(summary.level).toBe("warn");
    expect(summary.daysSinceBrief).toBe(17);
    expect(summary.label).toBe("No brief for 17 days");
    expect(summary.detail).toContain("morning is failing: writer exited without a brief");
    expect(summary.detail).not.toContain("stderr noise");
    expect(summary.failing.map((job) => job.id)).toEqual(["morning"]);
  });

  test("a disabled routine's stale failure does not count", () => {
    const summary = breveHealthSummary(
      managed({
        health: [
          { id: "lunch", lastOk: false, lastError: "old" },
          { id: "morning", lastOk: true },
        ],
      }),
      NOW,
    );
    expect(summary.level).toBe("ok");
    expect(summary.label).toBe(HEALTH_LABELS.managed);
  });

  test("a failing non-brief routine warns without claiming briefs stopped", () => {
    const summary = breveHealthSummary(
      managed({
        health: [
          { id: "morning", lastOk: true },
          { id: "doctor", lastOk: false, lastError: "Signal daemon is DOWN" },
        ],
      }),
      NOW,
    );
    expect(summary.level).toBe("warn");
    expect(summary.label).toBe("doctor failing");
    expect(summary.detail).toContain("Briefs are arriving");
  });

  test("no ledger yet reads as healthy, and no scheduler reads as off", () => {
    expect(breveHealthSummary(managed({ health: [] }), NOW).level).toBe("ok");
    const off = breveHealthSummary({ ...EMPTY_BREVE_SNAPSHOT }, NOW);
    expect(off.level).toBe("off");
    expect(off.label).toBe(HEALTH_LABELS.unconfigured);
    expect(breveHealthSummary(managed({ scheduler: "legacy-launchd", health: [] }), NOW).label).toBe(
      HEALTH_LABELS.legacy,
    );
  });

  test("failure before any brief ever landed says so", () => {
    const summary = breveHealthSummary(
      managed({
        briefs: [],
        health: [{ id: "morning", lastOk: false, lastError: "local model produced no brief" }],
      }),
      NOW,
    );
    expect(summary.daysSinceBrief).toBeNull();
    expect(summary.label).toBe(HEALTH_LABELS.failing);
    expect(summary.detail).toContain("No brief has landed yet");
  });
});

describe("healthReason", () => {
  test("keeps the scheduler's headline reason and drops the payload", () => {
    expect(healthReason("writer exited without a brief: error: An unknown error")).toBe(
      "writer exited without a brief",
    );
    expect(healthReason(undefined)).toBe("");
    expect(healthReason("x".repeat(200))).toHaveLength(96);
  });
});
