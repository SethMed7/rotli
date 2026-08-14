import { create } from "zustand";

import type { AgentQuestion } from "../ai/types";

export interface ChatImageAttachment {
  /** Root-qualified durable corpus id. */
  id: string;
  /** Original display name; never used as an authority-bearing path. */
  name: string;
  /** Session-only data URL sent to the selected vision model. */
  src: string;
}

export interface ChatDraft {
  title: string;
  message: string;
  images: ChatImageAttachment[];
  /** A model clarification is session interaction state. Keep it with the tab
   * so switching away cannot discard the choices before the user answers. */
  question: AgentQuestion | null;
  questionKey: string | null;
}

const EMPTY_CHAT_DRAFT: ChatDraft = {
  title: "",
  message: "",
  images: [],
  question: null,
  questionKey: null,
};

interface ChatDraftState {
  /**
   * Unsent composer state belongs to a tab, not to the mounted ChatSurface.
   * This store is intentionally session-only: switching tabs may unmount a
   * surface, but must never discard what the user typed or attached.
   */
  drafts: Record<string, ChatDraft>;
  setTitle: (tabId: string, title: string) => void;
  setMessage: (tabId: string, message: string) => void;
  setImages: (tabId: string, images: ChatImageAttachment[]) => void;
  setQuestion: (tabId: string, question: AgentQuestion | null, questionKey: string | null) => void;
  clear: (tabId: string) => void;
}

export function chatDraftFor(drafts: Record<string, ChatDraft>, tabId: string): ChatDraft {
  return drafts[tabId] ?? EMPTY_CHAT_DRAFT;
}

export const useChatDrafts = create<ChatDraftState>((set) => ({
  drafts: {},
  setTitle: (tabId, title) =>
    set((state) => {
      const current = chatDraftFor(state.drafts, tabId);
      if (current.title === title) return state;
      return { drafts: { ...state.drafts, [tabId]: { ...current, title } } };
    }),
  setMessage: (tabId, message) =>
    set((state) => {
      const current = chatDraftFor(state.drafts, tabId);
      if (current.message === message) return state;
      return { drafts: { ...state.drafts, [tabId]: { ...current, message } } };
    }),
  setImages: (tabId, images) =>
    set((state) => {
      const current = chatDraftFor(state.drafts, tabId);
      if (current.images === images) return state;
      return { drafts: { ...state.drafts, [tabId]: { ...current, images } } };
    }),
  setQuestion: (tabId, question, questionKey) =>
    set((state) => {
      const current = chatDraftFor(state.drafts, tabId);
      if (current.question === question && current.questionKey === questionKey) return state;
      return { drafts: { ...state.drafts, [tabId]: { ...current, question, questionKey } } };
    }),
  clear: (tabId) =>
    set((state) => {
      if (!(tabId in state.drafts)) return state;
      const { [tabId]: _cleared, ...drafts } = state.drafts;
      return { drafts };
    }),
}));
