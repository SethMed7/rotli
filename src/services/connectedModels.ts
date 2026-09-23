// Ask each connected client which models it offers (Rust `cli_models`, or
// Rotli Helper's verb on the web) and keep the answers in the store the
// catalog accessors read. Asked once a lane is enabled and ready, again when a
// model list opens after the refresh window — never per keystroke.

import { useQueries } from "@tanstack/react-query";
import { useEffect } from "react";

import { PROVIDER_IDS, type ProviderId } from "../ai/models";
import { type CliDetect, cliDetect, cliModels } from "../lib/tauri";
import { type DiscoveryLanes, setLaneDiscovery, useConnectedModels } from "../state/connectedModels";

/** How long an answer stands before a list opening asks again. */
export const DISCOVERY_FRESH_MS = 5 * 60_000;
const DISCOVERY_RETRY_MS = 60_000;

const inFlight = new Map<ProviderId, Promise<void>>();

/** Ask one lane (deduplicated, rate-limited by the refresh window). A failure
 * keeps the last answer when there is one; otherwise the lane reads `error`
 * and the built-in catalog stands in — an older Rotli Helper without the verb
 * lands here too. */
export function discoverConnectedModels(
  provider: ProviderId,
  { refresh = false, now = Date.now() }: { refresh?: boolean; now?: number } = {},
): Promise<void> {
  const pending = inFlight.get(provider);
  if (pending) return pending;
  const lane = useConnectedModels.getState().lanes[provider];
  // a lane that couldn't list (signed out, CLI missing) is re-asked sooner
  const freshFor = lane?.status === "error" ? DISCOVERY_RETRY_MS : DISCOVERY_FRESH_MS;
  if (!refresh && lane && lane.status !== "loading" && now - lane.at < freshFor) {
    return Promise.resolve();
  }
  if (!lane) setLaneDiscovery(provider, { status: "loading", models: [], at: now });
  const run = Promise.resolve()
    .then(() => cliModels(provider, refresh))
    .then((models) => {
      const listed = Array.isArray(models) ? models : [];
      setLaneDiscovery(provider, {
        status: listed.length ? "ready" : "error",
        models: listed,
        at: Date.now(),
      });
    })
    .catch(() => {
      const previous = useConnectedModels.getState().lanes[provider];
      const kept = previous?.status === "ready" ? previous.models : [];
      setLaneDiscovery(provider, { status: kept.length ? "ready" : "error", models: kept, at: Date.now() });
    })
    .finally(() => inFlight.delete(provider));
  inFlight.set(provider, run);
  return run;
}

type LaneFlags = Readonly<Partial<Record<ProviderId, boolean>>>;

/** Ready flags from detections: installed and signed in. */
export function readyFrom(
  detections: Partial<Record<ProviderId, CliDetect | undefined>>,
): Record<ProviderId, boolean> {
  return Object.fromEntries(
    PROVIDER_IDS.map((id) => [id, !!detections[id]?.installed && !!detections[id]?.authenticated]),
  ) as Record<ProviderId, boolean>;
}

/** Which lanes to ask: switched on and (when known) detected ready. */
function askable(enabled: LaneFlags, ready?: LaneFlags): ProviderId[] {
  return PROVIDER_IDS.filter((id) => enabled[id] && (ready === undefined || ready[id] === true));
}

/** Whether every lane worth asking has answered (a list or a failure). A
 * saved pick is judged only after this, so a model the client is about to
 * report is never healed away while its list is still loading. */
export function discoverySettled(lanes: DiscoveryLanes, enabled: LaneFlags, ready?: LaneFlags): boolean {
  return askable(enabled, ready).every((id) => {
    const status = lanes[id]?.status;
    return status === "ready" || status === "error";
  });
}

/** Subscribe a surface to the discovered lists and ask the lanes it shows. */
export function useConnectedCatalog(
  enabled: LaneFlags,
  ready?: LaneFlags,
): { lanes: DiscoveryLanes; settled: boolean } {
  const lanes = useConnectedModels((state) => state.lanes);
  const wanted = askable(enabled, ready).join(",");
  useEffect(() => {
    for (const id of wanted ? (wanted.split(",") as ProviderId[]) : []) void discoverConnectedModels(id);
  }, [wanted]);
  return { lanes, settled: discoverySettled(lanes, enabled, ready) };
}

/** The chat's view of the connected lanes: each enabled lane's detection
 * (installed + signed in), then the list its client reports. `settled` once
 * every enabled lane has been detected and every ready lane has answered. */
export function useConnectedLanes(
  enabled: Record<ProviderId, boolean>,
  runtimeAvailable: boolean,
): { ready: Record<ProviderId, boolean>; lanes: DiscoveryLanes; settled: boolean } {
  const checks = useQueries({
    queries: PROVIDER_IDS.map((id) => ({
      queryKey: ["cli-detect", id],
      queryFn: () => cliDetect(id),
      enabled: runtimeAvailable && enabled[id],
      staleTime: 60_000,
    })),
  });
  const ready = readyFrom(Object.fromEntries(PROVIDER_IDS.map((id, index) => [id, checks[index]?.data])));
  const detected = PROVIDER_IDS.every((id, index) => !enabled[id] || checks[index]?.isFetched);
  const { lanes, settled } = useConnectedCatalog(enabled, ready);
  return { ready, lanes, settled: detected && settled };
}

/** A model list opened: re-ask the lanes it shows once their answer is old. */
export function refreshShownLanes(providers: Iterable<string>): void {
  for (const id of new Set(providers)) {
    if ((PROVIDER_IDS as readonly string[]).includes(id)) void discoverConnectedModels(id as ProviderId);
  }
}
