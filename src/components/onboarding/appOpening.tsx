// The app's opening (the owner, 2026-09-30: "make sure the animation is there
// when someone opens the app fresh, even if onboarding is done — like an app
// opening animation"). Once per launch of the Mac app, in the person's own
// theme: Rotli's island for Rotli, the family's own scene otherwise (the empty
// pane's scenes): scene and word, no quokka. Never right after first
// run's own intro, and not with Reduce motion on. It takes its time (the owner:
// "happens way too fast") and holds still until the window is in front, so a
// launch that starts behind other windows doesn't play it unseen. `?opening`
// shows it in the browser twin (tests).

import { useCallback, useEffect, useState } from "react";

import { openingPlaysHere } from "../../services/appOpening";
import { useUiStore } from "../../state/ui";
import { PANE_SCENES } from "../paneEmptyScenes";
import {
  ISLAND_SCENE,
  SceneIntro,
  markOpened,
  openedThisLaunch,
  prefersReducedMotion,
} from "./onboardingScenery";

/** Every beat at 1.7× first run's 1.7-second intro: about 2.9 seconds. */
const OPENING_PACE = 1.7;

export function openingWanted(): boolean {
  if (openedThisLaunch() || prefersReducedMotion()) return false;
  return openingPlaysHere();
}

export function AppOpening() {
  const [show, setShow] = useState(openingWanted);
  const family = useUiStore((s) => s.themeFamily);
  useEffect(markOpened, []);
  const done = useCallback(() => setShow(false), []);
  if (!show) return null;
  if (family === "warm")
    return (
      <SceneIntro
        art={ISLAND_SCENE}
        viewBox="0 0 1200 240"
        onDone={done}
        testId="app-opening"
        quokka={false}
        pace={OPENING_PACE}
        waitForFront
      />
    );
  return (
    <SceneIntro
      art={(PANE_SCENES[family] ?? PANE_SCENES.warm).art}
      viewBox="0 0 440 200"
      onDone={done}
      testId="app-opening"
      scene
      quokka={false}
      pace={OPENING_PACE}
      waitForFront
    />
  );
}
