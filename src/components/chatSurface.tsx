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

import { useQueries, useQuery } from "@tanstack/react-query";
import {
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { modelIsOnDevice } from "../ai/guard";
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
import { syncManagedChatMemory } from "../chatMemory/composition";
import {
  attachedNoteId as resolveAttachedNoteId,
  buildChatNotesPrompt,
  type MemoryTurn,
} from "../chatMemory/model";
import { renderMermaidElement } from "../editor/mermaidRender";
import { renderInline } from "../editor/render";
import { fileName } from "../lib/fileKind";
import { type AnchoredPlacement, anchoredPopover, useTransientPopover } from "../lib/popover";
import {
  type ChatModelInfo,
  type LocalQueueEntry,
  chatModels,
  cliCancel,
  cliDetect,
  corpusFrontmatter,
  corpusImportFile,
  fileAssetUrl,
  isTauri,
  localQueueCancel,
  localQueuePrioritize,
  onLocalQueue,
  resolveImageSrc,
} from "../lib/tauri";
import { CORPUS_INSTANCE_ID, activeInstance } from "../memex/config";
import { hasSecureContext } from "../memex/contract";
import { markChatSecureContext, readChat, writeNote } from "../memex/service";
import { useInstanceChats, useMemexConfig, useSetChatAttachedTo, useWriteChat } from "../memex/useMemex";
import { splitMessageBlocks } from "../noteChat/chatMessageBlocks";
import { rememberedChatNote, rememberChatNote } from "../noteChat/session";
import {
  assignChatToFolder,
  invalidateChatFolders,
  loadChatFolders,
  saveChatFolders,
} from "../services/chatFolders";
import { invalidateNotes, useNoteIndex } from "../services/hooks";
import { assignChatToView } from "../services/viewTree";
import { useChatRuns } from "../state/chatRuns";
import { type Measure } from "../state/noteStyle";
import { usePanesStore } from "../state/panes";
import { chatKey, chatModelFor, useUiStore } from "../state/ui";
import { useViewsStore } from "../state/views";
import { Character, QuokkaMark } from "./character";
import { CHAT_PANE_ATTR, registerChatDrop } from "./chatDrop";
import { CheckGlyph, CloudGlyph, CopyGlyph, EyeGlyph, LaptopGlyph } from "./glyphs";

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
    // readAsDataURL always yields a string; narrow rather than String()-ing the
    // union, which would hand a caller the literal "[object ArrayBuffer]".
    r.onload = () =>
      typeof r.result === "string" ? resolve(r.result) : reject(new Error("couldn't read the image"));
    r.onerror = () => reject(r.error ?? new Error("couldn't read the image"));
    r.readAsDataURL(file);
  });
}

/** Composer affordance glyphs — line-art, theme-aware (currentColor). */
function GlobeGlyph() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="6.2" />
      <ellipse cx="8" cy="8" rx="2.6" ry="6.2" />
      <path d="M2 8h12M3.2 5h9.6M3.2 11h9.6" />
    </svg>
  );
}
function ClipGlyph() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M11.7 5.6 6.4 10.9a2 2 0 0 1-2.8-2.8l5.4-5.4a3 3 0 0 1 4.3 4.3l-5.4 5.4" />
    </svg>
  );
}

function NoteGlyph() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 1.8h5.5L13 5.3v8.9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V2.8a1 1 0 0 1 1-1z" />
      <path d="M9.5 1.8v3.5H13M5.5 8.5h5M5.5 11h5" />
    </svg>
  );
}
function WidthGlyph() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2.2 2.5v11M13.8 2.5v11" />
      <path d="M4.6 8h6.8M4.6 8l1.8-1.8M4.6 8l1.8 1.8M11.4 8l-1.8-1.8M11.4 8l-1.8 1.8" />
    </svg>
  );
}
function SendGlyph() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M8 12.5v-9M4 7l4-3.5L12 7" />
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
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="2" y="2.8" width="12" height="10.4" rx="1.5" />
      <circle cx="5.6" cy="6.4" r="1.1" />
      <path d="M2.5 12 6.7 8.2l2.6 2.4 2.3-2 1.9 1.7" />
    </svg>
  );
}

