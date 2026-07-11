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

import {
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { makeTauriHost } from "../ai/host";
import { presetFor, runHybrid } from "../ai/hybrid";
import { runAgent } from "../ai/loop";
import {
  PROVIDER_IDS,
  PROVIDER_LABELS,
  type ModelGroups,
  type ProviderId,
  flattenModels,
  mergedModels,
} from "../ai/models";
import type { ChatTurn, RunInput } from "../ai/types";
import { CORPUS_INSTANCE_ID, activeInstance } from "../memex/config";
import { readChat, writeNote } from "../memex/service";
import { useInstanceChats, useMemexConfig, useSetChatAttachedTo, useWriteChat } from "../memex/useMemex";
import {
  type ChatModelInfo,
  chatModels,
  cliCancel,
  cliDetect,
  fileAssetUrl,
  isTauri,
} from "../lib/tauri";
import { useTransientPopover } from "../lib/popover";
import { invalidateNotes, useNoteIndex } from "../services/hooks";
import { type Measure } from "../state/noteStyle";
import { useUiStore } from "../state/ui";
import { usePanesStore } from "../state/panes";
import { renderInline } from "../editor/render";
import { CheckGlyph, CloudGlyph, EyeGlyph, LaptopGlyph } from "./glyphs";
import { Character } from "./character";
import { syncManagedChatMemory } from "../chatMemory/composition";

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

function NoteGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 1.8h5.5L13 5.3v8.9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V2.8a1 1 0 0 1 1-1z" />
      <path d="M9.5 1.8v3.5H13M5.5 8.5h5M5.5 11h5" />
    </svg>
  );
}
function WidthGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2.2 2.5v11M13.8 2.5v11" />
      <path d="M4.6 8h6.8M4.6 8l1.8-1.8M4.6 8l1.8 1.8M11.4 8l-1.8-1.8M11.4 8l-1.8 1.8" />
    </svg>
  );
}
function SendGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 12.5v-9M4 7l4-3.5L12 7" />
    </svg>
  );
}
function SpinGlyph() {
  return (
    <svg className="chat-send-spin" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <path d="M8 1.8a6.2 6.2 0 1 1-6.2 6.2" />
    </svg>
  );
}
function StopGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <rect x="3" y="3" width="10" height="10" rx="2" />
    </svg>
  );
}

function deriveTitle(text: string): string {
  return text.split(/\s+/).slice(0, 6).join(" ").slice(0, 60) || "New chat";
}

/** Chat measure widths — comfort keeps the tuned 740 column (Seth, 2026-07-01);
 * narrow/wide step around it. Same Aa vocabulary as notes, chat-tuned values. */
const CHAT_MEASURE_PX: Record<Measure, number> = { narrow: 620, comfort: 740, wide: 1000 };

const MEASURE_LABELS: { id: Measure; label: string }[] = [
  { id: "narrow", label: "Narrow" },
  { id: "comfort", label: "Comfort" },
  { id: "wide", label: "Wide" },
];

function AssetsGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="2.8" width="12" height="10.4" rx="1.5" />
      <circle cx="5.6" cy="6.4" r="1.1" />
      <path d="M2.5 12 6.7 8.2l2.6 2.4 2.3-2 1.9 1.7" />
    </svg>
  );
}

/** One generated asset in the drawer — thumbnail via the asset protocol. */
function AssetThumb({ id, onOpen }: { id: string; onOpen: () => void }) {
  const url = useQuery({ queryKey: ["asset-url", id], queryFn: () => fileAssetUrl(id) });
  const name = id.split("/").pop() ?? id;
  return (
    <button type="button" className="chat-asset" title={name} onClick={onOpen}>
      {url.data ? <img src={url.data} alt={name} /> : <span className="chat-asset-wait">…</span>}
    </button>
  );
}

