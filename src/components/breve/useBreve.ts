import { useQuery } from "@tanstack/react-query";

import { breveSnapshot, isTauri } from "../../lib/tauri";
import { EMPTY_BREVE_SNAPSHOT } from "../../routines/briefs";

export const BREVE_QUERY_KEY = ["breve", "snapshot"] as const;

export function useBreveSnapshot() {
  return useQuery({
    queryKey: BREVE_QUERY_KEY,
    queryFn: () => (isTauri() ? breveSnapshot() : Promise.resolve(EMPTY_BREVE_SNAPSHOT)),
    staleTime: 15_000,
    // Mounted only while the Breve lens is visible. A modest foreground poll
    // lets scheduler events arrive in Notifications without turning the
    // hidden workspace into a timer-driven app.
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
}
