export type WatcherFailureState = {
  fails?: number;
  failureAlerted?: boolean;
};

export type WatcherFailureDecision = {
  fails: number;
  alreadyAlerted: boolean;
  shouldAlert: boolean;
};

export function resetWatcherFailure(): Required<WatcherFailureState> {
  return { fails: 0, failureAlerted: false };
}

/** Advance one failed check. Missing alert state on an old counter at or above
 * the threshold means the legacy runtime already emitted its one warning. */
export function nextWatcherFailure(
  state: WatcherFailureState,
  threshold = 5,
): WatcherFailureDecision {
  const previousFails = Math.max(0, state.fails ?? 0);
  const alreadyAlerted = state.failureAlerted === true
    || (state.failureAlerted == null && previousFails >= threshold);
  const fails = previousFails + 1;
  return { fails, alreadyAlerted, shouldAlert: fails >= threshold && !alreadyAlerted };
}
