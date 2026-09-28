// Talk to the Librarian (/librarian, 2026-09-28): which pane's editor shows the
// Librarian bar in place of its format bar, and the conversation the bar pops
// out into after the first ask. Session state only: nothing here is written to
// the vault, and the conversation lasts as long as the app is open.

import { create } from "zustand";

import type { LibrarianTurn } from "../lib/librarianChat";

/** What happened to a reply's proposals: waiting, being applied, or settled. */
export type ProposalState =
  | { kind: "open"; picked: boolean[] }
  | { kind: "applying" }
  | { kind: "applied"; message: string }
  | { kind: "dismissed" };

export type ChatTurn = LibrarianTurn & {
  id: string;
  proposal?: ProposalState;
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

export function startLibrarianChat(chat: LibrarianChat): void {
  useLibrarianBar.setState({ paneId: null, chat });
}

export function closeLibrarianChat(): void {
  useLibrarianBar.setState({ chat: null });
}
