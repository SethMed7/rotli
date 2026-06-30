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
import { makeTauriHost } from "../ai/host";
import { runAgent } from "../ai/loop";
import type { ChatTurn, RunInput } from "../ai/types";
import { activeInstance } from "../memex/config";
import { readChat } from "../memex/service";
import { useInstanceChats, useMemexConfig, useWriteChat } from "../memex/useMemex";
import { chatModels, isTauri } from "../lib/tauri";
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

/** Read an attached image file as a base64 data URL (the vision wire shape). */
function readAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error("couldn't read the image"));
    r.readAsDataURL(file);
  });
}

/** Composer affordance glyphs — line-art, theme-aware (currentColor). */
function GlobeGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
      <circle cx="8" cy="8" r="6.2" />
      <ellipse cx="8" cy="8" rx="2.6" ry="6.2" />
      <path d="M2 8h12M3.2 5h9.6M3.2 11h9.6" />
    </svg>
  );
}
function ClipGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M11.7 5.6 6.4 10.9a2 2 0 0 1-2.8-2.8l5.4-5.4a3 3 0 0 1 4.3 4.3l-5.4 5.4" />
    </svg>
  );
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
  const chatWeb = useUiStore((s) => s.chatWeb);
  const setChatWeb = useUiStore((s) => s.setChatWeb);
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
  const [status, setStatus] = useState("thinking…");
  const [images, setImages] = useState<string[]>([]);
  const [visionHint, setVisionHint] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const writable = active?.perms === "chats+inbox";

  // per-chat web toggle (the composer globe) — keyed by slug; "" holds a not-yet-saved chat
  const webKey = chatSlug ?? "";
  const globeOn = chatWeb[webKey] ?? false;
  // image attach is gated on the picked model's vision capability
  const canVision = picked?.vision ?? false;
  const visionModels = modelList.filter((m) => m.vision);

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
    if (!picked) {
      setMessages((p) => [
        ...p,
        { speaker: "rotli", text: "⚠ No on-device model is set up — add one in your memex AI store." },
      ]);
      return;
    }
    const userText = message.trim();
    const imgs = images;
    setMessage("");
    setImages([]);
    // history = the prior turns; the new user message rides as runAgent's userText
    const history: ChatTurn[] = messages.map((m) => ({
      role: m.speaker === "you" ? "user" : "assistant",
      text: m.text,
    }));
    setMessages((p) => [...p, { speaker: "you", text: userText }]);
    setBusy(true);
    setStatus("thinking…");

    const host = makeTauriHost(picked);
    const model = { id: picked.id };
    const runInput: RunInput =
      imgs.length > 0
        ? { history, userText, web: globeOn, model, images: imgs }
        : { history, userText, web: globeOn, model };

    let reply = "";
    try {
      for await (const ev of runAgent(host, runInput)) {
        if (ev.type === "status") setStatus(ev.text);
        else if (ev.type === "final") reply = ev.text;
      }
    } catch (e) {
      reply = `⚠ ${(e as Error)?.message ?? "the local model failed"}`;
    }
    setBusy(false);

    const failed = reply.startsWith("⚠");
    if (!reply) reply = "(the model returned nothing)";
    setMessages((p) => [...p, { speaker: "rotli", text: reply }]);
    if (failed) return; // a failed turn isn't persisted

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
        if (globeOn) setChatWeb(res.slug, true); // carry the globe to the saved chat
        setTitle("");
      }
    } catch (e) {
      // persistence failed — the in-memory thread still shows for this session
      console.warn("chat save failed — this conversation may not persist on reload", e);
    }
  };

  const onAttachClick = () => {
    if (!canVision) {
      setVisionHint(true); // this model can't see — prompt to pick one that can
      return;
    }
    fileRef.current?.click();
  };

  const onPickFiles = async (files: FileList | null) => {
    if (!files) return;
    const picks = [...files].filter((f) => f.type.startsWith("image/"));
    const datas = await Promise.all(picks.map(readAsDataURL));
    if (datas.length > 0) setImages((prev) => [...prev, ...datas]);
  };

  return (
    <div className="chat-surface">
      <header className="chat-head">
        <h2 className="chat-title-h">{chatSlug ? chatSlug.replace(/-/g, " ") : "New chat"}</h2>
        {active && <span className="chat-inst">· {active.label}</span>}
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
            <div className="chat-thread">
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
                      {!you && <div className="cmsg-who">rotli</div>}
                      <div className="cmsg-bubble">{you ? m.text : renderMessage(m.text)}</div>
                    </div>
                  );
                })
              )}
              {busy && (
                <div className="cmsg ai">
                  <div className="cmsg-who">rotli</div>
                  <div className="cmsg-bubble cmsg-think">{status}</div>
                </div>
              )}
            </div>
          </div>

          {writable ? (
            <div className="chat-composer">
              <div className="chat-composer-inner">
                {!chatSlug && (
                  <input
                    className="chat-input chat-title-input"
                    placeholder="Chat title (optional)…"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    onKeyDown={(e) => e.stopPropagation()}
                  />
                )}
                {images.length > 0 && (
                  <div className="chat-attachments">
                    {images.map((src, i) => (
                      <span key={i} className="chat-attachment">
                        <img src={src} alt="attachment" />
                        <button
                          type="button"
                          className="chat-attachment-x"
                          title="Remove"
                          onClick={() => setImages((prev) => prev.filter((_, j) => j !== i))}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                {visionHint && (
                  <div className="chat-vision-hint">
                    {visionModels.length > 0 ? (
                      <>
                        <span>This model can’t see images. Pick one that can:</span>
                        {visionModels.map((m) => (
                          <button
                            key={m.id}
                            type="button"
                            className="chat-vision-pick"
                            onClick={() => {
                              setChatModelId(m.id);
                              setVisionHint(false);
                            }}
                          >
                            {m.id}
                          </button>
                        ))}
                      </>
                    ) : (
                      <span>No vision-capable model is set up in your memex AI store yet.</span>
                    )}
                    <button type="button" className="chat-vision-x" onClick={() => setVisionHint(false)}>
                      Dismiss
                    </button>
                  </div>
                )}
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  multiple
                  hidden
                  onChange={(e) => {
                    void onPickFiles(e.target.files);
                    e.target.value = "";
                  }}
                />
                <div className="chat-box">
                  <textarea
                    className="chat-msg"
                    rows={1}
                    placeholder={busy ? "thinking…" : "Message rotli…  (⏎ to send · ⇧⏎ new line)"}
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
                  <div className="chat-box-foot">
                    {modelList.length > 0 && (
                      <label className="chat-model" title="On-device model — from your memex AI store">
                        <select
                          className="chat-model-select"
                          value={picked?.id ?? ""}
                          onChange={(e) => {
                            setChatModelId(e.target.value);
                            setVisionHint(false);
                          }}
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
                    <button
                      type="button"
                      className={globeOn ? "chat-tool on" : "chat-tool"}
                      aria-pressed={globeOn}
                      title={
                        globeOn
                          ? "Web search is ON for this chat"
                          : "Web search — let this chat reach the internet"
                      }
                      onClick={() => setChatWeb(webKey, !globeOn)}
                    >
                      <GlobeGlyph />
                    </button>
                    <button
                      type="button"
                      className={images.length > 0 ? "chat-tool on" : "chat-tool"}
                      title={canVision ? "Attach an image" : "This model can’t see images — pick a vision model"}
                      onClick={onAttachClick}
                    >
                      <ClipGlyph />
                    </button>
                    <span className="chat-box-grow" />
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
