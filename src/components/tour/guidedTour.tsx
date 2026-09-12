// The guided tour: a skippable spotlight over the real controls after first-run
// setup (New, Main and its view picker, search, Aa, Chat, Settings), reopenable
// from Settings → General and the ⌘K palette. An overlay, not a dialog: the
// app stays live underneath, only the card takes clicks, Escape and Skip end it.

import { useEffect, useState } from "react";

import { useTourStore } from "../../state/tour";
import { nextAvailableStep, placeStep, TOUR_STEPS, type TourStep } from "./guidedTourModel";

const CARD = { width: 300, height: 150 };

function anchorRect(selector: string): DOMRect | null {
  const node = document.querySelector<HTMLElement>(selector);
  if (!node) return null;
  const rect = node.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 ? rect : null;
}

const available = (step: TourStep) => anchorRect(step.anchor) !== null;

export function GuidedTour() {
  const requested = useTourStore((s) => s.step);
  const setStep = useTourStore((s) => s.setStep);
  // a resize re-measures; the anchors are already committed DOM, so reading
  // them during render is deterministic for a given layout
  const [layout, setLayout] = useState(0);
  useEffect(() => {
    if (requested === null) return;
    const remeasure = () => setLayout((n) => n + 1);
    // the tour can open in the same commit as the workspace (right after
    // setup), before its controls have laid out: measure again next frame
    const frame = requestAnimationFrame(remeasure);
    const settled = window.setTimeout(remeasure, 600);
    window.addEventListener("resize", remeasure);
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setStep(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(settled);
      window.removeEventListener("resize", remeasure);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [requested, setStep]);

  if (requested === null) return null;
  // a step whose control is not on screen is skipped, in either direction
  const step = nextAvailableStep(requested, 1, available);
  const current = step >= 0 ? TOUR_STEPS[step] : undefined;
  const rect = current ? anchorRect(current.anchor) : null;
  if (!current || !rect) return null;
  void layout;
  const placement = placeStep(rect, { width: window.innerWidth, height: window.innerHeight }, CARD);
  const previous = nextAvailableStep(step - 1, -1, available);
  const next = nextAvailableStep(step + 1, 1, available);
  const total = TOUR_STEPS.filter(available).length;
  const position = TOUR_STEPS.slice(0, step + 1).filter(available).length;
  return (
    <div className="tour" role="region" aria-label="Guided tour" data-step={current.id}>
      {placement.scrims.map((scrim, index) => (
        <div key={index} className="tour-scrim" style={scrim} />
      ))}
      <div className="tour-ring" style={placement.ring} aria-hidden="true" />
      <section className={`tour-card is-${placement.side}`} style={placement.card} aria-live="polite">
        <p className="tour-count">
          {position} of {total}
        </p>
        <h2>{current.title}</h2>
        <p>{current.body}</p>
        <div className="tour-actions">
          <button type="button" className="ghostbtn" onClick={() => setStep(null)}>
            Skip tour
          </button>
          <span className="tour-spacer" />
          {previous >= 0 && (
            <button type="button" className="ghostbtn" onClick={() => setStep(previous)}>
              Back
            </button>
          )}
          <button
            type="button"
            className="primarybtn"
            autoFocus
            onClick={() => setStep(next >= 0 ? next : null)}
          >
            {next >= 0 ? "Next" : "Done"}
          </button>
        </div>
      </section>
    </div>
  );
}
