// The rendered walkthrough for a connected AI tool: numbered steps, a copy
// button on every command, the ones already done ticked from detection, and
// "Check again". Used by the Settings lane cards, the chat's empty state,
// and Rotli Web's chat setup.

import type { ReactNode } from "react";

import { type GuideStep as GuideStepData, connectorGuide, guideOs, stepDone } from "../../ai/connectorGuides";
import { PROVIDER_LABELS, type ProviderId } from "../../ai/models";
import type { CliDetect } from "../../services/connectorSetup";
import { CheckGlyph, CopyGlyph } from "../glyphs";
import { useCopyState } from "./useCopyState";

export function CopyCommand({ command }: { command: string }) {
  const { copyState: state, copy } = useCopyState();
  return (
    <span className="guide-cmd">
      <code>{command}</code>
      <button
        type="button"
        className={`claudecmd-copy ${state}`}
        aria-label={state === "copied" ? `Copied ${command}` : `Copy: ${command}`}
        title="Copy this command"
        onClick={() => void copy(command)}
      >
        {state === "copied" ? <CheckGlyph size={13} /> : <CopyGlyph size={13} />}
      </button>
    </span>
  );
}

/** One numbered step of any walkthrough: the number (a tick when done) and
 * whatever the step says. The connector guide and the web's chat setup share it. */
export function GuideStep({
  n,
  done,
  title,
  children,
}: {
  n: number;
  done: boolean;
  title: string;
  children: ReactNode;
}) {
  return (
    <li className={done ? "guide-step done" : "guide-step"}>
      <span className="guide-step-n" aria-hidden="true">
        {done ? <CheckGlyph size={12} /> : n}
      </span>
      <span className="guide-step-body">
        <span className="guide-step-title">{title}</span>
        {children}
      </span>
    </li>
  );
}

/** The ordered list the steps sit in. */
export function GuideSteps({ children }: { children: ReactNode }) {
  return <ol className="ailane-steps guide-steps">{children}</ol>;
}

export function ConnectorGuide({
  lane,
  detection,
  onRecheck,
  checking = false,
}: {
  lane: ProviderId;
  detection: CliDetect | undefined;
  /** Present where Rotli can look (the desktop shell). */
  onRecheck?: (() => void) | undefined;
  checking?: boolean;
}) {
  const steps: GuideStepData[] = connectorGuide(lane, guideOs(navigator.platform || navigator.userAgent));
  if (steps.length === 0) return null;
  return (
    <div className="guide" aria-label={`Set up ${PROVIDER_LABELS[lane]}`}>
      <GuideSteps>
        {steps.map((step, index) => {
          const done = stepDone(step, detection);
          return (
            <GuideStep key={step.id} n={index + 1} done={done} title={step.title}>
              {step.command && <CopyCommand command={step.command} />}
              <span className="guide-step-detail">
                {step.id === "check" && !onRecheck
                  ? "Once the helper is connected, Rotli sees the tool on its own."
                  : step.detail}
              </span>
              {step.id === "check" && onRecheck && (
                <button
                  type="button"
                  className="ghostbtn guide-check"
                  disabled={checking}
                  onClick={onRecheck}
                >
                  {checking ? "Checking…" : "Check again"}
                </button>
              )}
            </GuideStep>
          );
        })}
      </GuideSteps>
    </div>
  );
}
