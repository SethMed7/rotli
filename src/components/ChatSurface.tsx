// The Chat front (Stage 1 / Increment 1) — a real conversation over the connected
// memex's chats/ surface ("everything has a chat"). rotli OWNS chats/, so a chat
// persists as chats/<slug>.md (byte-shape from src/memex/contract.ts, proven
// against the brain's own validate.ts). The reply comes from the on-device model
// via the Rust `chat_complete` bridge (the webview CSP can't reach localhost).
// Opened from the module switcher; closes back to Notes.
//
// Increment 1 is one-shot (no streaming), no @-context, no chat-owns-a-summary
// note yet — those are the next steps in docs/notes-chat-inbox-rearchitecture.md.

import { useEffect, useRef, useState } from "react";
import { activeInstance } from "../memex/config";
import { readChat } from "../memex/service";
import { useInstanceChats, useMemexConfig, useWriteChat } from "../memex/useMemex";
import { chatComplete, isTauri } from "../lib/tauri";
import { useUiStore } from "../state/ui";

interface Msg {
  speaker: string;
  text: string;
}

/** Parse a chat .md's `## Messages` block back into bubbles. rotli writes the
 * `**speaker** · date — text` shape (contract.ts), so this round-trips its own. */
function parseMessages(body: string): Msg[] {
  const i = body.indexOf("## Messages");
  if (i < 0) return [];
  const section = body.slice(i + "## Messages".length);
  const re = /\*\*([^*]+)\*\*\s*·[^—\n]*—\s*([\s\S]*?)(?=\n\*\*[^*]+\*\*\s*·|\s*$)/g;
  const out: Msg[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(section)) !== null) {
    out.push({ speaker: (m[1] ?? "").trim(), text: (m[2] ?? "").trim() });
  }
  return out;
}

/** Flatten the thread into one prompt for the Ollama-shape model. */
function buildPrompt(convo: Msg[]): string {
  const sys = "You are rotli, a warm, concise, on-device assistant. Answer directly and briefly.";
  const turns = convo
    .map((m) => `${m.speaker === "you" ? "User" : "Assistant"}: ${m.text}`)
    .join("\n\n");
  return `${sys}\n\n${turns}\n\nAssistant:`;
}

function deriveTitle(text: string): string {
  return text.split(/\s+/).slice(0, 6).join(" ").slice(0, 60) || "New chat";
}

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
  const [messages, setMessages] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const writable = active?.perms === "chats+inbox";

  // load the selected chat's messages (or clear for a new chat)
  useEffect(() => {
    let cancelled = false;
    if (active && selected) {
      readChat(active, selected)
        .then((t) => !cancelled && setMessages(parseMessages(t)))
        .catch(() => !cancelled && setMessages([]));
    } else {
      setMessages([]);
    }
    return () => {
      cancelled = true;
    };
  }, [active, selected]);

  // keep the newest message in view
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight });
  }, [messages, busy]);

  const openSettings = () => {
    setChatOpen(false);
    setSettingsOpen(true);
  };

  const send = async () => {
    if (!active || !writable || !message.trim() || busy) return;
    const userText = message.trim();
    setMessage("");
    const convo = [...messages, { speaker: "you", text: userText }];
    setMessages(convo);
    setBusy(true);

    let reply: string;
    try {
      reply = (await chatComplete(buildPrompt(convo))).trim() || "(the model returned nothing)";
    } catch (e) {
      setMessages((p) => [
        ...p,
        { speaker: "rotli", text: `⚠ ${(e as Error)?.message ?? "couldn't reach the local model"}` },
      ]);
      setBusy(false);
      return; // a failed turn isn't persisted
    }
    setMessages((p) => [...p, { speaker: "rotli", text: reply }]);
    setBusy(false);

    // persist the turn (user + assistant) to chats/<slug>.md
    const turn: Msg[] = [
      { speaker: "you", text: userText },
      { speaker: "rotli", text: reply },
    ];
    try {
      if (selected) {
        const sum = chats.data?.find((c) => c.slug === selected);
        await write.mutateAsync({
          instance: active,
          existingSlug: selected,
          title: sum?.title ?? selected,
          messages: turn,
        });
      } else {
        const res = await write.mutateAsync({
          instance: active,
          title: title.trim() || deriveTitle(userText),
          messages: turn,
        });
        setSelected(res.slug);
        setTitle("");
      }
    } catch {
      /* persistence failed — the in-memory thread still shows for this session */
    }
  };

  return (
    <div className="chat-surface">
      <header className="chat-head">
        <button type="button" className="chat-back" onClick={() => setChatOpen(false)}>
          <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
            <path
              d="M15 18l-6-6 6-6"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
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
            <div className="chat-scroll" ref={scrollRef}>
              {messages.length === 0 ? (
                <div className="chat-newhint">
                  <p>{selected ? "No messages yet." : "Ask anything — it runs on your Mac."}</p>
                  <p className="chat-sub">
                    Saved as a plain <code>chats/&lt;slug&gt;.md</code> in your memex.
                  </p>
                </div>
              ) : (
                messages.map((m, idx) => (
                  <div key={idx} className={m.speaker === "you" ? "cmsg you" : "cmsg ai"}>
                    <div className="cmsg-bubble">{m.text}</div>
                  </div>
                ))
              )}
              {busy && (
                <div className="cmsg ai">
                  <div className="cmsg-bubble cmsg-think">thinking…</div>
                </div>
              )}
            </div>

            {writable ? (
              <div className="chat-composer">
                {!selected && (
                  <input
                    className="chat-input"
                    placeholder="Chat title (optional)…"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    onKeyDown={(e) => e.stopPropagation()}
                  />
                )}
                <div className="chat-send-row">
                  <input
                    className="chat-input"
                    placeholder={busy ? "thinking…" : "Message…"}
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
                    disabled={busy || !message.trim()}
                    onClick={() => void send()}
                  >
                    {busy ? "…" : "Send"}
                  </button>
                </div>
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
