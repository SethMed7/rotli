// Talk to the Librarian, popped out (2026-09-28; plan: docs/design/librarian-bar.md).
// After the first ask from the bar, the conversation lives here, in the pane's
// bottom-right corner, with the model the person picked. It is the Librarian,
// not a chatbot: it organizes this note (tags, marked passages, filing), each
// reply can propose changes as a checklist to apply, and anything else is
// offered to Chat ("Take this to Chat", and "Open in Chat" in the header). The
// note's words are never edited. Escape (or −) tucks it into a button in the
// same corner; × ends the conversation.
//
// The Librarian pill (2026-09-28, the owner: "it needs to look like it is
// coming out of something … to the left of the arrow"; then "only show if the
// user runs /librarian"): once a conversation exists it sits in the corner
// beside the scroll-to-top arrow and opens and closes the panel, which grows
// out of it.

import { useEffect, useRef, useState } from "react";

import { ModelPicker } from "../components/chat/chatModelPicker";
import { ActivityGlyph } from "../components/glyphs";
import {
  describeAppliedAction,
  describeLibrarianAction,
  type LibrarianAction,
} from "../lib/librarianActions";
import { useFolders } from "../services/hooks";
import { type applyLibrarian, LIBRARIAN_REFUSALS } from "../services/librarianBar";
import {
  type ChatTurn,
  closeLibrarianChat,
  type LibrarianChat as Chat,
  librarianQuestions,
  updateLibrarianChat,
  updateLibrarianTurn,
  useLibrarianBar,
} from "../state/librarianBar";
import { usePanesStore } from "../state/panes";
import { useUiStore } from "../state/ui";
import { editorFor } from "./commands";
import { answerAsk } from "./librarianKeep";
import { KeptCards } from "./librarianKeepCards";
import {
  useEscapeCloses,
  applyProposal,
  clip,
  type HostFor,
  librarianContext,
  libraryAreas,
  noteTitle,
  onEscapeHere,
  refusalNow,
  sendToLibrarian,
  takeToChat,
  tauriHostFor,
  useLibrarianModels,
  usePassage,
  usePeopleNotes,
} from "./librarianSession";

/** Quick asks that keep the Librarian to its job. */
const SUGGESTIONS = ["Suggest tags", "File this note"] as const;

/** Only the pane showing the conversation's note shows the chat. */
export const chatShownIn = (chat: Chat | null, paneId: string, noteId: string): chat is Chat =>
  !!chat && chat.paneId === paneId && chat.noteId === noteId;

/** Whether the corner lane holds the Librarian pill (scrollTopLane.ts): only
 * while a /librarian conversation is open somewhere. */
export const librarianLane = (): boolean =>
  useUiStore.getState().brainEnabled && !!useLibrarianBar.getState().chat;

export function LibrarianChat({ noteId, paneId }: { noteId: string; paneId: string }) {
  const chat = useLibrarianBar((s) => s.chat);
  const librarianOn = useUiStore((s) => s.brainEnabled);
  const here = chatShownIn(chat, paneId, noteId) ? chat : null;
  // only once the person has run /librarian here (the owner, 2026-09-28)
  if (!librarianOn || !here) return null;
  return <LibrarianCorner here={here} noteId={noteId} paneId={paneId} />;
}

/** The corner for one conversation: the pill, and the panel above it when
 * open (tests render it directly). */
export function LibrarianCorner({ here, noteId, paneId }: { here: Chat; noteId: string; paneId: string }) {
  const open = !here.minimized;
  const waiting = librarianQuestions(here);
  return (
    <>
      {open && <ChatPanel chat={here} noteId={noteId} paneId={paneId} />}
      <button
        type="button"
        className={open ? "libchat-launch open" : "libchat-launch"}
        aria-label={open ? "Hide the Librarian" : "Open the Librarian"}
        aria-expanded={open}
        title="The Librarian organizes this note: tags, marked passages, filing, people"
        onClick={() => updateLibrarianChat(here.id, () => ({ minimized: open }))}
      >
        <ActivityGlyph size={15} />
        <span>Librarian</span>
        {(here.status === "thinking" || waiting > 0) && <span className="libchat-dot" aria-hidden="true" />}
      </button>
    </>
  );
}

/** Why the Librarian can't take this note (web, off, locked, secure, outside
 * the Library), null when it can, or undefined while that is still being
 * checked (nothing can be sent until it is known). Each send asks again. */
