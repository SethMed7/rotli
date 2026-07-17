import { corpusJournalAppend, corpusJournalRead } from "../lib/tauri";
import type { BrainAction } from "./brainJournal";

let counter = 0;
function actionId(ts: number): string {
  return `${ts.toString(36)}-${(counter++).toString(36)}`;
}

/** Tauri-backed journal adapter. Policy and transition grammar remain in
 * brainJournal.ts and can run entirely against injected fakes. */
export async function readJournal(): Promise<BrainAction[]> {
  const raw = await corpusJournalRead();
  return raw
    .split("\n")
    .filter((line) => line.trim())
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as BrainAction];
      } catch {
        return [];
      }
    });
}

export async function logAction(
  action: Omit<BrainAction, "id" | "ts" | "status">,
): Promise<BrainAction> {
  const ts = Date.now();
  const entry: BrainAction = { ...action, id: actionId(ts), ts, status: "applied" };
  await corpusJournalAppend(JSON.stringify(entry));
  return entry;
}
