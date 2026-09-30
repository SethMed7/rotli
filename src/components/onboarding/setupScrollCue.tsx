// "Scroll for more ↓" at the foot of a setup step whose content runs past the
// card (a short window). Shared by every first-run step; it hides once the
// step is scrolled to its end.

import { type RefObject, useEffect, useRef, useState } from "react";

/** A ref for the step's scroller, whether there is more below it, and
 * whether it scrolls at all. It re-measures every render (the step's content
 * changes), on resize, and on scroll. */
export function useStageScrollCue(): [RefObject<HTMLDivElement | null>, boolean, boolean] {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [show, setShow] = useState(false);
  const [scrolls, setScrolls] = useState(false);
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const update = () => {
      const overflow = stage.scrollHeight - stage.clientHeight > 8;
      const moreBelow = stage.scrollTop + stage.clientHeight < stage.scrollHeight - 8;
      setShow(overflow && moreBelow);
      setScrolls(overflow);
    };
    const observer = new ResizeObserver(update);
    observer.observe(stage);
    for (const child of stage.children) observer.observe(child);
    stage.addEventListener("scroll", update, { passive: true });
    update();
    return () => {
      observer.disconnect();
      stage.removeEventListener("scroll", update);
    };
  });
  return [stageRef, show, scrolls];
}

export function SetupScrollCue() {
  return (
    <div className="setup-stage-scroll-cue" aria-hidden="true">
      Scroll for more <span>↓</span>
    </div>
  );
}
