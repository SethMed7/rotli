// Talk to the Librarian, popped out (2026-09-28; plan: docs/design/librarian-bar.md).
// After the first ask from the bar, the conversation lives here, in the pane's
// bottom-right corner, with the model the person picked. It is the Librarian,
// not a chatbot: it organizes this note (tags, marked passages, filing), each
// reply can propose changes as a checklist to apply, and anything else is
// offered to Chat ("Take this to Chat", and "Open in Chat" in the header). The
// note's words are never edited. Escape (or −) tucks it into a button in the
// same corner; × ends the conversation.

import { useEffect, useRef, useState } from "react";

import { ModelPicker } from "../components/chat/chatModelPicker";
import { ActivityGlyph } from "../components/glyphs";
import { describeLibrarianAction, type LibrarianAction } from "../lib/librarianActions";
import { useFolders } from "../services/hooks";
import type { applyLibrarian } from "../services/librarianBar";
import {
  type ChatTurn,
  closeLibrarianChat,
  type LibrarianChat as Chat,
  updateLibrarianChat,
  useLibrarianBar,
} from "../state/librarianBar";
import { usePanesStore } from "../state/panes";
import { useUiStore } from "../state/ui";
import { editorFor } from "./commands";
import {
  applyProposal,
  clip,
  type HostFor,
  librarianContext,
  libraryAreas,
  noteTitle,
  onEscapeHere,
  sendToLibrarian,
  takeToChat,
  tauriHostFor,
  useLibrarianModels,
  usePassage,
} from "./librarianSession";

/** Quick asks that keep the Librarian to its job. */
const SUGGESTIONS = ["Suggest tags", "File this note"] as const;

/** Only the pane showing the conversation's note shows the chat. */
export const chatShownIn = (chat: Chat | null, paneId: string, noteId: string): chat is Chat =>
  !!chat && chat.paneId === paneId && chat.noteId === noteId;

export function LibrarianChat({ noteId, paneId }: { noteId: string; paneId: string }) {
  const chat = useLibrarianBar((s) => s.chat);
  return chatShownIn(chat, paneId, noteId) ? <ChatPanel chat={chat} noteId={noteId} paneId={paneId} /> : null;
}

/** The chat itself, for one conversation. Tests pass a fake model and apply. */
export function ChatPanel({
  chat,
  noteId,
  paneId,
  hostFor = tauriHostFor,
  apply,
}: {
  chat: Chat;
  noteId: string;
  paneId: string;
  hostFor?: HostFor;
  apply?: typeof applyLibrarian;
}) {
  const barHere = useLibrarianBar((s) => s.paneId === paneId);
  const formatBar = useUiStore((s) => s.formatBarVisible);
  const folders = useFolders();
  const { groups, models } = useLibrarianModels();
  const model = models.find((m) => m.id === chat.modelId) ?? null;
  const passage = usePassage(paneId, !chat.minimized && !barHere);
  const [draft, setDraft] = useState("");
  const log = useRef<HTMLOListElement | null>(null);
  const box = useRef<HTMLTextAreaElement | null>(null);
  const thinking = chat.status === "thinking";

  // the newest message in view, and the composer ready to type
  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight });
  }, [chat.turns.length, thinking, chat.minimized]);
  useEffect(() => {
    if (!chat.minimized) box.current?.focus();
  }, [chat.minimized]);

  const setMinimized = (minimized: boolean) => updateLibrarianChat(chat.id, () => ({ minimized }));
  const place = barHere || formatBar ? "libchat above" : "libchat";

  if (chat.minimized)
    return (
      <button
        type="button"
        className={`${place} libchat-launch`}
        aria-label="Open the Librarian chat"
        onClick={() => setMinimized(false)}
      >
        <ActivityGlyph size={15} />
        <span>Librarian</span>
        {thinking && <span className="libchat-dot" aria-hidden="true" />}
      </button>
    );

  const send = (typed = draft) => {
    const text = typed.trim();
    if (!text || !model || thinking) return;
    if (typed === draft) setDraft("");
    const areas = libraryAreas((folders.data ?? []).map((folder) => folder.id));
    void sendToLibrarian(
      chat.id,
      { text, highlight: passage.anchor() },
      model,
      () => librarianContext(noteId, paneId, areas),
      hostFor,
    );
  };

  const pick = (id: string) => updateLibrarianChat(chat.id, () => ({ modelId: id }));
  // the question a reply answered: what "Take this to Chat" carries over
  const askedBefore = (index: number) =>
    chat.turns
      .slice(0, index)
      .reverse()
      .find((turn) => turn.role === "user") ?? null;
  const lastAsked = askedBefore(chat.turns.length);
  const toChat = (asked: ChatTurn | null, from?: string) => {
    const message = asked?.role === "user" ? { text: asked.text, highlight: asked.highlight } : null;
    void takeToChat(noteId, message).then((opened) => {
      if (opened && from)
        updateLibrarianChat(chat.id, (now) => ({
          turns: now.turns.map((t) => (t.id === from ? { ...t, handedOff: true } : t)),
        }));
    });
  };

  return (
    <section
      className={place}
      role="dialog"
      aria-label="Librarian chat"
      onKeyDown={(event) => onEscapeHere(event, () => setMinimized(true))}
    >
      <header className="libchat-head">
        <ActivityGlyph size={15} />
        <strong>Librarian</strong>
        <span className="libchat-role">organizes this note</span>
        <span className="libchat-grow" />
        <button
          type="button"
          className="libbar-link libchat-tochat"
          title="The Librarian only organizes. Ask anything else in Chat."
          onClick={() => toChat(lastAsked)}
        >
          Open in Chat
        </button>
        <button
          type="button"
          className="libchat-icon"
          aria-label="Minimize the Librarian chat"
          onClick={() => setMinimized(true)}
        >
          −
        </button>
        <button
          type="button"
          className="libchat-icon"
          aria-label="End the conversation"
          onClick={closeLibrarianChat}
        >
          ×
        </button>
      </header>

      <ol className="libchat-log" ref={log} aria-live="polite">
        {chat.turns.map((turn, index) => (
          <Turn
            key={turn.id}
            turn={turn}
            onTakeToChat={() => toChat(askedBefore(index), turn.id)}
            onPick={(picked) =>
              updateLibrarianChat(chat.id, (now) => ({
                turns: now.turns.map((t) =>
                  t.id === turn.id ? { ...t, proposal: { kind: "open", picked } } : t,
                ),
              }))
            }
            onDismiss={() =>
              updateLibrarianChat(chat.id, (now) => ({
                turns: now.turns.map((t) =>
                  t.id === turn.id ? { ...t, proposal: { kind: "dismissed" } } : t,
                ),
              }))
            }
            onApply={(actions) =>
              void applyProposal(
                chat.id,
                turn.id,
                actions,
                {
                  id: noteId,
                  title: noteTitle(editorFor(paneId)?.getSelection?.()?.doc ?? ""),
                  model: chat.modelId,
                },
                apply,
              )
            }
          />
        ))}
        {thinking && (
          <li className="libchat-turn lib libchat-thinking" aria-label="The Librarian is thinking">
            <span />
            <span />
            <span />
          </li>
        )}
      </ol>
      {chat.error && (
        <p className="libbar-note err libchat-error" role="alert">
          {chat.error}
        </p>
      )}

      <form
        className="libchat-compose"
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        {!thinking && (
          <div className="libchat-suggest" role="group" aria-label="Quick asks">
            {[...SUGGESTIONS, ...(passage.text ? ["Mark the highlighted passage"] : [])].map((ask) => (
              <button
                key={ask}
                type="button"
                className="libchat-pill"
                disabled={!model}
                onClick={() => send(ask)}
              >
                {ask}
              </button>
            ))}
          </div>
        )}
        <span className="libchat-about" title={passage.text || undefined}>
          {passage.text
            ? `About “${clip(passage.text)}”`
            : "About the whole note · highlight a passage to ask about it"}
        </span>
        <div className="libchat-row">
          <textarea
            ref={box}
            className="libbar-input libchat-input"
            aria-label="Message the Librarian"
            placeholder={model ? "Tag, mark or file this note…" : "Connect a model in Settings"}
            rows={Math.min(5, Math.max(1, draft.split("\n").length))}
            value={draft}
            onChange={(event) => setDraft(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
              event.preventDefault();
              send();
            }}
          />
          <button type="submit" className="rename-btn primary" disabled={!draft.trim() || !model || thinking}>
            Send
          </button>
        </div>
        {models.length > 0 && (
          <div className="libchat-model">
            <ModelPicker groups={groups} picked={model} onPick={pick} />
          </div>
        )}
      </form>
    </section>
  );
}

