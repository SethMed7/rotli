// The Workflow view for one routine (Seth, 2026-08-04: "so we can visually see
// what is happening"). Stage 1 is deliberately READ-ONLY: it shows what the
// routine's executor genuinely runs, derived by src/routines/pipeline.ts — the
// graph is documentation, not a second source of truth, and nothing here can
// edit or persist anything.
//
// Laid out with flow, not geometry. A routine pipeline is a SPINE with a
// delivery fan at its tail, so a horizontal strip of cards + a stacked final
// column says it exactly — no absolute positioning, no SVG, no layout engine to
// keep honest, and it reflows instead of clipping in a narrow window. The
// general DAG layout in src/editor/mermaidFlowLayout.ts stays available for
// Stage 2, when custom workflows can branch.

import { type PipelineStage, type RoutinePipeline } from "../../routines/pipeline";

/** One card. `off` = the stage exists but won't run on this config (a lane the
 * routine has switched off) — seeing what is NOT running is half the point. */
function StageCard({ stage }: { stage: PipelineStage }) {
  return (
    <div className={stage.enabled ? "breve-wf-stage" : "breve-wf-stage off"} data-kind={stage.kind}>
      <span className="breve-wf-kind">{stage.kind}</span>
      <strong className="breve-wf-label">{stage.label}</strong>
      <span className="breve-wf-detail">{stage.detail}</span>
      {!stage.enabled && <span className="breve-wf-off">off</span>}
    </div>
  );
}

export function RoutinePipelineView({ pipeline }: { pipeline: RoutinePipeline }) {
  const lanes = pipeline.stages.filter((s) => s.kind === "deliver");
  const spine = pipeline.stages.filter((s) => s.kind !== "deliver");

  return (
    <div className="breve-wf">
      {!pipeline.exact && (
        <p className="breve-wf-note">
          This routine runs its own script — the shape below is an outline, not a full reading of it.
        </p>
      )}
      <div className="breve-wf-flow" role="list" aria-label={`${pipeline.label} pipeline`}>
        {spine.map((stage, i) => (
          <div className="breve-wf-cell" role="listitem" key={stage.id}>
            <StageCard stage={stage} />
            {(i < spine.length - 1 || lanes.length > 0) && (
              <span className="breve-wf-arrow" aria-hidden="true" />
            )}
          </div>
        ))}
        {lanes.length > 0 && (
          <div className="breve-wf-lanes" role="listitem">
            {lanes.map((stage) => (
              <StageCard key={stage.id} stage={stage} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
