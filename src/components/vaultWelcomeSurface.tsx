import { useState } from "react";

import { dispatch } from "../keys/registry";
import { createNamedMarkdownItem } from "../newItems/composition";
import { Character } from "./character";
import { ChatGlyph, SearchGlyph } from "./glyphs";
import { FIRST_NOTE_TITLE_MAX, firstNoteBody } from "./onboarding/vaultWelcomeModel";

export function VaultWelcomeSurface() {
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const body = firstNoteBody(title);

  const create = async () => {
    if (!body || busy) return;
    setBusy(true);
    setError(null);
    try {
      await createNamedMarkdownItem(body);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
    }
  };

  return (
    <section className="vault-welcome" aria-labelledby="vault-welcome-title">
      <div className="vault-welcome-inner">
        <Character name="notes" size={104} />
        <p className="vault-welcome-eyebrow">Your vault is ready</p>
        <h1 id="vault-welcome-title">Start without clutter.</h1>
        <p className="vault-welcome-lede">
          This welcome is temporary. Rotli will not add a tutorial note to your files.
        </p>

        <form
          className="vault-welcome-create"
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
        >
          <label htmlFor="vault-first-note">Name your first note</label>
          <div className="vault-welcome-field">
            <input
              id="vault-first-note"
              autoFocus
              maxLength={FIRST_NOTE_TITLE_MAX}
              value={title}
              placeholder="Project idea, meeting notes…"
              onChange={(event) => setTitle(event.currentTarget.value)}
            />
            <button type="submit" disabled={!body || busy}>
              {busy ? "Creating…" : "Create note"}
            </button>
          </div>
          {error && <p role="alert">Couldn’t create the note — {error}</p>}
        </form>

        <div className="vault-welcome-tips" aria-label="A quick tour">
          <button type="button" onClick={() => dispatch("palette.toggle")}>
            <SearchGlyph size={16} />
            <span>
              <strong>Find anything</strong>
              <small>Search notes, files, chats, and actions with ⌘K.</small>
            </span>
          </button>
          <button type="button" onClick={() => dispatch("chat.new")}>
            <ChatGlyph size={16} />
            <span>
              <strong>Open a chat</strong>
              <small>A chat is separate from your notes until you create or attach work.</small>
            </span>
          </button>
        </div>
      </div>
    </section>
  );
}