function Turn({
  turn,
  onTakeToChat,
  onPick,
  onDismiss,
  onApply,
}: {
  turn: ChatTurn;
  onTakeToChat: () => void;
  onPick: (picked: boolean[]) => void;
  onDismiss: () => void;
  onApply: (actions: LibrarianAction[]) => void;
}) {
  if (turn.role === "user")
    return (
      <li className="libchat-turn you">
        {turn.highlight && <q className="libchat-quote">{clip(turn.highlight.exact, 90)}</q>}
        <p>{turn.text}</p>
      </li>
    );
  const proposal = turn.proposal;
  return (
    <li className="libchat-turn lib">
      {turn.text.split(/\n{2,}/).map((paragraph, index) => (
        <p key={`${index}:${paragraph.slice(0, 24)}`}>{paragraph}</p>
      ))}
      {turn.handoff && (
        <button
          type="button"
          className="rename-btn libchat-handoff"
          disabled={turn.handedOff}
          onClick={onTakeToChat}
        >
          {turn.handedOff ? "Opened in Chat" : "Take this to Chat"}
        </button>
      )}
      {proposal && proposal.kind !== "dismissed" && (
        <div className="libchat-card">
          {proposal.kind === "open" && (
            <>
              <ul>
                {turn.actions.map((action, index) => (
                  <li key={describeLibrarianAction(action)}>
                    <label>
                      <input
                        type="checkbox"
                        checked={proposal.picked[index] ?? false}
                        onChange={() => onPick(proposal.picked.map((on, at) => (at === index ? !on : on)))}
                      />
                      {describeLibrarianAction(action)}
                    </label>
                  </li>
                ))}
              </ul>
              <div className="libbar-row">
                <button type="button" className="rename-btn" onClick={onDismiss}>
                  Not now
                </button>
                <button
                  type="button"
                  className="rename-btn primary"
                  disabled={!proposal.picked.some(Boolean)}
                  onClick={() => onApply(turn.actions.filter((_, index) => proposal.picked[index]))}
                >
                  Apply
                </button>
              </div>
            </>
          )}
          {proposal.kind === "applying" && <p className="libbar-note">Applying…</p>}
          {proposal.kind === "applied" && (
            <p className="libbar-note" role="status">
              {proposal.message}
              <button
                type="button"
                className="libbar-link"
                onClick={() => usePanesStore.getState().openActivity()}
              >
                Undo in Librarian Activity
              </button>
            </p>
          )}
        </div>
      )}
    </li>
  );
}
