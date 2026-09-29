// What the Librarian kept in the vault, under its reply (2026-09-28;
// librarianKeep.ts): the lines of what it added (rules, groups, new people),
// and a question for each person who already has a note, with Yes and No.

import { describeUpdate, type VaultAction } from "../lib/librarianPeople";
import type { ChatTurn } from "../state/librarianBar";
import { usePanesStore } from "../state/panes";

export function KeptCards({
  turn,
  onAnswer,
}: {
  turn: ChatTurn;
  onAnswer: (index: number, yes: boolean) => void;
}) {
  if (turn.role !== "librarian") return null;
  const updates = (turn.vault ?? []).filter(
    (action): action is Extract<VaultAction, { type: "update" }> => action.type === "update",
  );
  const kept = turn.kept;
  return (
    <>
      {kept && (
        <div className="libchat-card libchat-kept" role="status">
          {kept.kind === "keeping" ? (
            <p className="libbar-note">Adding…</p>
          ) : (
            <>
              <ul>
                {kept.lines.map((line) => (
                  <li key={line.text} className={line.failed ? "err" : undefined}>
                    {line.text}
                  </li>
                ))}
              </ul>
              <button
                type="button"
                className="libbar-link"
                onClick={() => usePanesStore.getState().openActivity()}
              >
                See or undo in Librarian Activity
              </button>
            </>
          )}
        </div>
      )}
      {updates.map((action, index) => {
        const ask = turn.asks?.[index];
        return (
          <div key={action.noteId} className="libchat-card libchat-ask">
            <p>{describeUpdate(action)}</p>
            {ask?.kind === "open" && (
              <div className="libbar-row">
                <button type="button" className="rename-btn" onClick={() => onAnswer(index, false)}>
                  No
                </button>
                <button type="button" className="rename-btn primary" onClick={() => onAnswer(index, true)}>
                  Yes
                </button>
              </div>
            )}
            {ask?.kind === "applying" && <p className="libbar-note">Updating…</p>}
            {ask?.kind === "answered" && (
              <p className="libbar-note" role="status">
                {ask.message}
              </p>
            )}
          </div>
        );
      })}
    </>
  );
}
