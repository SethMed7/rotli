// The Chat front (Stage 1, minimal) — named conversations over the connected
// memex's chats/ surface ("everything has a chat"). rotli OWNS chats/, so this is
// the first place the app WRITES the brain: start a chat, add messages, they land
// as chats/<slug>.md in the active memex (byte-shape from src/memex/contract.ts,
// proven against the brain's own validate.ts). Opened from the module switcher;
// closes back to Notes. A surface flag (chatOpen), not a pane tab, for now.

import { useEffect, useState } from "react";
import { activeInstance } from "../memex/config";
import { readChat } from "../memex/service";
import { useInstanceChats, useMemexConfig, useWriteChat } from "../memex/useMemex";
import { isTauri } from "../lib/tauri";
import { useUiStore } from "../state/ui";

export function ChatSurface() {
  const setChatOpen = useUiStore((s) => s.setChatOpen);
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen);

  const cfg = useMemexConfig();
  const active = cfg.data ? activeInstance(cfg.data) : null;
  const chats = useInstanceChats(active);
  const write = useWriteChat();

  const [selected, setSelected] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [body, setBody] = useState("");

  const writable = active?.perms === "chats+inbox";

  // read the selected chat's text (rendered raw — markdown styling is the editor's
  // job; for messages a plain transcript is enough for Stage 1)
  useEffect(() => {
    let cancelled = false;
    if (active && selected) {
      readChat(active, selected)
        .then((t) => !cancelled && setBody(t))
        .catch(() => !cancelled && setBody(""));
    } else {
      setBody("");
    }
    return () => {
      cancelled = true;
    };
  }, [active, selected]);

  const openSettings = () => {
    setChatOpen(false);
    setSettingsOpen(true);
  };

  const send = async () => {
    if (!active || !writable || !message.trim()) return;
    const msg = { speaker: "you", text: message.trim() };
    let slug = selected;
    if (slug) {
      const sum = chats.data?.find((c) => c.slug === slug);
      await write.mutateAsync({
        instance: active,
        existingSlug: slug,
        title: sum?.title ?? slug,
        messages: [msg],
      });
    } else {
      if (!title.trim()) return;
      const res = await write.mutateAsync({ instance: active, title: title.trim(), messages: [msg] });
      slug = res.slug;
      setSelected(slug);
      setTitle("");
    }
    setMessage("");
    setBody(await readChat(active, slug));
  };

  return (
    <div className="chat-surface">
      <header className="chat-head">
        <button type="button" className="chat-back" onClick={() => setChatOpen(false)}>
          <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
            <path d="M15 18l-6-6 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Notes
        </button>
        <h2>Chat</h2>
        {active && <span className="chat-inst">· {active.label}</span>}
      </header>

      {!isTauri() ? (
        <div className="chat-empty">The Chat front talks to your memex — it runs in the app.</div>
      ) : !active ? (
        <div className="chat-empty">
          <p>No memex connected yet.</p>
          <button type="button" className="chat-cta" onClick={openSettings}>
            Connect one in Settings → Memory
          </button>
        </div>
      ) : (
        <div className="chat-body">
          <aside className="chat-list">
            <button
              type="button"
              className={selected === null ? "chat-new sel" : "chat-new"}
              onClick={() => setSelected(null)}
            >
              + New chat
            </button>
            {(chats.data ?? []).map((c) => (
              <button
                type="button"
                key={c.slug}
                className={selected === c.slug ? "chat-item sel" : "chat-item"}
                onClick={() => setSelected(c.slug)}
              >
                <span className="chat-item-title">{c.title || c.slug}</span>
                {c.attachedTo && <span className="chat-item-attach">↳ {c.attachedTo}</span>}
              </button>
            ))}
            {(chats.data ?? []).length === 0 && <p className="chat-list-empty">No chats yet.</p>}
          </aside>

          <main className="chat-main">
            <div className="chat-scroll">
              {selected ? (
                <pre className="chat-pre">{body}</pre>
              ) : (
                <div className="chat-newhint">
                  <p>Start a new chat in <b>{active.label}</b>.</p>
                  <p className="chat-sub">It lands as a plain <code>chats/&lt;slug&gt;.md</code> in your memex.</p>
                </div>
              )}
            </div>

            {writable ? (
              <div className="chat-composer">
                {!selected && (
                  <input
                    className="chat-input"
                    placeholder="Chat title…"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    onKeyDown={(e) => e.stopPropagation()}
                  />
                )}
                <div className="chat-send-row">
                  <input
                    className="chat-input"
                    placeholder={selected ? "Message…" : "First message…"}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        void send();
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="chat-send"
                    disabled={write.isPending || !message.trim() || (!selected && !title.trim())}
                    onClick={() => void send()}
                  >
                    {write.isPending ? "…" : "Send"}
                  </button>
                </div>
                {write.isError && (
                  <p className="chat-err">{(write.error as Error)?.message ?? "Couldn’t write the chat."}</p>
                )}
              </div>
            ) : (
              <div className="chat-readonly">
                This memex is connected read-only — enable “Chats + inbox” in Settings → Memory to write.
              </div>
            )}
          </main>
        </div>
      )}
    </div>
  );
}
