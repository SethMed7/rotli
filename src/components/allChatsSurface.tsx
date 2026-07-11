// All chats (Seth, 2026-07-01): a searchable LIST of every chat — the Chat-front
// twin of All notes. Title on the left, source/attached hint on the right; a
// full-width search at the top. Click a row to open the chat in a pane.

import { useMemo, useState } from "react";
import { activeInstance } from "../memex/config";
import { useInstanceChats, useMemexConfig } from "../memex/useMemex";
import { usePanesStore } from "../state/panes";
import { Character } from "./character";
import { ChatGlyph, SearchGlyph } from "./glyphs";

export function AllChatsSurface() {
  const memexCfg = useMemexConfig();
  const activeMemex = memexCfg.data ? activeInstance(memexCfg.data) : null;
  const chats = useInstanceChats(activeMemex).data ?? [];
  const openChat = usePanesStore((s) => s.openChat);
  const [query, setQuery] = useState("");

  const q = query.trim().toLowerCase();
  const results = useMemo(
    () =>
      chats
        .filter(
          (c) => !q || c.title.toLowerCase().includes(q) || c.slug.toLowerCase().includes(q),
        )
        .sort((a, b) => (a.title || a.slug).localeCompare(b.title || b.slug)),
    [chats, q],
  );

  return (
    <div className="board allchats">
      <header className="board-head">
        <h2 className="board-title">All chats</h2>
        <span className="board-count">{chats.length}</span>
      </header>

      <div className="allnotes-search">
        <SearchGlyph size={15} />
        <input
          type="text"
          value={query}
          placeholder="Search all chats…"
          aria-label="Search all chats"
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {results.length === 0 ? (
        <div className="board-empty">
          {chats.length === 0 && <Character name="chat" size={104} className="be-quokka" />}
          <p className="be-title">{chats.length === 0 ? "No chats yet" : "No matches"}</p>
          <p className="be-sub">
            {chats.length === 0
              ? "Start one with New chat — it saves as a plain chats/<slug>.md in your memex."
              : "Try a different search."}
          </p>
        </div>
      ) : (
        <div className="board-scroll">
          <ul className="recent-list">
            {results.map((c) => (
              <li key={c.slug}>
                <button
                  type="button"
                  className="chatlist-row"
                  onClick={() => openChat(c.slug)}
                  title={c.title || c.slug}
                >
                  <ChatGlyph size={15} className="chatlist-icon" />
                  <span className="chatlist-title">{c.title || c.slug}</span>
                  {c.attachedTo ? (
                    <span className="chatlist-attached">on {c.attachedTo.replace(/^\[\[|\]\]$/g, "")}</span>
                  ) : (
                    <span className="chatlist-src">{c.source}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