/** The chat's generated assets — everything under storage/chats/<slug>/. */
function AssetsDrawer({
  ids,
  anchorRef,
  onOpen,
  onClose,
}: {
  ids: string[];
  anchorRef: RefObject<HTMLElement | null>;
  onOpen: (id: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useTransientPopover([ref, anchorRef], true, onClose);
  return (
    <div className="chat-assets-pop" ref={ref} role="dialog" aria-label="Chat assets">
      {ids.length === 0 ? (
        <p className="chat-assets-empty">
          Nothing yet — ask the chat to generate an image and it lands here.
        </p>
      ) : (
        <div className="chat-assets-grid">
          {ids.map((id) => (
            <AssetThumb key={id} id={id} onOpen={() => onOpen(id)} />
          ))}
        </div>
      )}
    </div>
  );
}

/** The header width picker — the notes Aa measure, as a chat popover. */
function MeasureMenu({
  value,
  anchorRef,
  onPick,
  onClose,
}: {
  value: Measure;
  anchorRef: RefObject<HTMLElement | null>;
  onPick: (m: Measure) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useTransientPopover([ref, anchorRef], true, onClose);
  return (
    <div className="chat-measure-pop" ref={ref} role="menu" aria-label="Chat width">
      {MEASURE_LABELS.map((m) => (
        <button
          type="button"
          key={m.id}
          className={value === m.id ? "chat-measure-seg sel" : "chat-measure-seg"}
          onClick={() => {
            onPick(m.id);
            onClose();
          }}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}

/** Strip the transport suffix + quant noise so a raw id reads as a name —
 * "gemma-3-12b-it-qat-4bit · MLX" → "gemma-3-12b" (mirrors Settings' pretty()). */
function shortModelLabel(label: string): string {
  return label.replace(/ · (MLX|llama\.cpp)$/, "").replace(/-(it-qat|instruct)-4bit$/i, "");
}

type ModelKind = "local" | "connected" | "preset";

const PICKER_PROVIDER_META: Record<ProviderId, { label: string; hint: string }> = {
  claude: {
    label: PROVIDER_LABELS.claude,
    hint: "Uses the Claude account signed in to Claude Code.",
  },
  codex: {
    label: PROVIDER_LABELS.codex,
    hint: "Uses the ChatGPT account signed in to Codex.",
  },
  agy: {
    label: PROVIDER_LABELS.agy,
    hint: "Uses the Google account signed in to Antigravity.",
  },
  gemini: {
    label: PROVIDER_LABELS.gemini,
    hint: "Uses the Gemini API key stored in macOS Keychain.",
  },
};

/** local → on this Mac · connected → leaves your Mac · preset → routes. */
function modelKindGlyph(kind: ModelKind) {
  if (kind === "local") return <LaptopGlyph size={13} />;
  if (kind === "connected") return <CloudGlyph size={13} />;
  return (
    <span className="chat-modelrow-route" aria-hidden="true">
      ⇢
    </span>
  );
}

/** The per-chat model picker — a quiet popover (same grammar as MeasureMenu)
 * grouped On this Mac · Connected · Presets, with a local-vs-"leaves your Mac"
 * cue and a vision badge. Replaces the bare native <select> (Seth, 2026-07-08
 * model UX pass, phase 2). */
function ModelPicker({
  groups,
  picked,
  fallbackFrom,
  onPick,
}: {
  groups: ModelGroups;
  picked: ChatModelInfo | null;
  fallbackFrom?: string | null;
  onPick: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<Array<HTMLButtonElement | null>>([]);
  useTransientPopover([popRef, anchorRef], open, () => setOpen(false));

  const localIds = new Set(groups.local.map((m) => m.id));
  const connectedIds = new Set(groups.connected.map((m) => m.id));
  const kindOf = (m: ChatModelInfo): ModelKind =>
    localIds.has(m.id) ? "local" : connectedIds.has(m.id) ? "connected" : "preset";

  const connectedSections = PROVIDER_IDS.map((provider) => ({
    key: `connected:${provider}`,
    kind: "connected" as const,
    label: PICKER_PROVIDER_META[provider].label,
    hint: PICKER_PROVIDER_META[provider].hint,
    items: groups.connected.filter((m) => m.provider === provider),
  }));
  const sections = [
    { key: "local", kind: "local" as const, label: "On this Mac", items: groups.local },
    ...connectedSections,
    {
      key: "preset",
      kind: "preset" as const,
      label: "Routing presets",
      items: groups.presets,
      hint: "May route this turn to a connected account.",
    },
  ].filter((s) => s.items.length > 0);
  const flatItems = sections.flatMap((s) => s.items);
  const flatKey = flatItems.map((m) => `${m.provider}:${m.id}`).join("\u0000");

  const pickedKind: ModelKind = picked ? kindOf(picked) : "local";
  const triggerTitle = fallbackFrom
    ? `Saved model “${shortModelLabel(fallbackFrom)}” is unavailable. Using ${picked ? shortModelLabel(picked.label) : "the local default"}.`
    : pickedKind === "connected"
      ? "Connected model — this chat leaves your Mac"
      : pickedKind === "preset"
        ? "Preset — routes each message to the model best suited"
        : "On-device model — stays on your Mac";

  useEffect(() => {
    if (!open || flatItems.length === 0) return;
    const selected = picked ? flatItems.findIndex((m) => m.id === picked.id) : -1;
    const next = selected >= 0 ? selected : 0;
    setActiveIndex(next);
    const frame = requestAnimationFrame(() => rowRefs.current[next]?.focus());
    return () => cancelAnimationFrame(frame);
  }, [flatKey, open, picked?.id]);

  const moveActive = (index: number) => {
    if (flatItems.length === 0) return;
    const next = (index + flatItems.length) % flatItems.length;
    setActiveIndex(next);
    rowRefs.current[next]?.focus();
  };

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveActive(activeIndex + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveActive(activeIndex - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      moveActive(0);
    } else if (event.key === "End") {
      event.preventDefault();
      moveActive(flatItems.length - 1);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      anchorRef.current?.focus();
    } else if (event.key === "Tab") {
      setOpen(false);
    }
  };

  let rowIndex = -1;

  return (
    <div className="chat-modelpick">
      <button
        type="button"
        ref={anchorRef}
        className="chat-model-trigger"
        title={triggerTitle}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            event.stopPropagation();
            setOpen(true);
          }
        }}
      >
        <span className="chat-modelrow-ico">{modelKindGlyph(pickedKind)}</span>
        <span className="chat-model-trigger-name">
          {picked ? shortModelLabel(picked.label) : "Pick a model"}
        </span>
        <span className="chat-model-caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {fallbackFrom && (
        <span className="chat-model-fallback" role="status" title={triggerTitle}>
          fallback
        </span>
      )}
      {open && (
        <div
          className="chat-modelpop"
          ref={popRef}
          role="menu"
          aria-label="Model"
          onKeyDown={onMenuKeyDown}
        >
          {fallbackFrom && (
            <div className="chat-modelpop-notice">
              Saved model <b>{shortModelLabel(fallbackFrom)}</b> is unavailable. Using the fallback
              shown in the composer.
            </div>
          )}
          {sections.map((s) => (
            <div className="chat-modelpop-group" key={s.key}>
              <div className="chat-modelpop-grouplabel">
                <span className="chat-modelpop-groupico">{modelKindGlyph(s.kind)}</span>
                <span>{s.label}</span>
              </div>
              {s.hint && <div className="chat-modelpop-grouphint">{s.hint}</div>}
              {s.items.map((m) => {
                rowIndex += 1;
                const index = rowIndex;
                const sel = m.id === picked?.id;
                return (
                  <button
                    type="button"
                    key={`${m.provider}:${m.id}`}
                    ref={(node) => {
                      rowRefs.current[index] = node;
                    }}
                    className={sel ? "chat-modelrow sel" : "chat-modelrow"}
                    role="menuitemradio"
                    aria-checked={sel}
                    tabIndex={activeIndex === index ? 0 : -1}
                    onFocus={() => setActiveIndex(index)}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => {
                      onPick(m.id);
                      setOpen(false);
                    }}
                  >
                    <span className="chat-modelrow-name">{shortModelLabel(m.label)}</span>
                    {m.vision && (
                      <span className="chat-modelrow-tag" title="Can see attached images">
                        <EyeGlyph size={13} />
                      </span>
                    )}
                    {(m.localDefault || m.isDefault) && (
                      <span className="chat-modelrow-tag def">default</span>
                    )}
                    <span className="chat-modelrow-check">
                      {sel && <CheckGlyph size={13} />}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
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
  const clearChatWeb = useUiStore((s) => s.clearChatWeb);
  const chatMeasure = useUiStore((s) => s.chatMeasure);
  const setChatMeasure = useUiStore((s) => s.setChatMeasure);
  const clearChatMeasure = useUiStore((s) => s.clearChatMeasure);
  const chatNoteOpen = useUiStore((s) => s.chatNoteOpen);
  const imageEngine = useUiStore((s) => s.imageEngine);
  const bindChat = usePanesStore((s) => s.bindChat);
  const openNote = usePanesStore((s) => s.openNote);
  const openFile = usePanesStore((s) => s.openFile);
  const splitRight = usePanesStore((s) => s.splitRight);
  const noteIndex = useNoteIndex();
  const setAttached = useSetChatAttachedTo();

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
  // + connected lanes that are both enabled AND detected ready + presets,
  // minus models blocked inside a lane. An unavailable saved pick is surfaced
  // explicitly before the local default takes over.
  const aiProviders = useUiStore((s) => s.aiProviders);
  const hybridPresets = useUiStore((s) => s.hybridPresets);
  const blockedModels = useUiStore((s) => s.blockedModels);
  const providerChecks = useQueries({
    queries: PROVIDER_IDS.map((id) => ({
      queryKey: ["cli-detect", id],
      queryFn: () => cliDetect(id),
      enabled: isTauri() && aiProviders[id],
      staleTime: 60_000,
    })),
  });
  const providerReady = PROVIDER_IDS.reduce<Record<ProviderId, boolean>>(
    (out, id, index) => {
      const detected = providerChecks[index]?.data;
      out[id] = !!detected?.installed && !!detected.authenticated;
      return out;
    },
    { claude: false, codex: false, agy: false, gemini: false },
  );
  const providerChecksSettled = PROVIDER_IDS.every(
    (id, index) => !aiProviders[id] || providerChecks[index]?.isFetched,
  );
  const catalogSettled = models.isFetched && providerChecksSettled;
  const groups = mergedModels(
    models.data ?? [],
    aiProviders,
    hybridPresets,
    blockedModels,
    providerReady,
  );
  const modelList = flattenModels(groups);
  const savedPick = modelList.find((m) => m.id === chatModelId);
  const fallbackPick = modelList.find((m) => m.isDefault) ?? modelList[0] ?? null;
  // A persisted remote choice must not silently become the local default while
  // its account probe is still resolving on a fresh launch.
  const waitingForSavedPick =
    !!chatModelId && !catalogSettled && (!savedPick || savedPick.api === "preset");
  const picked = waitingForSavedPick ? null : (savedPick ?? fallbackPick);
  const fallbackFrom =
    catalogSettled && chatModelId && !savedPick && fallbackPick ? chatModelId : null;

  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("thinking…");
  const [images, setImages] = useState<string[]>([]);
  const [visionHint, setVisionHint] = useState(false);
  // a failed chats/<slug>.md write — the thread still shows for this session,
  // but SAY it won't survive a reload (#11, audit 2026-07); cleared on the
  // next successful save.
  const [saveErr, setSaveErr] = useState<string | null>(null);
  // the attached-note toggle (header): creating/opening state + its error slot
  const [noteBusy, setNoteBusy] = useState(false);
  const [noteErr, setNoteErr] = useState<string | null>(null);
  const [measureOpen, setMeasureOpen] = useState(false);
  const [assetsOpen, setAssetsOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const measureBtnRef = useRef<HTMLButtonElement>(null);
  const assetsBtnRef = useRef<HTMLButtonElement>(null);
  // the live turn's cancel key (connected CLIs only — Rust kills the child)
  const requestRef = useRef<string | null>(null);

  const writable = active?.perms === "chats+inbox";

  // per-chat web toggle (the composer globe) — keyed by slug; a not-yet-saved chat
  // rides a PANE-scoped key (session-only, never persisted): a shared "" key leaked
  // one globe click into every future fresh chat across relaunches (#7, audit 2026-07)
  const webKey = chatSlug ?? `unsaved:${paneId}`;
  const globeOn = chatWeb[webKey] ?? false;
  // per-chat measure rides the same key; missing = the tuned comfort column
  const measure: Measure = chatMeasure[webKey] ?? "comfort";
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

    const requestId = crypto.randomUUID();
    requestRef.current = requestId;
    const model = { id: picked.id, api: picked.api };
    // the image tool needs a pinned assets dir — a SAVED chat only — and its
    // engine's lane enabled; the globe doesn't gate it
    const image =
      chatSlug && aiProviders[imageEngine]
        ? { root: active.root, slug: chatSlug, engine: imageEngine }
        : undefined;
    const runInput: RunInput = {
      history,
      userText,
      web: globeOn,
      model,
      ...(imgs.length > 0 ? { images: imgs } : {}),
      ...(image ? { imageTool: true } : {}),
    };

    // a preset pick routes through the hybrid layer; everything else is the
    // normal loop. Both yield the same event stream.
    const preset = presetFor(picked.id, hybridPresets);
    const hostOpts = image ? { requestId, image } : { requestId };
    const events = preset
      ? runHybrid(preset, modelList, runInput, (m, o) => makeTauriHost(m, { ...hostOpts, ...o }), requestId)
      : runAgent(makeTauriHost(picked, hostOpts), runInput);

    let reply = "";
    try {
      for await (const ev of events) {
        if (ev.type === "status") setStatus(ev.text);
        else if (ev.type === "final") reply = ev.text;
      }
    } catch (e) {
      reply = `⚠ ${(e as Error)?.message ?? "the model failed"}`;
    }
    requestRef.current = null;
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
    const memoryTurns = [...messages, ...turn];
    try {
      if (chatSlug) {
        const sum = chats.data?.find((c) => c.slug === chatSlug);
        const memoryTitle = sum?.title ?? chatSlug;
        await write.mutateAsync({
          instance: active,
          existingSlug: chatSlug,
          title: memoryTitle,
          messages: turn,
        });
        const memoryStem = (sum?.attachedTo ?? "").replace(/^\[\[|\]\]$/g, "").trim();
        await syncManagedChatMemory({
          instance: active,
          title: memoryTitle,
          chatSlug,
          ...(memoryStem ? { attachedStem: memoryStem } : {}),
          turns: memoryTurns,
        }).catch((error) => setNoteErr(error instanceof Error ? error.message : String(error)));
      } else {
        const memoryTitle = title.trim() || deriveTitle(userText);
        const res = await write.mutateAsync({
          instance: active,
          title: memoryTitle,
          messages: turn,
        });
        await syncManagedChatMemory({
          instance: active,
          title: memoryTitle,
          chatSlug: res.slug,
          turns: memoryTurns,
        }).catch((error) => setNoteErr(error instanceof Error ? error.message : String(error)));
        bindChat(paneId, res.slug); // this tab now IS that chat
        if (globeOn) setChatWeb(res.slug, true); // carry the globe to the saved chat
        clearChatWeb(webKey); // the pane-scoped unsaved key is spent (#7)
        const m = chatMeasure[webKey];
        if (m) setChatMeasure(res.slug, m); // carry the measure the same way
        clearChatMeasure(webKey);
        setTitle("");
      }
      setSaveErr(null);
    } catch (e) {
      // persistence failed — the in-memory thread still shows for this session,
      // and the inline note below the thread says it won't survive a reload
      setSaveErr(e instanceof Error ? e.message : String(e));
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

  // the STORED title, not the de-dashed slug (#87, audit 2026-07): the slug is
  // truncated + date/ulid-suffixed wire plumbing; the frontmatter `title` is
  // what the user named it (the sidebar/All-chats already show it). Slug stays
  // the fallback while the listing loads or for a title-less foreign chat.
  const summary = chatSlug ? chats.data?.find((c) => c.slug === chatSlug) : undefined;
  const storedTitle = summary?.title ?? null;
  // the chat's attached note, as its staging stem ("[[<slug>-<id6>]]" stripped)
  const attachedStem = (summary?.attachedTo ?? "").replace(/^\[\[|\]\]$/g, "").trim();

  // this chat's generated assets: everything under storage/chats/<slug>/ in the
  // active root (wire ids are bare for the corpus, "<rootid>:rel" otherwise)
  const assetPrefix =
    active && chatSlug
      ? `${active.id === CORPUS_INSTANCE_ID ? "" : `${active.id}:`}storage/chats/${chatSlug}/`
      : null;
  const assetIds = assetPrefix
    ? [...noteIndex.keys()].filter((id) => id.startsWith(assetPrefix)).sort()
    : [];

  /** Open the attached note per the Settings choice: a new tab here, or a
   * right split beside the chat (split() focuses the new pane, so openNote
   * lands in it). */
  const openAttachedNote = (noteId: string) => {
    if (chatNoteOpen === "split") {
      splitRight();
      openNote(noteId);
    } else {
      openNote(noteId, { newTab: true });
    }
  };

  /** The header note toggle — every chat has a note; it MATERIALIZES on first
   * open (lazy, so quick chats never litter the staging inbox with empties).
   * An existing note is resolved by its stem's ULID tail — the id never changes
   * when the organizer files it, so the match survives moves; a missing note
   * (deleted) self-heals by creating a fresh one. */
  const onNoteToggle = async () => {
    if (!active || !chatSlug || noteBusy) return;
    if (attachedStem) {
      const tail = attachedStem.slice(-6).toLowerCase();
      for (const id of noteIndex.keys()) {
        if (id.slice(-6).toLowerCase() === tail) {
          openAttachedNote(id);
          return;
        }
      }
      // not in the index (deleted, or a cold listing) — fall through, re-create
    }
    setNoteBusy(true);
    setNoteErr(null);
    try {
      const name = storedTitle || chatSlug.replace(/-/g, " ");
      const { id, stem } = await writeNote({
        instance: active,
        body: `# ${name}\n\n> chat: [[${chatSlug}]]\n\n`,
      });
      await setAttached.mutateAsync({ instance: active, slug: chatSlug, stem });
      await invalidateNotes();
      const prefix = active.id === CORPUS_INSTANCE_ID ? "" : `${active.id}:`;
      openAttachedNote(`${prefix}${id}`);
    } catch (e) {
      setNoteErr(e instanceof Error ? e.message : String(e));
    } finally {
      setNoteBusy(false);
    }
  };

  return (
    <div
      className="chat-surface"
      style={{ "--chat-measure": `${CHAT_MEASURE_PX[measure]}px` } as CSSProperties}
    >
      <header className="chat-head">
        <h2 className="chat-title-h">
          {chatSlug ? storedTitle || chatSlug.replace(/-/g, " ") : "New chat"}
        </h2>
        {active && <span className="chat-inst">· {active.label}</span>}
        {active && (
          <div className="chat-head-tools">
            {assetIds.length > 0 && (
              <>
                <button
                  ref={assetsBtnRef}
                  type="button"
                  className="chat-tool"
                  title={`Assets generated in this chat (${assetIds.length})`}
                  onClick={() => setAssetsOpen((v) => !v)}
                >
                  <AssetsGlyph />
                </button>
                {assetsOpen && (
                  <AssetsDrawer
                    ids={assetIds}
                    anchorRef={assetsBtnRef}
                    onOpen={(id) => {
                      setAssetsOpen(false);
                      openFile(id, { newTab: true });
                    }}
                    onClose={() => setAssetsOpen(false)}
                  />
                )}
              </>
            )}
            <button
              ref={measureBtnRef}
              type="button"
              className="chat-tool"
              title="Chat width — Narrow / Comfort / Wide"
              onClick={() => setMeasureOpen((v) => !v)}
            >
              <WidthGlyph />
            </button>
            {measureOpen && (
              <MeasureMenu
                value={measure}
                anchorRef={measureBtnRef}
                onPick={(m) => setChatMeasure(webKey, m)}
                onClose={() => setMeasureOpen(false)}
              />
            )}
            <button
              type="button"
              className={attachedStem ? "chat-tool on" : "chat-tool"}
              disabled={!chatSlug || !writable || noteBusy}
              title={
                !chatSlug
                  ? "Send a message first — the note attaches to the saved chat"
                  : attachedStem
                    ? "Open this chat's note"
                    : "Create this chat's note"
              }
              onClick={() => void onNoteToggle()}
            >
              <NoteGlyph />
            </button>
          </div>
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
              {saveErr && (
                <p className="file-err chat-save-err" role="alert">
                  ⚠ This conversation couldn’t be saved — it stays for this session but won’t
                  survive a reload. {saveErr}
                </p>
              )}
              {noteErr && (
                <p className="file-err chat-save-err" role="alert">
                  ⚠ Couldn’t create this chat’s note. {noteErr}
                </p>
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
                    {waitingForSavedPick ? (
                      <span className="chat-model-checking" role="status">
                        Checking model…
                      </span>
                    ) : modelList.length > 0 ? (
                      <ModelPicker
                        groups={groups}
                        picked={picked ?? null}
                        fallbackFrom={fallbackFrom}
                        onPick={(id) => {
                          setChatModelId(id);
                          setVisionHint(false);
                        }}
                      />
                    ) : null}
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
                    {(() => {
                      // connected CLIs (and presets, which may route to one)
                      // cancel for real — Rust kills the child mid-step
                      const cancellable = picked?.api === "cli" || picked?.api === "preset";
                      return (
                        <button
                          type="button"
                          className="chat-send"
                          aria-label={busy && cancellable ? "Stop" : "Send"}
                          title={busy && cancellable ? "Stop this reply" : undefined}
                          disabled={busy ? !cancellable : !message.trim() || !picked}
                          onClick={() => {
                            if (busy) {
                              if (requestRef.current) void cliCancel(requestRef.current).catch(() => {});
                              return;
                            }
                            void send();
                          }}
                        >
                          {busy ? cancellable ? <StopGlyph /> : <SpinGlyph /> : <SendGlyph />}
                        </button>
                      );
                    })()}
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