/** One generated asset in the drawer — thumbnail via the asset protocol. */
function AssetThumb({ id, onOpen }: { id: string; onOpen: () => void }) {
  const url = useQuery({ queryKey: ["asset-url", id], queryFn: () => fileAssetUrl(id) });
  const name = fileName(id);
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
 * model UX pass, phase 2).
 *
 * The list is PORTALED to <body> and placed in viewport coordinates
 * (anchoredPopover). It used to be a pane-relative absolute box with a 62vh
 * cap: in a split the composer sits mid-window, so the list opened upward
 * straight past the window's top edge and came back clipped — a menu starting
 * mid-air over the transcript (Seth, 2026-08-01). Same idiom as the shared
 * context-menu host: fixed, clamped, measured. */
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
  const [box, setBox] = useState<AnchoredPlacement | null>(null);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<Array<HTMLButtonElement | null>>([]);
  useTransientPopover([popRef, anchorRef], open, () => setOpen(false));

  // Place against the trigger's VIEWPORT rect, remeasuring while the list is
  // open: its own size changes (the fallback notice, a lane finishing its
  // probe), the window resizes, and any ancestor can scroll under it.
  useLayoutEffect(() => {
    if (!open) {
      setBox(null);
      return;
    }
    const place = () => {
      const anchor = anchorRef.current?.getBoundingClientRect();
      const pop = popRef.current;
      if (!anchor || !pop) return;
      const next = anchoredPopover(
        { top: anchor.top, bottom: anchor.bottom, left: anchor.left },
        // scrollHeight is the list's UNCAPPED height — measuring offsetHeight
        // would just re-read the cap we applied last pass and never flip back
        { width: pop.offsetWidth, height: pop.scrollHeight },
        { width: window.innerWidth, height: window.innerHeight },
      );
      // applying max-height resizes the list, which re-fires the observer —
      // settling on the same numbers ends it instead of re-rendering forever
      setBox((cur) =>
        cur &&
        cur.left === next.left &&
        cur.top === next.top &&
        cur.maxHeight === next.maxHeight &&
        cur.placement === next.placement
          ? cur
          : next,
      );
    };
    place();
    const observer = new ResizeObserver(place);
    if (popRef.current) observer.observe(popRef.current);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

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
  // the identity-picking effect below deliberately keys off flatKey/picked?.id
  // (cheap primitives) rather than the flatItems/picked objects themselves —
  // those are rebuilt every render, so depending on them directly would refocus
  // on every keystroke elsewhere in the app. Refs carry the latest values in.
  const flatItemsRef = useRef(flatItems);
  flatItemsRef.current = flatItems;
  const pickedRef = useRef(picked);
  pickedRef.current = picked;
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
    const items = flatItemsRef.current;
    const current = pickedRef.current;
    if (!open || items.length === 0) return;
    const selected = current ? items.findIndex((m) => m.id === current.id) : -1;
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
      {open &&
        createPortal(
          <div
            className="chat-modelpop"
            ref={popRef}
            role="menu"
            aria-label="Model"
            data-placement={box?.placement ?? "up"}
            onKeyDown={onMenuKeyDown}
            style={{
              left: box?.left ?? 0,
              top: box?.top ?? 0,
              maxHeight: box?.maxHeight,
              // the first pass measures; showing it before it is placed would
              // flash the list in the window's top-left corner
              visibility: box ? undefined : "hidden",
            }}
          >
            {fallbackFrom && (
              <div className="chat-modelpop-notice">
                Saved model <b>{shortModelLabel(fallbackFrom)}</b> is unavailable. Using the fallback shown in
                the composer.
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
                    </button>
                  );
                })}
              </div>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}

/** The processing vocabulary (Seth, 2026-07-30: "add something fun here") —
 * quiet, warm, rotli-toned. The loop's generic "thinking…" statuses rotate
 * through these; REAL tool statuses ("searching notes…") always win. */
const THINK_WORDS = [
  "thinking…",
  "reading the shelves…",
  "connecting dots…",
  "flipping through notes…",
  "following a hunch…",
  "brewing an answer…",
  "lining up the facts…",
] as const;

const isThinkWord = (s: string): boolean => (THINK_WORDS as readonly string[]).includes(s);

/** A mermaid fence in a reply, rendered as the real diagram (generative UI,
 * Seth 2026-08-03). Async render off the shared editor engine; while it loads
 * — or when the source doesn't parse (a model mid-stream, or plain wrong) —
 * the source shows as code, so nothing ever blanks out. */
function ChatMermaid({ code }: { code: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const renderSeq = useRef(0);
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const seq = ++renderSeq.current;
    setFailed(false);
    const dark = ["dark", "charcoal"].includes(document.documentElement.dataset.theme ?? "");
    void renderMermaidElement(code, { dark, id: `rotli-chat-mermaid-${seq}-${Date.now()}` })
      .then((element) => {
        if (renderSeq.current === seq) host.replaceChildren(element);
      })
      .catch(() => {
        if (renderSeq.current === seq) setFailed(true);
      });
    return () => {
      host.replaceChildren();
    };
  }, [code]);
  return failed ? (
    <pre className="cmsg-code">
      <code>{code}</code>
    </pre>
  ) : (
    <div className="cmsg-mermaid" ref={hostRef} />
  );
}

/** Render an assistant message as light markdown: ``` fenced code → <pre>,
 * ```mermaid → the rendered diagram, GFM tables → real tables, every other
 * line via the editor's inline renderer (bold/italic/code/links), blank lines
 * kept as gaps. Source-of-truth stays the .md; this is display only. */
