// A host's part of first run (host/registry.ts, HostFirstRun): the blocks it
// puts in Rotli's steps, its own steps' bodies, and whether they let setup move
// on. Rotli gives only the slot and the order; the content is the host's.
// docs/architecture/host-seams.md, "First run under a host".

import { useCallback, useSyncExternalStore } from "react";

import { type HostStepBlock, type SetupStepId, setupStepBlocks } from "../../host/registry";

interface Readiness {
  ready?: () => boolean;
  subscribeReady?: (onChange: () => void) => () => void;
}

/** Whether every item lets setup move on now, and kept current while it shows. */
export function useStepReady(items: readonly Readiness[]): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const stops = items.flatMap((item) => (item.subscribeReady ? [item.subscribeReady(onChange)] : []));
      return () => stops.forEach((stop) => stop());
    },
    [items],
  );
  const read = () => items.every((item) => item.ready?.() ?? true);
  return useSyncExternalStore(subscribe, read, read);
}

/** The host's blocks in one place of one of Rotli's steps; nothing at all
 * when it has none, not even a wrapper. */
export function StepBlocks({ blocks }: { blocks: readonly HostStepBlock[] }) {
  if (!blocks.length) return null;
  return (
    <div className="setup-host-blocks">
      {blocks.map(({ Block }, index) => (
        <Block key={index} />
      ))}
    </div>
  );
}

/** Both places of a step's blocks, read once. */
export function stepBlocks(step: SetupStepId): {
  before: readonly HostStepBlock[];
  after: readonly HostStepBlock[];
} {
  return { before: setupStepBlocks(step, "before"), after: setupStepBlocks(step, "after") };
}
