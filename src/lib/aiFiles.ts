// The AI's own lane for Word documents (src-tauri/src/ai_files.rs): creating
// one records that the AI made it, and saving an edit is refused for a
// document a person made. Off the Mac app there is no lane.

import { invoke } from "@tauri-apps/api/core";

import { isTauri } from "./tauri";

const noLane = () => Promise.reject(new Error("Word documents are edited in the Mac app."));

/** `agent` names the outside agent that asked through the agent bridge; the
 * chat leaves it out. */
export const corpusCreateManagedFileAi = (
  name: string,
  base64: string,
  rootId?: string,
  agent?: string,
): Promise<string> =>
  isTauri()
    ? invoke<string>("corpus_create_managed_file_ai", {
        name,
        base64,
        rootId: rootId ?? null,
        agent: agent ?? null,
      })
    : noLane();

export const corpusWriteFileAi = (id: string, base64: string, expectedRevision: string): Promise<string> =>
  isTauri() ? invoke<string>("corpus_write_file_ai", { id, base64, expectedRevision }) : noLane();
