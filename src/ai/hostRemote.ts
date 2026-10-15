// The Host's connected (CLI) lane: one stateless, tool-less subprocess per
// step, Rust owning the allowlist and sandbox flags (split out of host.ts so it
// stays under its size ceiling). Just after launch it waits for the secure-note
// walk instead of failing (ai/remoteBlock.ts).

import { cliComplete } from "../lib/tauri";
import { retryWhileWarming } from "./remoteBlock";
import type { CompleteReq } from "./types";

/** Mirror of Rust `flatten_messages`: the loop sends ONE user message (the
 * whole rendered prompt) which passes verbatim; anything else gets labeled
 * turns + a trailing Assistant: cue. */
export function flattenWire(messages: CompleteReq["messages"]): string {
  const [only] = messages;
  if (messages.length === 1 && only && only.role === "user") return only.content;
  const labeled = messages.map((m) => {
    const label = m.role === "system" ? "System" : m.role === "assistant" ? "Assistant" : "User";
    return `${label}: ${m.content}`;
  });
  return `${labeled.join("\n\n")}\n\nAssistant:`;
}

export interface CliLaneOpts {
  requestId?: string;
  reasoningEffort?: Parameters<typeof cliComplete>[0]["reasoningEffort"];
  serviceTier?: Parameters<typeof cliComplete>[0]["serviceTier"];
  /** The person's own messages they chose to send anyway (ai/remoteBlock.ts). */
  consent?: string[];
}

export function completeOnCli(
  model: { provider: string; id: string },
  messages: CompleteReq["messages"],
  opts: CliLaneOpts | undefined,
): Promise<string> {
  // attachments ride the FIRST message, exactly like the openai lane
  const attached = messages.flatMap((m) => m.images ?? []);
  const requestId = opts?.requestId ?? crypto.randomUUID(); // one id across warm-up retries
  return retryWhileWarming(() =>
    cliComplete({
      requestId,
      provider: model.provider,
      model: model.id,
      prompt: flattenWire(messages),
      ...(opts?.reasoningEffort ? { reasoningEffort: opts.reasoningEffort } : {}),
      ...(opts?.serviceTier ? { serviceTier: opts.serviceTier } : {}),
      ...(attached.length > 0 ? { images: attached } : {}),
      ...(opts?.consent ? { consent: opts.consent } : {}),
    }),
  );
}
