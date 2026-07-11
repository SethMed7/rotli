import { useQuery } from "@tanstack/react-query";
import { breveSnapshot, isTauri } from "../../lib/tauri";
import { EMPTY_BREVE_SNAPSHOT } from "./model";

export const BREVE_QUERY_KEY = ["breve", "snapshot"] as const;

export function useBreveSnapshot() {
  return useQuery({
    queryKey: BREVE_QUERY_KEY,
    queryFn: () => (isTauri() ? breveSnapshot() : Promise.resolve(EMPTY_BREVE_SNAPSHOT)),
    staleTime: 15_000,
  });
}
