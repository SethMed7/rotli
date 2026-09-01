/**
 * Legacy Breve cloud-spawn boundary.
 *
 * Scheduled and Signal work is on-device only. Keeping this fail-closed shim
 * means an old caller cannot revive a subscription CLI by constructing argv.
 */
import { refuseCloudProviderExecution } from "./provider-policy";

/** Bun.spawn options, minus the argv these wrappers supply themselves. */
type SpawnOptions = Parameters<typeof Bun.spawn>[1];

/** Refuse every cloud-model subprocess before binary lookup or spawn. */
export function runModel(argv: string[], opts?: SpawnOptions): Bun.Subprocess<"pipe", "pipe", "pipe"> {
  void argv;
  void opts;
  return refuseCloudProviderExecution();
}
