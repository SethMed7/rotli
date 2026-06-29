// The Chat surface — a real conversation over the connected memex's chats/ surface
// ("everything has a chat"). rotli OWNS chats/, so a chat persists as
// chats/<slug>.md (byte-shape from src/memex/contract.ts). The reply comes from an
// on-device model via the Rust `chat_complete` bridge (the webview CSP can't reach
// localhost).
//
// Pane-able (Seth, 2026-06-29): a chat is a PANE SURFACE now (surfaceKind "chat"),
// so multiple chats open at once and a pane can hold a chat OR a note side by side.
// This component is driven by props { paneId, chatSlug } — chatSlug null = a fresh
// unsent chat; the first send creates the file and BINDS the tab to its slug.
//
// Still Increment 1: one-shot (no streaming), no @-context yet.

import { type ReactNode, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { activeInstance } from "../memex/config";
import { readChat } from "../memex/service";
import { useInstanceChats, useMemexConfig, useWriteChat } from "../memex/useMemex";
import { chatComplete, chatModels, isTauri } from "../lib/tauri";
import { useUiStore } from "../state/ui";
import { usePanesStore } from "../state/panes";
import { renderInline } from "../editor/render";
import { Character } from "./Character";

interface Msg {
  speaker: string;
  text: string;
}

/** Parse a chat .md's `## Messages` block back into bubbles — rotli writes the
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

/** Render an assistant message as light markdown: ``` fenced code → <pre>, every
 * other line via the editor's inline renderer (bold/italic/code/links), blank
 * lines kept as gaps. Source-of-truth stays the .md; this is display only. */
function renderMessage(text: string): ReactNode {
  const out: ReactNode[] = [];
  const lines = text.split("\n");
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (line.trimStart().startsWith("```")) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !(lines[i] ?? "").trimStart().startsWith("```")) {
        code.push(lines[i] ?? "");
        i++;
      }
      i++; // skip the closing fence
      out.push(
        <pre key={key++} className="cmsg-code">
          <code>{code.join("\n")}</code>
        </pre>,
      );
    } else {
      out.push(
        <div key={key++} className="cmsg-line">
          {line ? renderInline(line) : " "}
        </div>,
      );
      i++;
    }
  }
  return out;
}

export function ChatSurface({
  paneId,
  chatSlug,
}: {
  paneId: string;
  chatSlug: string | null;
}) {
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen);
  const chatModelId = useUiStore((s) => s.chatModelId);
  const setChatModelId = useUiStore((s) => s.setChatModelId);
  const bindChat = usePanesStore((s) => s.bindChat);

  const cfg = useMemexConfig();
  const active = cfg.data ? activeInstance(cfg.data) : null;
  const chats = useInstanceChats(active);
  const write = useWriteChat();

  // the on-device models the memex-ai store offers; non-Tauri has no bridge.
  const models = useQuery({
    queryKey: ["chat", "models"],
    queryFn: () => (isTauri() ? chatModels() : Promise.resolve([])),
    staleTime: Infinity,
  });
  const modelList = models.data ?? [];
  const picked =
    modelList.find((m) => m.id === chatModelId) ??
    modelList.find((m) => m.isDefault) ??
    modelList[0] ??
    null;

  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const writable = active?.perms === "chats+inbox";

  // load THIS pane's chat (by slug), or clear for a fresh chat
  useEffect(() => {
    let cancelled = false;
    if (active && chatSlug) {
      readChat(active, chatSlug)
        .then((t) => !cancelled && setMessages(parseMessages(t)))
        .catch(() => !cancelled && setMessages([]));
    } else {
      setMessages([]);
    }
    return () => {
      cancelled = true;
    };
  }, [active, chatSlug]);

  // keep the newest message in view
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight });
  }, [messages, busy]);

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
      if (chatSlug) {
        const sum = chats.data?.find((c) => c.slug === chatSlug);
        await write.mutateAsync({
          instance: active,
          existingSlug: chatSlug,
          title: sum?.title ?? chatSlug,
          messages: turn,
        });
      } else {
        const res = await write.mutateAsync({
          instance: active,
          title: title.trim() || deriveTitle(userText),
          messages: turn,
        });
        bindChat(paneId, res.slug); // this tab now IS that chat
        setTitle("");
      }
    } catch {
      /* persistence failed — the in-memory thread still shows for this session */
    }
  };

  return (
    <div className="chat-surface">
      <header className="chat-head">
        <h2 className="chat-title-h">{chatSlug ? chatSlug.replace(/-/g, " ") : "New chat"}</h2>
        {active && <span className="chat-inst">· {active.label}</span>}
        <span className="chat-head-grow" />
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
        <div className="chat-empty">
          <Character name="chat" size={120} />
          <p>The Chat surface talks to your memex — it runs in the app.</p>
        </div>
      ) : !active ? (
        <div className="chat-empty">
          <Character name="chat" size={120} />
          <p>No memex connected yet.</p>
          <button type="button" className="chat-cta" onClick={() => setSettingsOpen(true)}>
            Connect one in Settings → Location
          </button>
        </div>
      ) : (
        <main className="chat-main">
          <div className="chat-scroll" ref={scrollRef}>
            {messages.length === 0 ? (
              <div className="chat-newhint">
                <Character name="chat" size={84} />
                <p className="chat-hint-title">
                  {chatSlug ? "No messages yet." : "Ask anything — it runs on your Mac."}
                </p>
                <p className="chat-sub">
                  Saved as a plain <code>chats/&lt;slug&gt;.md</code> in your memex.
                </p>
              </div>
            ) : (
              messages.map((m, idx) => {
                const you = m.speaker === "you";
                return (
                  <div key={idx} className={you ? "cmsg you" : "cmsg ai"}>
                    <div className="cmsg-who">{you ? "You" : "rotli"}</div>
                    <div className="cmsg-bubble">{you ? m.text : renderMessage(m.text)}</div>
                  </div>
                );
              })
            )}
            {busy && (
              <div className="cmsg ai">
                <div className="cmsg-who">rotli</div>
                <div className="cmsg-bubble cmsg-think">thinking…</div>
              </div>
            )}
          </div>

          {writable ? (
            <div className="chat-composer">
              {!chatSlug && (
                <input
                  className="chat-input chat-title-input"
                  placeholder="Chat title (optional)…"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  onKeyDown={(e) => e.stopPropagation()}
                />
              )}
              <div className="chat-send-row">
                <textarea
                  className="chat-input chat-msg"
                  rows={1}
                  placeholder={busy ? "thinking…" : "Message…  (⏎ to send · ⇧⏎ new line)"}
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
              This memex is connected read-only — enable “Chats + inbox” in Settings → Location to write.
            </div>
          )}
        </main>
      )}
    </div>
  );
}
