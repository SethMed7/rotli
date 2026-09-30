// The main window's background work, for its whole life (split out of
// app.tsx, 2026-09-28): the routine update check (services/updateCheck:
// packaged builds, behind its Settings switch, lights the Settings dot),
// ambient audio with the sidebar player's tab polling (services/ambient), and
// the quit-time save failure notice.

import { useEffect } from "react";

import { onQuitFlushFailure } from "../lib/quitFlush";
import { enforceFronts } from "../state/fronts";
import { useUiStore } from "../state/ui";
import { startAmbient } from "./ambient";
import { startRoutineUpdateCheck } from "./updateCheck";

export function useMainWindowWork(surface: string): void {
  useEffect(() => {
    if (surface !== "main") return;
    const stops = [startRoutineUpdateCheck(), startAmbient(), enforceFronts()];
    return () => stops.forEach((stop) => stop());
  }, [surface]);

  useEffect(() => {
    if (surface !== "main") return;
    return onQuitFlushFailure((message) => {
      useUiStore
        .getState()
        .setRowActionError(`Rotli stayed open because some changes could not be saved — ${message}`);
    });
  }, [surface]);
}
