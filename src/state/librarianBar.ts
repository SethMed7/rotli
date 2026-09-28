// Talk to the Librarian (/librarian, 2026-09-28): which pane's editor shows the
// Librarian bar in place of its format bar, and the conversation the bar pops
// out into after the first ask. Session state only: nothing here is written to
// the vault, and the conversation lasts as long as the app is open. It also
// counts the Librarian's open questions, for the badge on the sidebar's
// Librarian button (the owner, 2026-09-28: "Anytime the librarian has a
// question we should see a badge").

import { create } from "zustand";

import type { LibrarianTurn } from "../lib/librarianChat";
import type { KeptLine } from "../lib/librarianPeople";
import { usePanesStore } from "./panes";

/** What happened to a reply's proposals: waiting, being applied, or settled. */
export type ProposalState =
  | { kind: "open"; picked: boolean[] }
  | { kind: "applying" }
  | { kind: "applied"; message: string }
  | { kind: "dismissed" };

/** A question about someone who already has a note: waiting, being
 * applied, or answered. */
export type AskState =
  | { kind: "open" }
  | { kind: "applying" }
  | { kind: "answered"; yes: boolean; message: string };

export type ChatTurn = LibrarianTurn & {
  id: string;
  proposal?: ProposalState;
  /** What the reply's vault additions came to (rules, groups, new people). */
  kept?: { kind: "keeping" } | { kind: "kept"; lines: KeptLine[] };
  /** One per `update` in the reply's vault actions, in order. */
  asks?: AskState[];
  /** "Take this to Chat" was used on this reply (it opens one chat, once). */
  handedOff?: boolean;
};

export interface LibrarianChat {
  /** One conversation at a time, about one note, shown in one pane. */
  id: string;
  paneId: string;
  noteId: string;
  modelId: string;
  turns: ChatTurn[];
  status: "idle" | "thinking";
  error: string | null;
  minimized: boolean;
}

export const useLibrarianBar = create<{ paneId: string | null; chat: LibrarianChat | null }>(() => ({
  paneId: null,
  chat: null,
}));

export function openLibrarianBar(paneId: string): void {
  useLibrarianBar.setState({ paneId });
}

export function closeLibrarianBar(): void {
  useLibrarianBar.setState({ paneId: null });
}

/** Change the open conversation — only if it is still the one `id` names, so a
 * reply that lands after the chat was closed or restarted goes nowhere. */
export function updateLibrarianChat(
  id: string,
  change: (chat: LibrarianChat) => Partial<LibrarianChat>,
): void {
  const chat = useLibrarianBar.getState().chat;
  if (chat?.id === id) useLibrarianBar.setState({ chat: { ...chat, ...change(chat) } });
}

/** Change one turn of the open conversation (same rule: only if it's still
 * the conversation `id` names). */
export function updateLibrarianTurn(
  id: string,
  turnId: string,
  change: (turn: ChatTurn) => Partial<ChatTurn>,
): void {
  updateLibrarianChat(id, (chat) => ({
    turns: chat.turns.map((turn) => (turn.id === turnId ? ({ ...turn, ...change(turn) } as ChatTurn) : turn)),
  }));
}

export function startLibrarianChat(chat: LibrarianChat): void {
  useLibrarianBar.setState({ paneId: null, chat });
}

export function closeLibrarianChat(): void {
  useLibrarianBar.setState({ chat: null });
}

/** The Librarian's open questions in a conversation: proposals and
 * questions about people waiting for an answer, and a reply that ends by
 * asking something the person hasn't answered yet. */
export function librarianQuestions(chat: LibrarianChat | null): number {
  if (!chat) return 0;
  let open = 0;
  for (const turn of chat.turns) {
    if (turn.proposal?.kind === "open") open++;
    open += (turn.asks ?? []).filter((ask) => ask.kind === "open").length;
  }
  const last = chat.turns.at(-1);
  const asking =
    chat.status === "idle" &&
    last?.role === "librarian" &&
    last.proposal?.kind !== "open" &&
    !(last.asks ?? []).some((ask) => ask.kind === "open") &&
    last.text.trim().endsWith("?");
  return open + (asking ? 1 : 0);
}

/** Bring the conversation back into view: its note in its pane (or the
 * focused one, if that pane has closed), the chat open. */
export function showLibrarianChat(): void {
  const chat = useLibrarianBar.getState().chat;
  if (!chat) return;
  const panes = usePanesStore.getState();
  panes.focusPane(chat.paneId);
  panes.openNote(chat.noteId);
  const paneId = usePanesStore.getState().focusedPaneId;
  updateLibrarianChat(chat.id, () => ({ paneId, minimized: false }));
}
