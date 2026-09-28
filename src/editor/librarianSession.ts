// Talk to the Librarian (`/librarian`, 2026-09-28; plan: docs/design/librarian-bar.md):
// what the bar and the popped-out chat share — the models to pick from, the
// passage the person highlighted (kept painted while they type), and sending a
// turn or applying a reply's proposals. The conversation itself lives in
// state/librarianBar.ts, so it outlives the bar that started it.

import { useQuery } from "@tanstack/react-query";
import { type KeyboardEvent, useEffect, useMemo, useState } from "react";

import { makeTauriHost } from "../ai/host";
import { librarianModelFor } from "../ai/librarianLane";
import { mergedModels } from "../ai/models";
import type { Host } from "../ai/types";
import { type Anchor, anchorFromSelection, type LibrarianAction } from "../lib/librarianActions";
import type { LibrarianContext } from "../lib/librarianChat";
import { type PersonNote, peopleNotes } from "../lib/librarianPeople";
import { peopleAreas } from "../lib/librarianRules";
import { type ChatModelInfo, chatModels, isTauri } from "../lib/tauri";
import { openChatForNoteId } from "../noteChat/composition";
import { useConnectedLanes } from "../services/connectedModels";
import { useNoteIndex } from "../services/hooks";
import { applyLibrarian, converseLibrarian, currentTags, LIBRARIAN_REFUSALS } from "../services/librarianBar";
import { useChatDrafts } from "../state/chatDrafts";
import {
  type ChatTurn,
  type ProposalState,
  updateLibrarianChat,
  updateLibrarianTurn,
  useLibrarianBar,
} from "../state/librarianBar";
import { useLibrarianRules } from "../state/librarianRules";
import { usePanesStore } from "../state/panes";
import { findLeaf } from "../state/paneTree";
import { useUiStore } from "../state/ui";
import { editorFor } from "./commands";
import { settleVault } from "./librarianKeep";

/** Escape inside the bar or the chat (not in the portaled model picker, whose
 * own Escape closes only its list): claim it and run `then`. */
export function onEscapeHere(event: KeyboardEvent<HTMLElement>, then: () => void): void {
  if (event.key !== "Escape" || event.defaultPrevented) return;
  if (!event.currentTarget.contains(event.target as Node)) return;
  event.preventDefault();
  event.stopPropagation();
  then();
}

/** A passage shortened for a chip. */
export const clip = (text: string, max = 48) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

