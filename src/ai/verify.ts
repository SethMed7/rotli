// Lane verification — the honest "does this connected lane actually work?":
// a REAL one-line completion on the lane's cheapest model (detection only
// proves a binary + a credential exist; a ping proves the whole path). Run
// once in the background when a lane is toggled on, and from the Test button.

import { chatMessages, cliComplete } from "../lib/tauri";
import { GEMINI_OPENAI_BASE, LANE_PING_MODEL, type ProviderId } from "./models";

const PING = "Reply with exactly: OK";
/** A verification must never camp — a stuck CLI reports as a failure. */
const PING_TIMEOUT_MS = 90_000;

export interface LaneVerify {
  ok: boolean;
  /** Round-trip time of the ping, ms. */
  ms: number;
  /** The model the ping ran on (the lane's cheapest). */
  model: string;
  error?: string;
}

export async function verifyLane(id: ProviderId): Promise<LaneVerify> {
  const model = LANE_PING_MODEL[id];
  const start = Date.now();
  try {
    let reply: string;
    if (id === "gemini") {
      // the key lane is HTTP — ride the same openai pipeline a chat uses
      reply = await chatMessages([{ role: "user", content: PING }], {
        model,
        endpoint: GEMINI_OPENAI_BASE,
        api: "openai",
        maxTokens: 8,
      });
    } else {
      reply = await cliComplete({
        requestId: crypto.randomUUID(),
        provider: id,
        model,
        prompt: PING,
        timeoutMs: PING_TIMEOUT_MS,
      });
    }
    if (!reply.trim()) {
      return { ok: false, ms: Date.now() - start, model, error: "the model returned nothing" };
    }
    return { ok: true, ms: Date.now() - start, model };
  } catch (e) {
    return {
      ok: false,
      ms: Date.now() - start,
      model,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
