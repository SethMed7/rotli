// What a routine actually DOES, as a pipeline — the model behind the Workflows
// view (the maintainer, 2026-08-04: "the different routines are essentially workflows now
// so we can visually see what is happening").
//
// THE HONESTY RULE. A routine has no steps on disk: it is
// `(id, kind, schedule, lanes, prompt)`, and the real pipeline is hardcoded in
// its executor (breve-runtime/scripts/*.sh|ts). So this file DERIVES the graph
// from what those executors genuinely run — it is documentation-as-code, not a
// second source of truth and not a drawing. If an executor changes, this must
// change with it; the tests below name the script each stage comes from so the
// drift is visible.
//
// Nothing here is persisted. Deriving (rather than storing) is what keeps the
// config format at version 1 and leaves the built-in routines' locked shape
// untouched — see docs/design/breve-workflows.md.
//
// Pure: no React, no Tauri, no I/O.

import type { BreveRoutine } from "../lib/tauri";

/** What a stage DOES — the vocabulary the view renders and colors by. */
export type StageKind =
  | "trigger" // the schedule fires
  | "model" // choose the generating model
  | "sandbox" // enter the seatbelt profile
  | "secret" // fetch a Keychain credential
  | "generate" // the model writes the brief
  | "fallback" // self-heal: retry on another model, then notify
  | "render" // markdown → HTML + PDF
  | "audio" // script rewrite → TTS → mp3
  | "image" // screenshot → png
  | "hold" // wait until the delivery time
  | "deliver" // send on one lane
  | "check" // a producer that inspects sources (watchers/creators/doctor)
  | "listen"; // an always-on daemon

export type DeliveryLane = "inApp" | "signal" | "email";

export interface PipelineStage {
  id: string;
  kind: StageKind;
  label: string;
  /** One quiet line naming what really happens — never invented. */
  detail: string;
  /** Set on `deliver` stages; the view dims a lane the routine has switched off. */
  lane?: DeliveryLane;
  /** False = this stage is skipped on the current config (an off lane, an
   * always-on routine with no schedule). Shown, but visibly inert — seeing what
   * is NOT running is half the point of the view. */
  enabled: boolean;
}

export interface PipelineEdge {
  from: string;
  to: string;
}

export interface RoutinePipeline {
  routineId: string;
  label: string;
  stages: PipelineStage[];
  edges: PipelineEdge[];
  /** True when the graph is a faithful read of a KNOWN executor. An unknown
   * routine kind yields a minimal, honest trigger→run→deliver sketch with this
   * false, so the view can say so rather than pretending to certainty. */
  exact: boolean;
}

const LANE_LABEL: Record<DeliveryLane, string> = {
  inApp: "In rotli",
  signal: "Signal",
  email: "Email",
};

/** The delivery tail every brief-shaped routine shares. `extras` names the
 * artifacts a lane carries (the built-in briefs attach a PDF; customs are
 * text-only — custom-brief.sh has no render/audio/image stage at all). */
function deliveryStages(routine: BreveRoutine, withPdf: boolean): PipelineStage[] {
  const lanes: DeliveryLane[] = ["inApp", "signal", "email"];
  return lanes.map((lane) => ({
    id: `deliver-${lane}`,
    kind: "deliver" as const,
    lane,
    label: LANE_LABEL[lane],
    detail:
      lane === "inApp"
        ? "the brief appears in Breve"
        : lane === "signal"
          ? "send-signal-brief.ts, receipt-claimed"
          : withPdf
            ? "send-brief.ts — Resend, PDF attached"
            : "send-brief.ts — Resend",
    enabled: routine.lanes.includes(lane),
  }));
}

/** Chain a list of stages head-to-tail, then fan the tail into every lane. */
function chain(spine: PipelineStage[], lanes: PipelineStage[]): PipelineEdge[] {
  const edges: PipelineEdge[] = [];
  for (let i = 1; i < spine.length; i++) {
    edges.push({ from: spine[i - 1]!.id, to: spine[i]!.id });
  }
  const tail = spine[spine.length - 1];
  if (tail) for (const lane of lanes) edges.push({ from: tail.id, to: lane.id });
  return edges;
}

function triggerStage(routine: BreveRoutine): PipelineStage {
  const s = routine.schedule;
  const detail =
    s.kind === "dailyAt"
      ? s.leadMinutes > 0
        ? `${s.hhmm} delivery — generation starts ${s.leadMinutes} min earlier`
        : `${s.hhmm} daily`
      : s.kind === "everySecs"
        ? `every ${s.secs >= 3600 ? `${Math.round(s.secs / 3600)}h` : `${Math.round(s.secs / 60)}m`}`
        : "always on";
  return {
    id: "trigger",
    kind: "trigger",
    label: s.kind === "alwaysOn" ? "Always on" : "Schedule",
    detail,
    enabled: routine.enabled,
  };
}

/** The generating spine shared by every brief (built-in and custom). Mirrors
 * morning-brief.sh / custom-brief.sh in order. */
