// What the Librarian session tests share: a remote model, a note, its gated
// context, a fresh conversation, and a model that records what it was sent
// (split out of librarianSession.test.ts, fourth review of pull request 267).

import type { CompleteReq } from "../ai/types";
import type { LibrarianContext } from "../lib/librarianChat";
import { DEFAULT_LIBRARIAN_RULES } from "../lib/librarianRules";
import { approved, person } from "../lib/promptText.fixtures";
import type { ChatModelInfo } from "../lib/tauri";
import { startLibrarianChat } from "../state/librarianBar";

export const MODEL: ChatModelInfo = {
  id: "claude-opus",
  label: "Claude Opus",
  provider: "claude",
  endpoint: "",
  api: "cli",
  vision: false,
  isDefault: false,
};
export const NOTE = "# Maya Chen\n\nMet Maya at the design meetup.";
export const context = async (): Promise<LibrarianContext> => ({
  onDeviceOnly: false,
  title: approved("Maya Chen"),
  doc: approved(NOTE),
  areas: [approved("people")],
  tags: [],
  people: [person("People")],
  filing: [],
  rules: structuredClone(DEFAULT_LIBRARIAN_RULES),
  known: [],
});
export const HIGHLIGHT = { exact: "design meetup", prefix: "Met Maya at the ", suffix: "." };

export function start(id = "chat-1") {
  startLibrarianChat({
    id,
    paneId: "p1",
    noteId: "n1",
    modelId: MODEL.id,
    turns: [],
    status: "idle",
    error: null,
    minimized: false,
  });
}

/** A model that answers with `reply` and remembers what it was sent. */
export function fakeModel(reply: string | (() => Promise<string>)) {
  const sent: CompleteReq["messages"][] = [];
  return {
    sent,
    hostFor: () => ({
      complete: async ({ messages }: CompleteReq) => {
        sent.push(messages);
        return typeof reply === "string" ? reply : reply();
      },
    }),
  };
}

/** A refusal check that lets every send through. */
export const allow = async () => null;
