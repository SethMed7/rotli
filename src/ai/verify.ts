// Connected-lane verification. Claude Code, Codex, and Cursor ACP are the only
// executable lanes; every requested model is rechecked against the catalog.

import { cliComplete } from "../lib/tauri";
import { LANE_PING_MODEL, type ProviderId, resolveLaneModel } from "./models";

const PING = "For this software integration check, reply with exactly: OK";
const PING_TIMEOUT_MS = 90_000;

export interface LaneVerify {
  ok: boolean;
  /** Round-trip time of the ping, ms. */
  ms: number;
  /** The model the ping ran on (the lane's cheapest). */
  model: string;
  error?: string;
}

export async function verifyLane(id: ProviderId, requestedModel?: string): Promise<LaneVerify> {
  const asked = requestedModel ?? LANE_PING_MODEL[id];
  // the lane's live list (or the built-in one until it answers)
  const model = resolveLaneModel(id, asked);
  if (!model) {
    return {
      ok: false,
      ms: 0,
      model: asked,
      error: `Model “${asked}” is not available for this provider.`,
    };
  }
  const start = Date.now();
  try {
    const reply = await cliComplete({
      requestId: crypto.randomUUID(),
      provider: id,
      model,
      prompt: PING,
      timeoutMs: PING_TIMEOUT_MS,
    });
    if (!reply.trim()) {
      return { ok: false, ms: Date.now() - start, model, error: "the model returned nothing" };
    }
    return { ok: true, ms: Date.now() - start, model };
  } catch (cause) {
    return {
      ok: false,
      ms: Date.now() - start,
      model,
      error: cause instanceof Error ? cause.message : String(cause),
    };
  }
}