function useRefusal(noteId: string, paneId: string, turns: number): string | null | undefined {
  const librarianOn = useUiStore((s) => s.brainEnabled);
  const [refusal, setRefusal] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void refusalNow(noteId, paneId).then(
      (message) => live && setRefusal(message),
      () => live && setRefusal(LIBRARIAN_REFUSALS.locked),
    );
    return () => {
      live = false;
    };
  }, [noteId, paneId, librarianOn, turns]);
  return refusal;
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
  const refusal = useRefusal(noteId, paneId, chat.turns.length);
  // undefined while the check runs: nothing is sendable until it is known
  const blocked = refusal !== null;
  const folders = useFolders();
  const { groups, models } = useLibrarianModels();
  const known = usePeopleNotes();
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
  useEscapeCloses(() => setMinimized(true));

  const send = (typed = draft) => {
    const text = typed.trim();
    if (!text || !model || thinking || blocked) return;
    if (typed === draft) setDraft("");
    const areas = libraryAreas((folders.data ?? []).map((folder) => folder.id));
    void sendToLibrarian(
      chat.id,
      { text, highlight: passage.anchor() },
      model,
      () => librarianContext(noteId, paneId, areas, known),
      () => refusalNow(noteId, paneId),
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
      if (opened && from) updateLibrarianTurn(chat.id, from, () => ({ handedOff: true }));
    });
  };

  return (
    <section
      className="libchat"
      role="dialog"
      aria-label="Librarian chat"
      onKeyDown={(event) => onEscapeHere(event, () => setMinimized(true))}
    >
      <header className="libchat-head">
        <ActivityGlyph size={15} />
        <strong>Librarian</strong>
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
        {refusal && (
          <li className="libchat-turn lib" role="status">
            <p>{refusal}</p>
          </li>
        )}
        {!refusal && chat.turns.length === 0 && (
          <li className="libchat-turn lib libchat-hello">
            <p>
              Tell me how to organize this note: tag it, mark a passage, file it, or tell me about the people
              in it.
            </p>
          </li>
        )}
        {chat.turns.map((turn, index) => (
          <Turn
            key={turn.id}
            turn={turn}
            onTakeToChat={() => toChat(askedBefore(index), turn.id)}
            onPick={(picked) =>
              updateLibrarianTurn(chat.id, turn.id, () => ({ proposal: { kind: "open", picked } }))
            }
            onDismiss={() =>
              updateLibrarianTurn(chat.id, turn.id, () => ({ proposal: { kind: "dismissed" } }))
            }
            onAnswer={(index, yes) => void answerAsk(chat.id, turn.id, index, yes, apply && { apply })}
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
        className={blocked ? "libchat-compose off" : "libchat-compose"}
        aria-disabled={blocked}
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        {!thinking && !refusal && (
          <div className="libchat-suggest" role="group" aria-label="Quick asks">
            {[...SUGGESTIONS, ...(passage.text ? ["Mark the highlighted passage"] : [])].map((ask) => (
              <button
                key={ask}
                type="button"
                className="libchat-pill"
                disabled={!model || blocked}
                onClick={() => send(ask)}
              >
                {ask}
              </button>
            ))}
          </div>
        )}
        <div className="libchat-row">
          <textarea
            ref={box}
            className="libbar-input libchat-input"
            aria-label="Message the Librarian"
            placeholder={
              model ? "Tag or file this note, or tell me about people…" : "Connect a model in Settings"
            }
            rows={Math.min(5, Math.max(1, draft.split("\n").length))}
            value={draft}
            disabled={blocked}
            onChange={(event) => setDraft(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
              event.preventDefault();
              send();
            }}
          />
          <button
            type="submit"
            className="rename-btn primary"
            disabled={!draft.trim() || !model || thinking || blocked}
          >
            Send
          </button>
        </div>
        <div className="libchat-meta">
          <span className="libchat-about" title={passage.text || undefined}>
            {passage.text
              ? `About “${clip(passage.text)}”`
              : "About the whole note · highlight to ask about a passage"}
          </span>
          {models.length > 0 && <ModelPicker groups={groups} picked={model} onPick={pick} />}
        </div>
        <p className="libchat-note">
          The Librarian only organizes: tags, marked passages, filing, and people. It doesn’t chat. For
          anything else, use Open in Chat.
        </p>
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
  onAnswer,
}: {
  turn: ChatTurn;
  onTakeToChat: () => void;
  onPick: (picked: boolean[]) => void;
  onDismiss: () => void;
  onApply: (actions: LibrarianAction[]) => void;
  onAnswer: (index: number, yes: boolean) => void;
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
          {proposal.kind === "applied" && (proposal.done?.length ?? 0) > 0 && (
            <ul className="libchat-done" aria-label="What changed">
              {proposal.done!.map((action) => (
                <li key={describeAppliedAction(action)}>{describeAppliedAction(action)}</li>
              ))}
            </ul>
          )}
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
      <KeptCards turn={turn} onAnswer={onAnswer} />
    </li>
  );
}
