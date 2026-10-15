// The one-time "move your Archive and Trash?" question (decision I, owner
// 2026-10-15; docs/design/vault-copy-and-obsidian-compatibility.md). A copy
// keeps the person's own top-level Archive/ and Trash/ as ordinary folders, so
// when its Librarian is on Rotli asks once whether to move their notes into
// Rotli's own sinks. Never in a folder connected in place (the Librarian never
// runs there). The answer is remembered per vault in its settings.json,
// keyed by the vault's id, so a later copy (a fresh id) is asked for itself.

import { type PersonSinks, corpusAdoptPersonSinks, corpusPersonSinks } from "../lib/finderBridge";
import { isTauri } from "../lib/tauri";
import { CORPUS_INSTANCE_ID, type MemexInstance } from "../memex/config";
import { refreshActiveVault } from "../state/activeVault";
import { flushSettingsNow } from "../state/persist";
import { useUiStore } from "../state/ui";

/** Whether this vault was already asked (either answer). */
export function personSinksAnswered(answer: string | null, vaultId: string): boolean {
  return answer !== null && answer.startsWith(`${vaultId}:`);
}

/** Whether the question may apply to the active vault: a copy (brought in,
 * not in place) with its Librarian on, not yet asked. */
export function personSinksEligible(
  instance: MemexInstance | null,
  answer: string | null,
): instance is MemexInstance {
  return (
    !!instance &&
    instance.id === CORPUS_INSTANCE_ID &&
    instance.layout === "imported" &&
    !instance.inPlace &&
    instance.brainEnabled &&
    !!instance.memexId &&
    !personSinksAnswered(answer, instance.memexId)
  );
}

/** The question's facts: null when it doesn't apply or nothing is there. */
export async function personSinksToAsk(
  instance: MemexInstance | null,
  answer: string | null,
): Promise<PersonSinks | null> {
  if (!isTauri() || !personSinksEligible(instance, answer)) return null;
  return corpusPersonSinks();
}

/** The dialog's words for what the copy has (pure; the tests read it). */
export function personSinksQuestion(sinks: PersonSinks): { title: string; line: string } {
  const both = sinks.archive > 0 && sinks.trash > 0;
  const own = both ? "Archive and Trash folders" : sinks.archive > 0 ? "Archive folder" : "Trash folder";
  const theirs = both ? "Archive and Trash" : sinks.archive > 0 ? "Archive" : "Trash";
  const treated = both ? "archived and trashed" : sinks.archive > 0 ? "archived" : "trashed";
  return {
    title: `Move your ${theirs}?`,
    line: `Your vault has its own ${own}. Move ${both ? "their" : "its"} notes into Rotli’s ${theirs} so the Librarian treats them as ${treated}?`,
  };
}

/** Answer once: Yes moves the files (then the vault refreshes); No moves
 * nothing. Either way the vault is never asked again. The answer is saved
 * before the move, so a refresh can never lose it. */
export async function answerPersonSinks(vaultId: string, move: boolean): Promise<void> {
  useUiStore.getState().setPersonSinksAnswer(`${vaultId}:${move ? "moved" : "kept"}`);
  await flushSettingsNow();
  if (!move) return;
  await corpusAdoptPersonSinks();
  await refreshActiveVault();
}