export function noteTitle(doc: string): string {
  const first = doc.split("\n").find((line) => line.trim()) ?? "";
  return first.replace(/^#+\s+/, "").trim() || "Untitled";
}

/** The Library's areas: the top-level folders under wiki/, minus its lanes. */
export function libraryAreas(folderIds: readonly string[]): string[] {
  return folderIds
    .map((id) => /^wiki\/([^/]+)$/.exec(id)?.[1])
    .filter((name): name is string => !!name && !name.startsWith("_"));
}

/** The models the person has connected (grouped the way the chat's picker
 * shows them, without routing presets), and the Librarian's own choice. */
export function useLibrarianModels() {
  const aiProviders = useUiStore((s) => s.aiProviders);
  const blockedModels = useUiStore((s) => s.blockedModels);
  const providerDefaults = useUiStore((s) => s.providerDefaults);
  const organizerModel = useUiStore((s) => s.organizerModel);
  const organizerModelId = useUiStore((s) => s.organizerModelId);
  const local = useQuery({
    queryKey: ["chat", "models"],
    queryFn: () => (isTauri() ? chatModels() : Promise.resolve([])),
    staleTime: Infinity,
  });
  const lanes = useConnectedLanes(aiProviders, isTauri());
  const groups = mergedModels(local.data ?? [], aiProviders, [], blockedModels, lanes.ready, lanes.lanes);
  const models = [...groups.local, ...groups.connected];
  const preferred =
    organizerModel === "local"
      ? (groups.local.find((m) => m.localDefault) ?? groups.local[0])?.id
      : librarianModelFor(organizerModel, organizerModelId, providerDefaults, lanes.lanes);
  return { groups, models, preferred };
}

/** The people the vault already has notes for (what a statement is checked
 * against, so someone known is asked about rather than added twice). */
export function usePeopleNotes(): PersonNote[] {
  const index = useNoteIndex();
  return useMemo(() => peopleNotes(index.values()), [index]);
}

export interface Passage {
  /** The highlighted words ("" when nothing is highlighted). */
  text: string;
  /** The pointer to send with a question, read from the editor right now. */
  anchor: () => Anchor | null;
}

/** The live highlight in a pane's editor. CodeMirror keeps its selection when
 * focus moves into the Librarian, but the browser stops painting it, so the
 * passage is painted as a mark until the Librarian closes. */
export function usePassage(paneId: string, paint = true): Passage {
  const [text, setText] = useState("");
  useEffect(() => {
    const read = () => {
      const editor = editorFor(paneId);
      const current = editor?.getSelection?.();
      const has = !!current && current.to > current.from;
      setText(has ? current.doc.slice(current.from, current.to) : "");
      if (paint) editor?.markPassage?.(has ? { from: current.from, to: current.to } : null);
    };
    read();
    const events = ["selectionchange", "mouseup", "keyup"] as const;
    for (const name of events) document.addEventListener(name, read);
    return () => {
      for (const name of events) document.removeEventListener(name, read);
      editorFor(paneId)?.markPassage?.(null);
    };
  }, [paneId, paint]);
  return {
    text,
    anchor: () => {
      const current = editorFor(paneId)?.getSelection?.();
      return current ? anchorFromSelection(current.doc, current.from, current.to) : null;
    },
  };
}

/** The note as it is right now, for a turn. */
export async function librarianContext(
  noteId: string,
  paneId: string,
  areas: readonly string[],
  known: readonly PersonNote[] = [],
): Promise<LibrarianContext> {
  const doc = editorFor(paneId)?.getSelection?.()?.doc ?? "";
  const { rules } = useLibrarianRules.getState();
  return {
    title: noteTitle(doc),
    doc,
    areas,
    tags: await currentTags(noteId),
    people: peopleAreas(rules),
    filing: rules.filing,
    rules,
    known,
  };
}

export type HostFor = (model: ChatModelInfo) => Pick<Host, "complete">;

/** Remote lanes are refused secure content before this is ever called (the
 * Librarian refuses secure notes outright); the flag is a backstop. */
export const tauriHostFor: HostFor = (model) => makeTauriHost(model, { isSecureContext: () => false });

const newTurnId = () => crypto.randomUUID();

/** Send the person's message: it joins the conversation, the model answers
 * with the whole conversation in hand, and the reply (with anything it
 * proposes) joins after it. A chat closed meanwhile simply drops the reply. */
export async function sendToLibrarian(
  chatId: string,
  message: { text: string; highlight: Anchor | null },
  model: ChatModelInfo,
  context: () => Promise<LibrarianContext>,
  hostFor: HostFor = tauriHostFor,
): Promise<void> {
  const chat = useLibrarianBar.getState().chat;
  if (chat?.id !== chatId || chat.status === "thinking") return;
  const turns: ChatTurn[] = [...chat.turns, { id: newTurnId(), role: "user", ...message }];
  updateLibrarianChat(chatId, () => ({ turns, status: "thinking", error: null, modelId: model.id }));
  try {
    const reply = await converseLibrarian(await context(), turns, hostFor(model));
    if (reply.kind === "secret") {
      updateLibrarianChat(chatId, () => ({ status: "idle", error: LIBRARIAN_REFUSALS.secret }));
      return;
    }
    const answer: ChatTurn = {
      id: newTurnId(),
      role: "librarian",
      text:
        reply.prose ||
        (reply.actions.length > 0 || reply.vault.length > 0
          ? "Here’s what I’d change:"
          : reply.handoff
            ? "That’s one for Chat. I only organize this note."
            : "I don’t have an answer for that. Try asking another way."),
      raw: reply.raw,
      actions: reply.actions,
      ...(reply.handoff && { handoff: true }),
      ...(reply.actions.length > 0 && {
        proposal: { kind: "open" as const, picked: reply.actions.map(() => true) },
      }),
      ...(reply.vault.length > 0 && { vault: reply.vault }),
    };
    updateLibrarianChat(chatId, (now) => ({ turns: [...now.turns, answer], status: "idle" }));
    await settleVault(chatId, answer.id, reply.vault, model.id);
  } catch (error) {
    updateLibrarianChat(chatId, () => ({
      status: "idle",
      error: error instanceof Error ? error.message : String(error),
    }));
  }
}

/** Apply the picked proposals of one reply. The note's words are never
 * edited; every change is journaled, so Librarian Activity can undo it. */
export async function applyProposal(
  chatId: string,
  turnId: string,
  actions: readonly LibrarianAction[],
  note: { id: string; title: string; model: string },
  apply: typeof applyLibrarian = applyLibrarian,
): Promise<void> {
  const setProposal = (proposal: ProposalState) => updateLibrarianTurn(chatId, turnId, () => ({ proposal }));
  const before = useLibrarianBar.getState().chat?.turns.find((turn) => turn.id === turnId)?.proposal;
  setProposal({ kind: "applying" });
  try {
    const count = await apply(actions, note);
    setProposal({
      kind: "applied",
      message:
        count === 0 ? "Nothing needed changing." : `${count === 1 ? "1 change" : `${count} changes`} made.`,
      done: count === 0 ? [] : [...actions],
    });
  } catch (error) {
    if (before) setProposal(before);
    updateLibrarianChat(chatId, () => ({ error: error instanceof Error ? error.message : String(error) }));
  }
}

/** What "Take this to Chat" types into the new chat: the question, and the
 * passage it was about. */
export function chatDraft(message: { text: string; highlight: Anchor | null } | null): string {
  if (!message) return "";
  return message.highlight ? `About “${message.highlight.exact}”:\n\n${message.text}` : message.text;
}

/** The Librarian only organizes; anything else belongs in Chat. Open a new
 * chat about this note, in a new tab, with the question already typed (sent
 * only when the person sends it). */
export async function takeToChat(
  noteId: string,
  message: { text: string; highlight: Anchor | null } | null,
  open: typeof openChatForNoteId = openChatForNoteId,
): Promise<boolean> {
  const tabsNow = () => {
    const panes = usePanesStore.getState();
    return findLeaf(panes.root, panes.focusedPaneId)?.tabs ?? [];
  };
  const before = new Set(tabsNow().map((tab) => tab.id));
  if (!(await open(noteId, { create: true }))) return false;
  // the draft goes to the chat tab this just opened; if a detached chat window
  // took the chat instead, there is no new tab here and nothing is typed
  const opened = tabsNow().find((tab) => !before.has(tab.id) && tab.surfaceKind === "chat");
  const draft = chatDraft(message);
  if (opened && draft) useChatDrafts.getState().setMessage(opened.id, draft);
  return true;
}
