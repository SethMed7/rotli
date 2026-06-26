// The Chat surface (Stage 1) — a real conversation over the connected memex's
// chats/ surface ("everything has a chat"). rotli OWNS chats/, so a chat persists
// as chats/<slug>.md (byte-shape from src/memex/contract.ts, proven against the
// brain's own validate.ts). The reply comes from an on-device model via the Rust
// `chat_complete` bridge (the webview CSP can't reach localhost).
//
// IA rework (Seth, 2026-06-26): Chat is no longer a full-surface front reached
// from a dropdown — it is the middle LEFT-MENU section. The chat history + "New
// chat" + "All chats" live in the Sidebar; this surface renders in the content
// area (contentView "chat") and shows the SELECTED chat (ui.selectedChatSlug) or,
// in browse mode (ui.chatAllOpen), a searchable list of every chat. The model the
// reply runs on is picked here from the memex-ai store (~/.memex/ai/registry.json
// via chat_models) — "the model selecter grabbing from what we have in the memex ai".
//
// Still Increment 1: one-shot (no streaming), no @-context, no chat-owns-a-summary
// note yet — those are later steps in docs/notes-chat-inbox-rearchitecture.md.

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { activeInstance } from "../memex/config";
import { readChat } from "../memex/service";
import { useInstanceChats, useMemexConfig, useWriteChat } from "../memex/useMemex";
import { chatComplete, chatModels, isTauri } from "../lib/tauri";
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

/** Flatten the thread into one prompt for the on-device model. */
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
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen);
  const selectedSlug = useUiStore((s) => s.selectedChatSlug);
  const setSelectedSlug = useUiStore((s) => s.setSelectedChatSlug);
  const chatAllOpen = useUiStore((s) => s.chatAllOpen);
  const setChatAllOpen = useUiStore((s) => s.setChatAllOpen);
  const chatModelId = useUiStore((s) => s.chatModelId);
  const setChatModelId = useUiStore((s) => s.setChatModelId);

  const cfg = useMemexConfig();
  const active = cfg.data ? activeInstance(cfg.data) : null;
  const chats = useInstanceChats(active);
  const write = useWriteChat();

  // the on-device models the memex-ai store offers (kind:llm-chat). Read once;
  // non-Tauri (the browser/dev demo) has no bridge, so the list stays empty.
  const models = useQuery({
    queryKey: ["chat", "models"],
    queryFn: () => (isTauri() ? chatModels() : Promise.resolve([])),
    staleTime: Infinity,
  });
  const modelList = models.data ?? [];
  // the picked model: the saved choice, else the store's flagged default, else first.
  const picked =
    modelList.find((m) => m.id === chatModelId) ??
    modelList.find((m) => m.isDefault) ??
    modelList[0] ??
    null;

  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false);
  const [browseFilter, setBrowseFilter] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const writable = active?.perms === "chats+inbox";

  // load the selected chat's messages (or clear for a new chat)
  useEffect(() => {
    let cancelled = false;
    if (active && selectedSlug) {
      readChat(active, selectedSlug)
        .then((t) => !cancelled && setMessages(parseMessages(t)))
        .catch(() => !cancelled && setMessages([]));
    } else {
      setMessages([]);
    }
    return () => {
      cancelled = true;
    };
  }, [active, selectedSlug]);

  // keep the newest message in view
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight });
  }, [messages, busy]);

  const openSettings = () => {
    setSettingsOpen(true);
  };

  const openChat = (slug: string) => {
    setChatAllOpen(false);
    setSelectedSlug(slug);
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
      const opts = picked
        ? { model: picked.id, endpoint: picked.endpoint, api: picked.api }
        : undefined;
      reply = (await chatComplete(buildPrompt(convo), opts)).trim() || "(the model returned nothing)";
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
      if (selectedSlug) {
        const sum = chats.data?.find((c) => c.slug === selectedSlug);
        await write.mutateAsync({
          instance: active,
          existingSlug: selectedSlug,
          title: sum?.title ?? selectedSlug,
          messages: turn,
        });
      } else {
        const res = await write.mutateAsync({
          instance: active,
          title: title.trim() || deriveTitle(userText),
          messages: turn,
        });
        setSelectedSlug(res.slug);
        setTitle("");
      }
    } catch {
      /* persistence failed — the in-memory thread still shows for this session */
    }
  };

  // the all-chats browse list (the sidebar "All chats" row opens this)
  const browseList = useMemo(() => {
    const q = browseFilter.trim().toLowerCase();
    const all = chats.data ?? [];
    if (!q) return all;
    return all.filter(
      (c) => (c.title || c.slug).toLowerCase().includes(q) || c.slug.toLowerCase().includes(q),
    );
  }, [chats.data, browseFilter]);

  return (
    <div className="chat-surface">
      <header className="chat-head">
        <h2>Chat</h2>
        {active && <span className="chat-inst">· {active.label}</span>}
        {/* the model selecter — what we have in the memex ai (~/.memex/ai) */}
        {modelList.length > 0 && (
          <label className="chat-model" title="On-device model — from your memex AI store">
            <span className="chat-model-label">Model</span>
            <select
              className="chat-model-select"
              value={picked?.id ?? ""}
              onChange={(e) => setChatModelId(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
            >
              {modelList.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
        )}
      </header>

      {!isTauri() ? (
        <div className="chat-empty">The Chat surface talks to your memex — it runs in the app.</div>
      ) : !active ? (
        <div className="chat-empty">
          <p>No memex connected yet.</p>
          <button type="button" className="chat-cta" onClick={openSettings}>
            Connect one in Settings → Memory
          </button>
        </div>
      ) : chatAllOpen ? (
        // browse mode: a searchable list of every chat (the sidebar shows a
        // limited view; "All chats" opens the full search here)
        <div className="chat-browse">
          <div className="chat-browse-search">
            <input
              className="chat-input"
              placeholder="Search all chats…"
              value={browseFilter}
              onChange={(e) => setBrowseFilter(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
              autoFocus
            />
          </div>
          <div className="chat-browse-list">
            {browseList.map((c) => (
              <button
                type="button"
                key={c.slug}
                className="chat-item"
                onClick={() => openChat(c.slug)}
              >
                <span className="chat-item-title">{c.title || c.slug}</span>
                {c.attachedTo && <span className="chat-item-attach">↳ {c.attachedTo}</span>}
              </button>
            ))}
            {browseList.length === 0 && (
              <p className="chat-list-empty">
                {(chats.data ?? []).length === 0 ? "No chats yet." : "No chats match."}
              </p>
            )}
          </div>
        </div>
      ) : (
        <main className="chat-main">
          <div className="chat-scroll" ref={scrollRef}>
            {messages.length === 0 ? (
              <div className="chat-newhint">
                <p>{selectedSlug ? "No messages yet." : "Ask anything — it runs on your Mac."}</p>
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
              {!selectedSlug && (
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
      )}
    </div>
  );
}
