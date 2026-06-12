// One QueryClient for the app. Exported as a module singleton so registry
// actions (outside React) can invalidate after service mutations.

import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // In-memory service: data only changes through our own mutations,
      // which invalidate explicitly. No refetch noise.
      staleTime: Number.POSITIVE_INFINITY,
      gcTime: Number.POSITIVE_INFINITY,
      retry: false,
    },
  },
});