function briefSpine(routine: BreveRoutine): PipelineStage[] {
  return [
    triggerStage(routine),
    {
      id: "model",
      kind: "model",
      label: "Pick the model",
      detail: "brief-model.ts reads your Breve model setting",
      enabled: true,
    },
    {
      id: "sandbox",
      kind: "sandbox",
      label: "Sandbox",
      detail: "sandbox-exec — everything outside Breve and your vault is read-only",
      enabled: true,
    },
    {
      id: "secret",
      kind: "secret",
      label: "Read-only token",
      detail: "breve-gh-readonly, from the Keychain",
      enabled: true,
    },
    {
      id: "generate",
      kind: "generate",
      label: "Write the brief",
      detail: routine.prompt
        ? "the model researches and writes, following your instructions"
        : "the model researches and writes, following the Breve instructions",
      enabled: true,
    },
    {
      id: "fallback",
      kind: "fallback",
      label: "Self-heal",
      detail: "nothing written? retry on a second model, then tell you",
      enabled: true,
    },
  ];
}

/** The artifact stages only the BUILT-IN briefs run (custom-brief.sh is
 * text-only by design — "those pipelines are slot-shaped"). */
function builtinArtifactStages(): PipelineStage[] {
  return [
    {
      id: "render",
      kind: "render",
      label: "Render",
      detail: "render-brief.ts → HTML + PDF",
      enabled: true,
    },
    {
      id: "audio",
      kind: "audio",
      label: "Audio",
      detail: "on-device rewrite → Kokoro speech → mp3",
      enabled: true,
    },
    { id: "image", kind: "image", label: "Preview image", detail: "full-page png", enabled: true },
    {
      id: "hold",
      kind: "hold",
      label: "Hold",
      detail: "generated early, delivered on time",
      enabled: true,
    },
  ];
}

/** A producer routine (watchers / creators / doctor): check sources, notify on
 * a finding. No brief file, no render chain. */
function producerPipeline(routine: BreveRoutine, label: string, detail: string): RoutinePipeline {
  const spine: PipelineStage[] = [
    triggerStage(routine),
    { id: "check", kind: "check", label, detail, enabled: true },
  ];
  const lanes = deliveryStages(routine, false).map((lane) => ({
    ...lane,
    detail:
      lane.lane === "inApp"
        ? "shows in Breve"
        : `${LANE_LABEL[lane.lane!]} — only when there's something to say`,
  }));
  return {
    routineId: routine.id,
    label: routine.label,
    stages: [...spine, ...lanes],
    edges: chain(spine, lanes),
    exact: true,
  };
}

/**
 * Derive the pipeline a routine really runs.
 *
 * Built-in briefs (morning/lunch/night) carry the full artifact chain; custom
 * briefs share the generating spine but are text-only; reminders skip the model
 * entirely; producers check and notify; the Signal daemon just listens.
 */
export function routinePipeline(routine: BreveRoutine): RoutinePipeline {
  const base = { routineId: routine.id, label: routine.label };

  if (routine.kind === "signal") {
    const stages: PipelineStage[] = [
      triggerStage(routine),
      {
        id: "listen",
        kind: "listen",
        label: "Listen",
        detail: "signal-daemon.ts — replies to you on Signal",
        enabled: true,
      },
    ];
    return { ...base, stages, edges: chain(stages, []), exact: true };
  }

  if (routine.kind === "watchers") {
    return producerPipeline(routine, "Check watched pages", "watcher-check.ts — diffs each watched source");
  }
  if (routine.kind === "creators") {
    return producerPipeline(
      routine,
      "Check creators",
      "creator-alerts.ts — new posts from people you follow",
    );
  }
  if (routine.kind === "doctor") {
    return producerPipeline(routine, "Self-check", "breve-doctor.ts — finds and reports Breve's own faults");
  }

  if (routine.kind === "reminder") {
    // reminder.ts writes brief-shaped markdown with NO model call
    const spine: PipelineStage[] = [
      triggerStage(routine),
      {
        id: "compose",
        kind: "generate",
        label: "Compose",
        detail: "reminder.ts — your text, no model involved",
        enabled: true,
      },
    ];
    const lanes = deliveryStages(routine, false);
    return { ...base, stages: [...spine, ...lanes], edges: chain(spine, lanes), exact: true };
  }

  if (routine.kind === "brief") {
    const builtin = BUILTIN_BRIEF_IDS.includes(routine.id);
    const spine = [...briefSpine(routine), ...(builtin ? builtinArtifactStages() : [])];
    const lanes = deliveryStages(routine, builtin);
    return { ...base, stages: [...spine, ...lanes], edges: chain(spine, lanes), exact: true };
  }

  // An unknown kind must NOT be drawn as if we understood it.
  const spine: PipelineStage[] = [
    triggerStage(routine),
    { id: "run", kind: "generate", label: "Run", detail: "this routine's own script", enabled: true },
  ];
  const lanes = deliveryStages(routine, false);
  return { ...base, stages: [...spine, ...lanes], edges: chain(spine, lanes), exact: false };
}

/** The three built-in briefs that carry the full artifact chain. */
export const BUILTIN_BRIEF_IDS = ["morning", "lunch", "night"];
