// The Librarian keeps the vault (2026-09-28; src/services/librarianPeople.ts):
// what a reply's vault actions do to the conversation. Additions (rules,
// groups, new people) run as soon as the reply lands and report back as lines
// under it; each change to someone who already has a note becomes a question
// with Yes and No, counted on the sidebar's Librarian badge until answered.

import type { VaultAction } from "../lib/librarianPeople";
import { answerUpdate, type KeepDeps, keepVault, liveKeepDeps } from "../services/librarianPeople";
import {
  type AskState,
  updateLibrarianChat,
  updateLibrarianTurn,
  useLibrarianBar,
} from "../state/librarianBar";

/** What a conversation that carries the on-device-only mark says instead of
 * writing: your rules, People notes and this note aren't protected, so
 * nothing it produced is written to them (fifth review of pull request 267). */
export const NOT_WRITTEN =
  "Nothing from this conversation was written: it includes notes only an on-device model can read, and your rules, People notes and this note aren’t protected. Start a new conversation to organize.";

/** Does conversation `chatId` carry the on-device-only mark? */
export const markedConversation = (chatId: string): boolean => {
  const chat = useLibrarianBar.getState().chat;
  return chat?.id === chatId && chat.onDeviceOnly === true;
};

const updatesOf = (vault: readonly VaultAction[]) =>
  vault.filter((action): action is Extract<VaultAction, { type: "update" }> => action.type === "update");

/** Settle a reply's vault actions: ask about the updates, apply the rest. */
export async function settleVault(
  chatId: string,
  turnId: string,
  vault: readonly VaultAction[],
  model: string,
  deps: KeepDeps = liveKeepDeps,
): Promise<void> {
  // a marked conversation writes nothing unprotected: no People notes, rules
  // or groups, and no questions whose Yes would write one
  if (markedConversation(chatId)) {
    if (vault.length > 0)
      updateLibrarianTurn(chatId, turnId, () => ({
        kept: { kind: "kept", lines: [{ text: NOT_WRITTEN, failed: true }] },
      }));
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
  const turn = chat?.id === chatId ? chat.turns.find((t) => t.id === turnId) : undefined;
  const action = turn?.role === "librarian" ? updatesOf(turn.vault ?? [])[index] : undefined;
  if (!chat || !action || turn?.asks?.[index]?.kind !== "open") return;
  if (yes && markedConversation(chatId)) {
    updateLibrarianChat(chatId, () => ({ error: NOT_WRITTEN }));
    return;
  }
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