function renderMessage(text: string): ReactNode {
  return splitMessageBlocks(text).map((block, key) => {
    switch (block.kind) {
      case "code":
        return (
          <pre key={key} className="cmsg-code">
            <code>{block.code}</code>
          </pre>
        );
      case "mermaid":
        return <ChatMermaid key={key} code={block.code} />;
      case "table":
        return (
          <div key={key} className="cmsg-tablewrap">
            <table className="cmsg-table">
              <thead>
                <tr>
                  {block.header.map((cell, c) => (
                    <th key={c}>{renderInline(cell)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, r) => (
                  <tr key={r}>
                    {row.map((cell, c) => (
                      <td key={c}>{renderInline(cell)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      case "lines":
        return block.lines.map((line, l) => (
          <div key={`${key}-${l}`} className="cmsg-line">
            {line ? renderInline(line) : " "}
          </div>
        ));
    }
  });
}

// memo: renderMessage re-parses a whole message's markdown on every render, and
// the surface re-renders on every composer keystroke and every thinking-status
// tick. With a primitive `text` prop and a stable onCopy, settled messages skip
// the parse; a message whose text changed still re-renders (perf audit
// 2026-07-30, finding 10).
const ChatMessage = memo(function ChatMessage({
  text,
  you,
  index,
  copied,
  onCopy,
}: {
  text: string;
  you: boolean;
  index: number;
  copied: boolean;
  onCopy: (index: number, text: string) => void;
}) {
  return (
    <div className={you ? "cmsg you" : "cmsg ai"}>
      <div className="cmsg-bubble">{you ? text : renderMessage(text)}</div>
      <div className="cmsg-actions">
        <button
          type="button"
          className="cmsg-act"
          aria-label="Copy message"
          title="Copy"
          onClick={() => onCopy(index, text)}
        >
          {copied ? <CheckGlyph size={13} /> : <CopyGlyph size={13} />}
        </button>
      </div>
    </div>
  );
});

export function ChatSurface({ paneId, chatSlug }: { paneId: string; chatSlug: string | null }) {
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen);
  // the seed a NEW chat starts on (the last model picked anywhere) + the
  // per-chat map that owns every chat's actual choice
  const chatModelSeed = useUiStore((s) => s.chatModelId);
  const setChatModelSeed = useUiStore((s) => s.setChatModelId);
  const chatModelMap = useUiStore((s) => s.chatModel);
  const setChatModel = useUiStore((s) => s.setChatModel);
  const clearChatModel = useUiStore((s) => s.clearChatModel);
  const chatWeb = useUiStore((s) => s.chatWeb);
  const setChatWeb = useUiStore((s) => s.setChatWeb);
  const clearChatWeb = useUiStore((s) => s.clearChatWeb);
  const chatMeasure = useUiStore((s) => s.chatMeasure);
  const setChatMeasure = useUiStore((s) => s.setChatMeasure);
  const clearChatMeasure = useUiStore((s) => s.clearChatMeasure);
  const chatNoteOpen = useUiStore((s) => s.chatNoteOpen);
  const imageEngine = useUiStore((s) => s.imageEngine);
  const isFocusedPane = usePanesStore((s) => s.focusedPaneId === paneId);
  const bindChat = usePanesStore((s) => s.bindChat);
  const openNote = usePanesStore((s) => s.openNote);
  const openFile = usePanesStore((s) => s.openFile);
  const openToSide = usePanesStore((s) => s.openToSide);
  const noteIndex = useNoteIndex();
  const setAttached = useSetChatAttachedTo();

  const cfg = useMemexConfig();
  const active = cfg.data ? activeInstance(cfg.data) : null;
  const chats = useInstanceChats(active);
  const write = useWriteChat();
  // The stored title is presentation; attachment identity is the note stem.
  // A session mapping makes a just-created note chat immediately resolvable,
  // while a current or preserved filename alias restores it after relaunch.
  // The resolver retains the old id-tail path for pre-readable-name chats.
  const summary = chatSlug ? chats.data?.find((chat) => chat.slug === chatSlug) : undefined;
  const storedTitle = summary?.title ?? null;
  const attachedStem = (summary?.attachedTo ?? "").replace(/^\[\[|\]\]$/g, "").trim();
  const attachedNoteId =
    rememberedChatNote(chatSlug) ??
    (attachedStem ? resolveAttachedNoteId(attachedStem, noteIndex.values()) : null);
  const secureAttachmentHint = attachedStem.startsWith("secure-note-");

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
  const allGroups = mergedModels(models.data ?? [], aiProviders, hybridPresets, blockedModels, providerReady);
  // A secure-note chat never offers a connected or routing model — and neither
  // does a loose chat whose history was fed by a secure-note read (the
  // secureContext taint, audit 2026-07-29 #7). The exact frontmatter is
  // rechecked on send as the authoritative backstop.
  const [secureContext, setSecureContext] = useState(false);
  const secureChat = secureAttachmentHint || secureContext;
  const groups: ModelGroups = secureChat ? { ...allGroups, connected: [], presets: [] } : allGroups;
  const modelList = flattenModels(groups);
  // THIS chat's model — its own pick, or the new-chat seed until it has one.
  // Independent per chat (Seth, 2026-08-01): two chat panes side by side each
  // send to their own model, and picking in one never moves the other.
  const chatKeyId = chatKey(active?.id ?? null, chatSlug, paneId);
  const chatModelId = chatModelFor(chatModelMap, chatKeyId, chatModelSeed);
  const savedPick = modelList.find((m) => m.id === chatModelId);
  const fallbackPick = modelList.find((m) => m.isDefault) ?? modelList[0] ?? null;
  // A persisted remote choice must not silently become the local default while
  // its account probe is still resolving on a fresh launch.
  const waitingForSavedPick = !!chatModelId && !catalogSettled && (!savedPick || savedPick.api === "preset");
  const picked = waitingForSavedPick ? null : (savedPick ?? fallbackPick);
  const fallbackFrom = catalogSettled && chatModelId && !savedPick && fallbackPick ? chatModelId : null;
  // Pin the resolved model onto this chat as soon as the catalog is settled: an
  // inherited seed becomes THIS chat's own choice, so a pick made in another
  // pane (which also moves the seed, for the next new chat) can't move it.
  // Guarded on catalogSettled so a still-probing remote lane is never pinned as
  // the local fallback.
  const resolvedModelId = picked?.id ?? null;
  const chatOwnsModel = chatModelMap[chatKeyId] !== undefined;
  useEffect(() => {
    if (!catalogSettled || !resolvedModelId || chatOwnsModel) return;
    setChatModel(chatKeyId, resolvedModelId);
  }, [catalogSettled, resolvedModelId, chatOwnsModel, chatKeyId, setChatModel]);

  /** Pick a model FOR THIS CHAT, and seed the next new chat with it. */
  const pickModel = (id: string) => {
    setChatModel(chatKeyId, id);
    setChatModelSeed(id);
  };

  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string>(THINK_WORDS[0]!);
  // the on-device answer forming token-by-token — shown live in the assistant
  // row while it streams, then replaced by the settled message. The ref mirrors
  // it so Stop can keep whatever partial text arrived without a stale closure.
  const [streamingText, setStreamingText] = useState("");
  const streamRef = useRef("");
  const setStreaming = useCallback((next: string) => {
    streamRef.current = next;
    setStreamingText(next);
  }, []);
  // which message's hover Copy just fired — flips its glyph to a ✓ for a beat
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
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
  const msgRef = useRef<HTMLTextAreaElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  /** One-shot: a new chat opens with the caret in its title field, and nothing
   * later steals focus back (Seth, 2026-08-04). */
  const didFocusTitle = useRef(false);
  // true once THIS chat's history carries secure-note content (loaded marker
  // or a secure read during a live turn) — drives the one-way taint
  const secureReadRef = useRef(false);
  const measureBtnRef = useRef<HTMLButtonElement>(null);
  const assetsBtnRef = useRef<HTMLButtonElement>(null);
  // the live turn's cancel key (connected CLIs — Rust kills the child)
  const requestRef = useRef<string | null>(null);
  // run sequence: Stop orphans the in-flight run — its late events and reply
  // must land NOWHERE (the local lane can't abort the HTTP mid-generation;
  // orphaning is the honest cancel: the UI is free, the result is discarded)
  const runSeq = useRef(0);
  // what Stop gives back to the composer — the sent prompt returns intact
  const lastSentRef = useRef<{ text: string; images: string[] } | null>(null);
  // this turn's place in the local-compute queue, or null when it's actually
  // generating. Local models share one Mac: a send that doesn't fit measured
  // headroom WAITS rather than piling on (docs/design/local-compute-guardrails.md).
  const [queued, setQueued] = useState<LocalQueueEntry | null>(null);

  // stable across renders so the memoized message rows keep skipping — the ✓
  // beat is undone only if that same row is still the copied one.
  const onCopyMessage = useCallback((idx: number, text: string) => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopiedIdx(idx);
      window.setTimeout(() => setCopiedIdx((cur) => (cur === idx ? null : cur)), 1200);
    });
  }, []);

  const writable = active?.perms === "chats+inbox";

  // per-chat web toggle (the composer globe) — keyed by slug; a not-yet-saved chat
  // rides a PANE-scoped key (session-only, never persisted): a shared "" key leaked
  // one globe click into every future fresh chat across relaunches (#7, audit 2026-07).
  // The model map above rides the very same key.
  const webKey = chatKeyId;
  const globeOn = secureChat ? false : (chatWeb[webKey] ?? false);
  // per-chat measure rides the same key; missing = the tuned comfort column
  const measure: Measure = chatMeasure[webKey] ?? "comfort";
  // image attach is gated on the picked model's vision capability
  const canVision = picked?.vision ?? false;
  const visionModels = modelList.filter((m) => m.vision);

  // the sidebar's run signals (2026-08-03): opening this chat spends its unread
  // flag, and the aliveRef tells a completing run whether its reply was WATCHED
  // (surface still mounted) or should flip the row to unread.
  const aliveRef = useRef(true);
  // busy, readable from effects without joining their deps: the send-time bind
  // flips chatSlug mid-run, and the reload-on-slug-change effect must NOT
  // clobber the live thread (or the run's secure taint) from the disk file —
  // which at that moment holds only the just-sent user turn.
  const busyRef = useRef(false);
  useEffect(() => {
    aliveRef.current = true;
    useChatRuns.getState().clearUnread(chatKeyId);
    return () => {
      aliveRef.current = false;
    };
  }, [chatKeyId]);

  // load THIS pane's chat (by slug), or clear for a fresh chat. A LIVE run owns
  // the surface: the send-time bind changes chatSlug mid-turn, and reloading
  // then would wipe the streaming thread and reset the run's secure taint from
  // a file that only holds the user turn so far.
  useEffect(() => {
    if (busyRef.current) return;
    let cancelled = false;
    if (active && chatSlug) {
      readChat(active, chatSlug)
        .then((t) => {
          if (cancelled) return;
          setMessages(parseMessages(t));
          const tainted = hasSecureContext(t);
          secureReadRef.current = tainted;
          setSecureContext(tainted);
        })
        .catch(() => !cancelled && setMessages([]));
    } else {
      setMessages([]);
      secureReadRef.current = false;
      setSecureContext(false);
    }
    return () => {
      cancelled = true;
    };
  }, [active, chatSlug]);

  // A NEW chat opens ready to be NAMED (Seth, 2026-08-04: "by default be in the
  // top part where I can instantly type the name of the chat") — ⏎ from there
  // still skips straight to the composer. Deps rather than mount-only because
  // `writable` resolves with the memex config, so the input may not exist on
  // the first paint; the ref makes it fire exactly once, so a later config
  // refetch can never yank focus out of the message box. Only the FOCUSED
  // pane's chat claims focus — a chat opened into a split must not steal it.
  useEffect(() => {
    if (didFocusTitle.current || chatSlug || !writable || !isFocusedPane) return;
    didFocusTitle.current = true;
    titleRef.current?.focus();
  }, [chatSlug, writable, isFocusedPane]);

  // keep the newest message in view — including the live streaming row as it grows
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight });
  }, [messages, busy, streamingText]);

  // the composer grows with its content (WKWebView has no field-sizing) —
  // the CSS max-height caps it around seven lines, then it scrolls inside
  useLayoutEffect(() => {
    const el = msgRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [message]);

  const send = async () => {
    // an image with no words is a real message ("what is this?") — the guard
    // used to require text, so attaching a picture and pressing send did nothing
    if (!active || !writable || (!message.trim() && images.length === 0) || busy) return;
    if (!picked) {
      setMessages((p) => [
        ...p,
        { speaker: "rotli", text: "⚠ No on-device model is set up — add one in your memex AI store." },
      ]);
      return;
    }
    let attachmentIsSecure = secureAttachmentHint;
    if (attachedNoteId) {
      try {
        const frontmatter = await corpusFrontmatter(attachedNoteId);
        if (!frontmatter) throw new Error("missing note security metadata");
        attachmentIsSecure = attachmentIsSecure || frontmatter.secure === true;
      } catch {
        setMessages((previous) => [
          ...previous,
          {
            speaker: "rotli",
            text: "⚠ Rotli couldn’t verify this attached note’s security state, so nothing was sent to a model.",
          },
        ]);
        return;
      }
    }
    // the whole secure lineage: attached-secure, or the chat's own taint
    const attachedSecure = attachmentIsSecure || secureReadRef.current;
    if (attachedSecure && !modelIsOnDevice(picked)) {
      setMessages((previous) => [
        ...previous,
        {
          speaker: "rotli",
          text: "⚠ This chat carries secure-note content. Choose an on-device model to continue.",
        },
      ]);
      return;
    }
    const typed = message.trim();
    const imgs = images;
    // An attachment becomes PART OF THE MESSAGE (Seth, 2026-08-04: "like a
    // #image one like claude does so we can reference it and talk about it").
    // The token is what makes an image referable afterwards — "what's in image
    // 2?" — and it's the only trace the transcript keeps, since the bytes
    // themselves never land in chats/<slug>.md.
    const userText =
      imgs.length > 0
        ? `${imgs.map((_, i) => `[Image #${i + 1}]`).join(" ")}${typed ? `\n${typed}` : ""}`
        : typed;
    lastSentRef.current = { text: typed, images: imgs };
    setMessage("");
    setImages([]);
    // history = the prior turns; the new user message rides as runAgent's userText
    const history: ChatTurn[] = messages.map((m) => ({
      role: m.speaker === "you" ? "user" : "assistant",
      text: m.text,
    }));
    setMessages((p) => [...p, { speaker: "you", text: userText }]);
    setBusy(true);
    busyRef.current = true;
    setStatus(THINK_WORDS[0]!);
    setStreaming("");
    const myRun = ++runSeq.current;

    // — persist the user turn NOW (Seth, 2026-08-03: "once sent, instantly I
    // should see it in the left bar"): the chat file exists (or bumps its
    // mtime) before the model even starts, so the sidebar row appears at the
    // top, pulsing, the moment Send is pressed. A brand-new chat binds its tab
    // HERE, synchronously with the send — which also retires the old
    // completion-time bind race (the reply used to bind to whatever chat tab
    // was active in the pane by then). If the write fails (read-only vault,
    // disk trouble), the run continues in-memory and the completion path falls
    // back to the old persist-at-the-end shape — same net behavior as before.
    const sentTitle = title.trim() || deriveTitle(userText);
    let sentSlug: string | null = chatSlug;
    let sentPersisted = false;
    try {
      if (chatSlug) {
        await write.mutateAsync({
          instance: active,
          existingSlug: chatSlug,
          title: storedTitle ?? chatSlug,
          messages: [{ speaker: "you", text: userText }],
        });
      } else {
        const res = await write.mutateAsync({
          instance: active,
          title: sentTitle,
          messages: [{ speaker: "you", text: userText }],
        });
        sentSlug = res.slug;
        bindChat(paneId, res.slug); // this tab IS that chat, from the send on
        // view inheritance: a chat born while a named view is active belongs to
        // that view (Seth, 2026-08-03: organize chats by work vs personal)
        const bornInView = useUiStore.getState().activeView;
        if (bornInView) {
          const views = useViewsStore.getState();
          if (views.hydrated && views.writable) {
            views.setManifest(assignChatToView(views.manifest, res.slug, bornInView));
          }
        }
        // folder inheritance (Seth, 2026-07-30): a new chat opened FROM a
        // foldered chat files itself into the same folder. Best-effort — a
        // manifest hiccup must never fail the send.
        const originSlug = useUiStore.getState().newChatOrigin;
        useUiStore.getState().setNewChatOrigin(null);
        if (originSlug) {
          try {
            const manifest = await loadChatFolders(active);
            const folderId = manifest.assignments[originSlug];
            if (folderId) {
              await saveChatFolders(active, assignChatToFolder(manifest, res.slug, folderId));
              await invalidateChatFolders();
            }
          } catch {
            /* the chat still saved — folder filing is recoverable by hand */
          }
        }
        // the saved chat's maps ride the VAULT-scoped key (2026-08-03)
        const savedKey = chatKey(active.id, res.slug, paneId);
        if (globeOn) setChatWeb(savedKey, true); // carry the globe to the saved chat
        clearChatWeb(webKey); // the pane-scoped unsaved key is spent (#7)
        const m = chatMeasure[webKey];
        if (m) setChatMeasure(savedKey, m); // carry the measure the same way
        clearChatMeasure(webKey);
        const pinnedModel = chatModelMap[webKey] ?? picked.id;
        setChatModel(savedKey, pinnedModel); // and the model this chat runs on
        clearChatModel(webKey);
        setTitle("");
      }
      sentPersisted = true;
      setSaveErr(null);
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : String(e));
    }
    const runKey = sentSlug ? chatKey(active.id, sentSlug, paneId) : chatKeyId;
    useChatRuns.getState().markRunning(runKey); // the sidebar row starts pulsing

    const requestId = crypto.randomUUID();
    requestRef.current = requestId;
    const model = { id: picked.id, api: picked.api };
    // the image tool needs a pinned assets dir — a SAVED chat only (which a
    // just-sent fresh chat now is) — and its engine's lane enabled
    const image =
      !attachedSecure && sentSlug && aiProviders[imageEngine]
        ? { root: active.root, slug: sentSlug, engine: imageEngine }
        : undefined;
    const userName = useUiStore.getState().userName.trim();
    const runInput: RunInput = {
      history,
      userText,
      web: attachedSecure ? false : globeOn,
      model,
      ...(attachedNoteId ? { noteId: attachedNoteId } : {}),
      ...(imgs.length > 0 ? { images: imgs } : {}),
      ...(image ? { imageTool: true } : {}),
      // the board tool is local conversion — offered whenever the desktop
      // bridge exists (the host re-checks the secure taint at call time)
      ...(isTauri() ? { boardTool: true } : {}),
      ...(userName ? { userName } : {}),
    };

    // a preset pick routes through the hybrid layer; everything else is the
    // normal loop. Both yield the same event stream.
    const preset = presetFor(picked.id, hybridPresets);
    // a secure-note read mid-run taints the chat immediately (UI + this
    // turn's persistence) and one-way — the marker lands on the chat file below
    const onSecureNoteRead = () => {
      secureReadRef.current = true;
      setSecureContext(true);
    };
    // live view of the taint, so a create_note AFTER a secure read in the
    // same run already sees the secure context (PR #4 P1)
    const isSecureContext = () => secureReadRef.current || attachedSecure;
    const baseOpts = { requestId, onSecureNoteRead, isSecureContext };
    const hostOpts = image ? { ...baseOpts, image } : baseOpts;
    const events = preset
      ? runHybrid(preset, modelList, runInput, (m, o) => makeTauriHost(m, { ...hostOpts, ...o }), requestId)
      : runAgent(makeTauriHost(picked, hostOpts), runInput);

    let reply = "";
    try {
      for await (const ev of events) {
        if (runSeq.current !== myRun) return; // stopped — discard everything late
        if (ev.type === "status") {
          // the loop's generic thinking beats join the rotating vocabulary;
          // real tool statuses ("searching notes…") pass through untouched
          setStatus(/^thinking…/.test(ev.text) ? nextThinkWord() : ev.text);
        } else if (ev.type === "delta") {
          // the on-device answer, arriving as it's written — append to the live
          // row (a tool step or the thought scaffolding emits no deltas)
          setStreaming(streamRef.current + ev.text);
        } else if (ev.type === "final") reply = ev.text;
      }
    } catch (e) {
      reply = `⚠ ${(e as Error)?.message ?? "the model failed"}`;
    }
    if (runSeq.current !== myRun) return; // stopped mid-generation — the reply lands nowhere
    requestRef.current = null;
    setStreaming(""); // the settled message row takes over from the live one
    setBusy(false);
    busyRef.current = false;

    const failed = reply.startsWith("⚠");
    if (!reply) reply = "(the model returned nothing)";
    setMessages((p) => [...p, { speaker: "rotli", text: reply }]);
    // the answer is IN — settle the sidebar signal now (not after the slower
    // persistence + note-memory pass): watched clears, unwatched flips unread.
    // A failed turn always clears — its ⚠ only lives in this mounted session,
    // so an unread badge would point at nothing.
    useChatRuns.getState().settleRun(runKey, failed || aliveRef.current);
    if (failed) return; // a failed REPLY isn't persisted (the sent user turn already is)

    // persist the assistant turn to chats/<slug>.md (the user turn landed at
    // send time; when THAT write failed, this fallback writes both)
    const turn: Msg[] = [
      { speaker: "you", text: userText },
      { speaker: "rotli", text: reply },
    ];
    const diskTurn: Msg[] = sentPersisted ? [{ speaker: "rotli", text: reply }] : turn;
    const memoryTurns = [...messages, ...turn];
    // the notes-keeping model: the same pick as the chat rewrites the attached
    // note's "Conversation notes" each turn (a preset routes per-leg, so it
    // falls back to the deterministic topics digest instead)
    const composeNotes =
      picked.api === "preset"
        ? undefined
        : (context: { turns: readonly MemoryTurn[]; currentNotes: string | null }) =>
            makeTauriHost(picked, {}).complete({
              messages: [
                { role: "user", content: buildChatNotesPrompt(context.currentNotes, context.turns) },
              ],
            });
    try {
      if (sentSlug) {
        // the normal path: the chat exists on disk (pre-existing, or created
        // at send time above) — append this turn's remainder
        const sum = chats.data?.find((c) => c.slug === sentSlug);
        const memoryTitle = sum?.title ?? (chatSlug ? sentSlug : sentTitle);
        await write.mutateAsync({
          instance: active,
          existingSlug: sentSlug,
          title: memoryTitle,
          messages: diskTurn,
        });
        if (secureReadRef.current) {
          await markChatSecureContext(active, sentSlug).catch(() => {});
        }
        const memoryStem = (sum?.attachedTo ?? "").replace(/^\[\[|\]\]$/g, "").trim();
        // a TAINTED loose chat writes no memory note — its prose must not
        // land in a fresh unlabeled note remote models could read. An
        // attached-secure chat keeps syncing into its own (secure) note.
        if (!secureReadRef.current || attachmentIsSecure) {
          await syncManagedChatMemory({
            instance: active,
            title: memoryTitle,
            chatSlug: sentSlug,
            ...(memoryStem ? { attachedStem: memoryStem } : {}),
            ...(composeNotes ? { composeNotes } : {}),
            model: picked,
            turns: memoryTurns,
          }).catch((error) => setNoteErr(error instanceof Error ? error.message : String(error)));
        }
      } else {
        // fallback: the send-time create failed — the old persist-at-the-end
        // shape, so a transient write error still costs nothing
        const res = await write.mutateAsync({
          instance: active,
          title: sentTitle,
          messages: turn,
        });
        if (secureReadRef.current) {
          await markChatSecureContext(active, res.slug).catch(() => {});
        } else {
          await syncManagedChatMemory({
            instance: active,
            title: sentTitle,
            chatSlug: res.slug,
            ...(composeNotes ? { composeNotes } : {}),
            model: picked,
            turns: memoryTurns,
          }).catch((error) => setNoteErr(error instanceof Error ? error.message : String(error)));
        }
        bindChat(paneId, res.slug); // this tab now IS that chat
        // the run signal + an unread flag follow the unsaved key to the slug
        useChatRuns.getState().retargetRun(runKey, chatKey(active.id, res.slug, paneId));
        // the saved chat's maps ride the VAULT-scoped key (2026-08-03)
        const savedKey = chatKey(active.id, res.slug, paneId);
        if (globeOn) setChatWeb(savedKey, true); // carry the globe to the saved chat
        clearChatWeb(webKey); // the pane-scoped unsaved key is spent (#7)
        const m = chatMeasure[webKey];
        if (m) setChatMeasure(savedKey, m); // carry the measure the same way
        clearChatMeasure(webKey);
        const pinnedModel = chatModelMap[webKey] ?? picked.id;
        setChatModel(savedKey, pinnedModel); // and the model this chat runs on
        clearChatModel(webKey);
        setTitle("");
      }
      setSaveErr(null);
    } catch (e) {
      // persistence failed — the in-memory thread still shows for this session,
      // and the inline note below the thread says it won't survive a reload
      setSaveErr(e instanceof Error ? e.message : String(e));
    }
  };

  /** Rotate the processing word (skipping index 0's plain "thinking…" cycle
   * start is fine — it's in the pool). Pure ref-free pick off the clock. */
  const thinkIdx = useRef(0);
  const nextThinkWord = () => {
    thinkIdx.current = (thinkIdx.current + 1) % THINK_WORDS.length;
    return THINK_WORDS[thinkIdx.current]!;
  };

  // while busy AND showing a vocabulary word, amble to the next one every
  // few seconds — a real tool status parks the rotation until the next beat.
  // Rotation is inlined in the updater (not nextThinkWord) so the interval's
  // closure holds nothing stale (Greptile, PR #17).
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => {
      setStatus((s) => {
        if (!isThinkWord(s)) return s;
        thinkIdx.current = (thinkIdx.current + 1) % THINK_WORDS.length;
        return THINK_WORDS[thinkIdx.current]!;
      });
    }, 2600);
    return () => clearInterval(t);
  }, [busy]);

  // The local-compute queue narrates itself (every admission/wait/prioritize/
  // cancel carries the whole snapshot), so keep only THIS turn's row. The
  // callback reads the live ref, so it never needs re-subscribing.
  useEffect(() => {
    if (!isTauri()) return;
    return onLocalQueue((q) => {
      const id = requestRef.current;
      setQueued(id ? (q.waiting.find((w) => w.requestId === id) ?? null) : null);
    });
  }, []);

  // a turn that isn't live can't still be waiting in line
  useEffect(() => {
    if (!busy) setQueued(null);
  }, [busy]);

  // Leaving the chat NO LONGER cancels a queued send (flip, Seth 2026-08-03:
  // fire off several chats and switch between them — the sidebar's run/unread
  // signals carry the result back). A queued or running turn survives unmount,
  // lands on disk through the same closure, and flips its row to unread.
  // Deliberate abandonment stays one click away: open the chat and Stop.

  /** Stop (Seth, 2026-07-30): orphan the run, kill any CLI child, abort a local
   * stream, and free the surface. If the on-device answer had already begun
   * streaming, KEEP that partial text as the answer (the user asked to stop, not
   * to erase what arrived); otherwise the turn never produced anything, so the
   * optimistic user bubble comes off and the prompt returns to the composer. */
  const stopTurn = () => {
    runSeq.current++;
    if (requestRef.current) {
      void cliCancel(requestRef.current).catch(() => {});
      // take it out of the local-compute line if it was waiting AND flag a
      // running local stream to abort mid-token (drops the socket, frees the slot)
      void localQueueCancel(requestRef.current).catch(() => {});
    }
    requestRef.current = null;
    setQueued(null);
    setBusy(false);
    busyRef.current = false;
    useChatRuns.getState().settleRun(chatKeyId, true); // a stop is watched by definition
    const partial = streamRef.current;
    setStreaming("");
    if (partial) {
      // an answer was forming — settle it as the assistant turn (in-session only;
      // a stopped turn isn't persisted, matching a failed one)
      setMessages((p) => [...p, { speaker: "rotli", text: partial }]);
      return;
    }
    setMessages((p) => (p.length > 0 && p[p.length - 1]?.speaker === "you" ? p.slice(0, -1) : p));
    const sent = lastSentRef.current;
    if (sent) {
      setMessage(sent.text);
      setImages(sent.images);
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

  // — dropped images (Seth, 2026-08-04) — the window handler hands us OS PATHS.
  // Import each into the vault's asset store first (the same lane a drop
  // anywhere else uses), then read it back through the asset protocol: the
  // composer speaks data URLs, and the image becomes a durable vault asset
  // instead of a byte blob that exists only until you hit send.
  const attachPaths = useCallback((paths: readonly string[]) => {
    void (async () => {
      const datas: string[] = [];
      for (const path of paths) {
        try {
          const rel = await corpusImportFile("default", path);
          if (!rel) continue;
          const url = await resolveImageSrc(rel);
          if (!url) continue;
          const blob = await fetch(url).then((r) => r.blob());
          datas.push(await readAsDataURL(new File([blob], "dropped", { type: blob.type })));
        } catch {
          /* one unreadable drop must not lose the others */
        }
      }
      if (datas.length > 0) setImages((prev) => [...prev, ...datas]);
    })();
  }, []);

  useEffect(() => registerChatDrop(paneId, attachPaths), [paneId, attachPaths]);

  // this chat's generated assets: everything under storage/chats/<slug>/ in the
  // active root (wire ids are bare for the corpus, "<rootid>:rel" otherwise)
  const assetPrefix =
    active && chatSlug
      ? `${active.id === CORPUS_INSTANCE_ID ? "" : `${active.id}:`}storage/chats/${chatSlug}/`
      : null;
  const assetIds = assetPrefix ? [...noteIndex.keys()].filter((id) => id.startsWith(assetPrefix)).sort() : [];

  /** Open the attached note per the Settings choice: a new tab here, or a
   * right split beside the chat. The split path carves the pane WITH the note
   * tab directly (openToSide) — splitRight() duplicates the active tab, so the
   * old splitRight+openNote pair left a copy of the chat riding in the new
   * pane next to the note (Seth, 2026-07-30: "only the note should open"). */
  const openAttachedNote = (noteId: string) => {
    if (chatNoteOpen === "split") {
      openToSide("note", noteId);
    } else {
      openNote(noteId, { newTab: true });
    }
  };

  /** The header note toggle — every chat has a note; it MATERIALIZES on first
   * open (lazy, so quick chats never litter the staging inbox with empties).
   * An existing note is resolved by its current or preserved filename alias;
   * legacy ID-tailed attachments remain compatible. A missing note (deleted)
   * self-heals by creating a fresh one. */
  const onNoteToggle = async () => {
    if (!active || !chatSlug || noteBusy) return;
    if (attachedStem) {
      const existingId = resolveAttachedNoteId(attachedStem, noteIndex.values());
      if (existingId) {
        openAttachedNote(existingId);
        return;
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
      const noteId = `${prefix}${id}`;
      rememberChatNote(chatSlug, noteId);
      openAttachedNote(noteId);
    } catch (e) {
      setNoteErr(e instanceof Error ? e.message : String(e));
    } finally {
      setNoteBusy(false);
    }
  };

  return (
    <div
      className="chat-surface"
      {...{ [CHAT_PANE_ATTR]: paneId }}
      style={{ "--chat-measure": `${CHAT_MEASURE_PX[measure]}px` } as CSSProperties}
    >
      <header className="chat-head">
        <h2 className="chat-title-h">{chatSlug ? storedTitle || chatSlug.replace(/-/g, " ") : "New chat"}</h2>
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
        <div className="list-empty chat-empty">
          <Character name="chat" size={120} />
          <p>The Chat surface talks to your memex — it runs in the app.</p>
        </div>
      ) : !active ? (
        <div className="list-empty chat-empty">
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
                // messages are PLAIN text — no per-message author label; the
                // brand mark appears once at the thread's live edge instead
                // (Seth, 2026-07-30: match the premium chat grammar). Options
                // ride each message, revealed on hover/focus.
                messages.map((m, idx) => (
                  <ChatMessage
                    key={idx}
                    text={m.text}
                    you={m.speaker === "you"}
                    index={idx}
                    copied={copiedIdx === idx}
                    onCopy={onCopyMessage}
                  />
                ))
              )}
              {busy &&
                streamingText && (
                  // the on-device answer, forming token-by-token — a live
                  // assistant row that grows until the settled message replaces it
                  <div className="cmsg ai">
                    <div className="cmsg-bubble">{renderMessage(streamingText)}</div>
                  </div>
                )}
              {busy && !streamingText && (
                <div className="cmsg ai">
                  <QuokkaMark size={17} className="chat-mark" />
                  {queued ? (
                    // waiting on measured compute headroom, not thinking — say
                    // which, and offer the jump-the-line the user actually has
                    <div className="cmsg-bubble cmsg-think cmsg-queued" role="status">
                      <span className="cmsg-queued-text">{queued.reason}</span>
                      {queued.position > 0 && (
                        <button
                          type="button"
                          className="cmsg-queued-btn"
                          title="Run this one next, ahead of the others waiting"
                          onClick={() => {
                            const id = requestRef.current;
                            if (id) void localQueuePrioritize(id).catch(() => {});
                          }}
                        >
                          Prioritize
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="cmsg-bubble cmsg-think" role="status">
                      <span className="cmsg-think-dots" aria-hidden="true">
                        <i />
                        <i />
                        <i />
                      </span>
                      {status}
                    </div>
                  )}
                </div>
              )}
              {!busy && messages.length > 0 && messages[messages.length - 1]?.speaker !== "you" && (
                <div className="chat-endmark" aria-hidden="true">
                  <QuokkaMark size={17} />
                </div>
              )}
              {saveErr && (
                <p className="file-err chat-save-err" role="alert">
                  ⚠ This conversation couldn’t be saved — it stays for this session but won’t survive a
                  reload. {saveErr}
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
                    ref={titleRef}
                    className="chat-input chat-title-input"
                    placeholder="Chat title (optional — ⏎ skips; your first message names it)…"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      // ⏎ with nothing typed = "you name it": drop into the
                      // composer; the first message titles the chat (deriveTitle)
                      if (e.key === "Enter") {
                        e.preventDefault();
                        msgRef.current?.focus();
                      }
                    }}
                  />
                )}
                {images.length > 0 && (
                  <div className="chat-attachments">
                    {images.map((src, i) => (
                      <span key={i} className="chat-attachment">
                        {/* the handle you can talk about — the same number the
                            sent message carries as [Image #N] (2026-08-04) */}
                        <span className="chat-attachment-n" aria-hidden="true">{`#${i + 1}`}</span>
                        <img src={src} alt={`Attached image ${i + 1}`} />
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
                              pickModel(m.id);
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
                    ref={msgRef}
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
                          pickModel(id);
                          setVisionHint(false);
                        }}
                      />
                    ) : null}
                    <button
                      type="button"
                      className={globeOn ? "chat-tool on" : "chat-tool"}
                      aria-pressed={globeOn}
                      disabled={secureChat}
                      title={
                        secureChat
                          ? "Web search is unavailable for a chat with secure-note content"
                          : globeOn
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
                      title={
                        canVision ? "Attach an image" : "This model can’t see images — pick a vision model"
                      }
                      onClick={onAttachClick}
                    >
                      <ClipGlyph />
                    </button>
                    <span className="chat-box-grow" />
                    {/* EVERY lane stops now (Seth, 2026-07-30): CLIs die for
                        real (Rust kills the child); the local lane orphans the
                        run — the reply is discarded and the prompt returns to
                        the composer either way */}
                    <button
                      type="button"
                      className="chat-send"
                      aria-label={busy ? "Stop" : "Send"}
                      title={busy ? "Stop — cancel this reply and get the prompt back" : undefined}
                      disabled={busy ? false : (!message.trim() && images.length === 0) || !picked}
                      onClick={() => {
                        if (busy) stopTurn();
                        else void send();
                      }}
                    >
                      {busy ? <StopGlyph /> : <SendGlyph />}
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
