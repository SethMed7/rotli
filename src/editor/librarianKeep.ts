// The Librarian keeps the vault (2026-09-28; src/services/librarianPeople.ts):
// what a reply's vault actions do to the conversation. Additions (rules,
// groups, new people) run as soon as the reply lands and report back as lines
// under it; each change to someone who already has a note becomes a question
// with Yes and No, counted on the sidebar's Librarian badge until answered.

import type { VaultAction } from "../lib/librarianPeople";
import { answerUpdate, type KeepDeps, keepVault, liveKeepDeps } from "../services/librarianPeople";
import {
  type AskState,
  type ChatTurn,
  type TurnProtection,
  updateLibrarianChat,
  updateLibrarianTurn,
  useLibrarianBar,
} from "../state/librarianBar";

/** What a turn that read something only an on-device model may read says
 * instead of writing: your rules, People notes and this note aren't
 * protected, so nothing it produced is written to them (fifth and sixth
 * reviews of pull request 267). */
export const NOT_WRITTEN =
  "Nothing from this conversation was written: it includes notes only an on-device model can read, and your rules, People notes and this note aren’t protected. Start a new conversation to organize.";

/** A write from turn `turnId` may go ahead only while its conversation is
 * still the open one and the turn says it is unprotected. A missing or
 * replaced conversation, or a turn without its protection, writes nothing. */
function turnOf(chatId: string, turnId: string): ChatTurn | null {
  const chat = useLibrarianBar.getState().chat;
  return chat?.id === chatId ? (chat.turns.find((turn) => turn.id === turnId) ?? null) : null;
}

/** Say NOT_WRITTEN in the conversation and offer the restart that works. */
export function refuseWrite(chatId: string): void {
  updateLibrarianChat(chatId, (now) => ({ error: NOT_WRITTEN, restartWith: now.modelId }));
}

const updatesOf = (vault: readonly VaultAction[]) =>
  vault.filter((action): action is Extract<VaultAction, { type: "update" }> => action.type === "update");

/** Settle a reply's vault actions: ask about the updates, apply the rest. */
export async function settleVault(
  chatId: string,
  turnId: string,
  vault: readonly VaultAction[],
  model: string,
  protection: TurnProtection,
  deps: KeepDeps = liveKeepDeps,
): Promise<void> {
  // the conversation closed or was replaced while the reply was on its way
  if (!turnOf(chatId, turnId)) return;
  // a marked turn writes nothing unprotected: no People notes, rules or
  // groups, and no questions whose Yes would write one
  if (protection.onDeviceOnly) {
    if (vault.length === 0) return;
    updateLibrarianTurn(chatId, turnId, () => ({
      kept: { kind: "kept", lines: [{ text: NOT_WRITTEN, failed: true }] },
    }));
    refuseWrite(chatId);
    return;
  }
  const asks = updatesOf(vault).map((): AskState => ({ kind: "open" }));
  if (asks.length > 0) updateLibrarianTurn(chatId, turnId, () => ({ asks }));
  const additions = vault.filter((action) => action.type !== "update");
  if (additions.length === 0) return;
  updateLibrarianTurn(chatId, turnId, () => ({ kept: { kind: "keeping" } }));
  const lines = await keepVault(additions, model, deps);
  updateLibrarianTurn(chatId, turnId, () => ({ kept: { kind: "kept", lines } }));
}

/** The person's answer to one question about someone who has a note. */
export async function answerAsk(
  chatId: string,
  turnId: string,
  index: number,
  yes: boolean,
  deps: Pick<KeepDeps, "apply"> = liveKeepDeps,
): Promise<void> {
  const chat = useLibrarianBar.getState().chat;
  const turn = turnOf(chatId, turnId);
  const action = turn?.role === "librarian" ? updatesOf(turn.vault ?? [])[index] : undefined;
  if (!chat || !turn || !action || turn.asks?.[index]?.kind !== "open") return;
  // the turn's own protection; a turn without one counts as protected
  if (yes && turn.protection?.onDeviceOnly !== false) return refuseWrite(chatId);
  const setAsk = (ask: AskState) =>
    updateLibrarianTurn(chatId, turnId, (now) => ({
      asks: (now.asks ?? []).map((old, at) => (at === index ? ask : old)),
    }));
  if (!yes) return setAsk({ kind: "answered", yes: false, message: `Left ${action.name} as they are.` });
  setAsk({ kind: "applying" });
  try {
    const count = await answerUpdate(action, chat.modelId, deps);
    setAsk({
      kind: "answered",
      yes: true,
      message: count === 0 ? "Nothing needed changing." : `Updated ${action.name}.`,
    });
  } catch (error) {
    setAsk({ kind: "open" });
    updateLibrarianChat(chatId, () => ({ error: error instanceof Error ? error.message : String(error) }));
  }
}
