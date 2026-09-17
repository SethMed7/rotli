// The Chat surface — a real conversation over the connected memex's chats/ surface
// ("everything has a chat"). rotli OWNS chats/, so a chat persists as
// chats/<slug>.md (byte-shape from src/memex/contract.ts). The reply comes from an
// on-device model via the Rust `chat_complete` bridge (the webview CSP can't reach
// localhost).
//
// Pane-able (the maintainer, 2026-06-29): a chat is a PANE SURFACE now (surfaceKind "chat"),
// so multiple chats open at once and a pane can hold a chat OR a note side by side.
// This component is driven by props { paneId, chatSlug } — chatSlug null = a fresh
// unsent chat; the first send creates the file and BINDS the tab to its slug.
//
// Still Increment 1: one-shot (no streaming), no @-context yet.

import { useQueries, useQuery } from "@tanstack/react-query";
import {
  type CSSProperties,
  type ReactNode,
  type RefObject,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { attributedConsultReply, parseConsultMention, resolveConsultModel } from "../../ai/chatProvider";
import { modelIsOnDevice } from "../../ai/guard";
import { type HostArtifactKind, makeTauriHost } from "../../ai/host";
import { presetFor, runHybrid } from "../../ai/hybrid";
import { runAgent } from "../../ai/loop";
import {
  PROVIDER_IDS,
  type ModelGroups,
  type ProviderId,
  flattenModels,
  mergedModels,
} from "../../ai/models";
import type { AgentQuestion, ChatTurn, RunInput } from "../../ai/types";
import { resolveChatNoteId, syncManagedChatMemory } from "../../chatMemory/composition";
import {
  attachedNoteId as resolveAttachedNoteId,
  buildChatNotesPrompt,
  type MemoryTurn,
} from "../../chatMemory/model";
import { DOCUMENT_EXTS, WORD_EXTS } from "../../documents/kinds";
import { renderMermaidElement } from "../../editor/mermaidRender";
import { renderInline } from "../../editor/render";
import {
  CHAT_IMAGE_ASSET_EXTS,
  CHAT_IMAGE_ASSET_MAX_BYTES,
  attachmentReference,
  projectChatWorkItems,
  visibleChatText,
} from "../../lib/chatWork";
import { PLATFORM } from "../../lib/featurePolicy";
import { extOf, fileName, IMAGE_EXTS, imageMimeOf } from "../../lib/fileKind";
import { useAnchoredPopoverBox, useTransientPopover } from "../../lib/popover";
import {
  type LocalQueueEntry,
  chatModels,
  cliCancel,
  cliDetect,
  corpusCreateImageAsset,
  corpusFileBytes,
  corpusFileStat,
  corpusFrontmatter,
  corpusImportFile,
  fileAssetUrl,
  isTauri,
  localQueueCancel,
  localQueuePrioritize,
  onLocalQueue,
} from "../../lib/tauri";
import { CORPUS_INSTANCE_ID, activeInstance } from "../../memex/config";
import {
  type ChatArtifact,
  hasSecureContext,
  parseChatArtifacts,
  parseChatArtifactTurns,
} from "../../memex/contract";
import { readChat, registerChatArtifact, registerChatArtifactTurn, writeNote } from "../../memex/service";
import {
  useInstanceChats,
  useMemexConfig,
  useSetChatAttachedTo,
  useUpdateChatTitle,
  useWriteChat,
} from "../../memex/useMemex";
import { splitMessageBlocks } from "../../noteChat/chatMessageBlocks";
import { structureMessageLines } from "../../noteChat/chatMessageBlocks";
import { formatChatTime } from "../../noteChat/chatTime";
import { rememberedChatNote, rememberChatNote } from "../../noteChat/session";
import {
  assignChatToFolder,
  invalidateChatFolders,
  loadChatFolders,
  saveChatFolders,
} from "../../services/chatFolders";
import { syncChatModelMeta } from "../../services/chatModelMeta";
import { invalidateNotes, useNoteIndex } from "../../services/hooks";
import { artifactMainFolderName, fileNoteInNamedRootFolder } from "../../services/mainTree";
import { assignChatToView } from "../../services/viewTree";
import { type ChatImageAttachment, chatDraftFor, useChatDrafts } from "../../state/chatDrafts";
import { replyPending, useChatRuns } from "../../state/chatRuns";
import { useChatSetupGuide } from "../../state/chatSetupGuide";
import { helperReadyFrom, useHelperLink } from "../../state/helperLink";
import { useMainStore } from "../../state/main";
import { touchChatActivity } from "../../state/mru";
import { type Measure } from "../../state/noteStyle";
import { findLeaf, leaves, usePanesStore } from "../../state/panes";
import { useIsDarkTheme } from "../../state/theme";
import {
  type ChatReasoningEffort,
  type ChatServiceTier,
  chatKey,
  chatModelFor,
  useUiStore,
} from "../../state/ui";
import { useViewsStore } from "../../state/views";
import { takeSentences } from "../../voice/sentences";
import { speaker } from "../../voice/speech";
import { Character, QuokkaMark } from "../character";
import {
  CheckGlyph,
  CopyGlyph,
  BoardGlyph,
  DocumentGlyph,
  ImageGlyph,
  NotesStackGlyph,
  SearchGlyph,
  SpeakerGlyph,
  SquareGlyph,
  WordGlyph,
  XGlyph,
} from "../glyphs";
import { WebDialogFrame } from "../webDialogFrame";
import { ChatAttachedImages } from "./chatAttachedImages";
import { ChatClarificationBar } from "./chatClarificationBar";
import { copyChatSelection } from "./chatCopy";
import { CHAT_PANE_ATTR } from "./chatDrop";
import { useChatDropTarget } from "./chatDropTarget";
import { UserMessageText } from "./chatImageRefs";
import { ModelPicker } from "./chatModelPicker";
import { ChatPromptNavigator } from "./chatPromptNavigator";
import { conversationPrompts, visiblePromptIndexes } from "./chatPromptNavigatorModel";
import {
  normalizedReasoning,
  normalizedServiceTier,
  reasoningChoices,
  serviceTierChoices,
} from "./chatReasoningModel";
import { ChatSetupGuide } from "./chatSetupGuide";
import { CHAT_MESSAGE_WINDOW, recentChatThread } from "./chatThreadModel";
import {
  CHAT_TITLE_MAX_LENGTH,
  CHAT_TITLE_PLACEHOLDER,
  deriveChatTitle,
  normalizeChatTitle,
} from "./chatTitleModel";
import {
  chatDaypart,
  chatWelcomeCharacter,
  chatWelcomeSuggestions,
  chatWorkPrompt,
  type ChatWelcomeSuggestionKind,
} from "./chatWelcomeModel";

interface Msg {
  speaker: string;
  text: string;
  at?: string;
  images?: string[];
  artifacts?: ChatArtifact[];
}

/** Parse a chat .md's `## Messages` block back into bubbles — rotli writes the
 * `**speaker** · date — text` shape (contract.ts), so this round-trips its own. */
function parseMessages(body: string, rootPrefix = ""): Msg[] {
  const i = body.indexOf("## Messages");
  if (i < 0) return [];
  const section = body.slice(i + "## Messages".length);
  const re = /\*\*([^*]+)\*\*\s*·\s*([^—\n]*?)\s*—\s*([\s\S]*?)(?=\n\*\*[^*]+\*\*\s*·|\s*$)/g;
  const out: Msg[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(section)) !== null) {
    out.push({
      speaker: (m[1] ?? "").trim(),
      at: (m[2] ?? "").trim(),
      text: (m[3] ?? "").trim(),
    });
  }
  const artifactTurns = new Map(parseChatArtifactTurns(body).map((turn) => [turn.assistant, turn.artifacts]));
  let assistant = 0;
  for (const message of out) {
    if (message.speaker === "you") continue;
    const artifacts = artifactTurns.get(assistant);
    if (artifacts?.length) message.artifacts = artifacts;
    assistant += 1;
  }
  for (const message of out) {
    if (message.speaker !== "you") continue;
    const attached = projectChatWorkItems({
      rootPrefix,
      messages: [message],
      discoveredIds: [],
    }).filter((item) => item.kind === "image" && item.source === "attachment");
    if (attached.length) message.images = attached.map((item) => item.id);
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

function PlusGlyph() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M8 2.5v11M2.5 8h11" />
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

/** Chat measure widths — comfort keeps the tuned 740 column (the maintainer, 2026-07-01);
 * narrow/wide step around it. Same Aa vocabulary as notes, chat-tuned values. */
const CHAT_MEASURE_PX: Record<Measure, number> = {
  narrow: 620,
  comfort: 740,
  wide: 1000,
};

const MEASURE_LABELS: { id: Measure; label: string }[] = [
  { id: "narrow", label: "Narrow" },
  { id: "comfort", label: "Comfort" },
  { id: "wide", label: "Wide" },
];

/** A sidecar belongs to the chat TAB, not to this component mount. Switching
 * tabs unmounts ChatSurface; keeping the association here prevents every
 * return to a chat from carving another pane. Stale pane ids self-heal. */
const artifactSidecarByTab = new Map<string, string>();

function WelcomeSuggestionGlyph({ kind }: { kind: ChatWelcomeSuggestionKind }) {
  if (kind === "search") return <SearchGlyph size={17} />;
  if (kind === "organize") return <NotesStackGlyph size={17} />;
  return <DocumentGlyph size={17} />;
}

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

function artifactType(artifact: ChatArtifact): "image" | "word" | "document" | "note" | "board" | "file" {
  if (artifact.kind === "note") return "note";
  if (artifact.kind === "canvas") return "board";
  const extension = extOf(artifact.id);
  if (IMAGE_EXTS.has(extension)) return "image";
  if (WORD_EXTS.has(extension)) return "word";
  if (DOCUMENT_EXTS.has(extension)) return "document";
  return "file";
}

function artifactName(artifact: ChatArtifact): string {
  return artifact.label ?? fileName(artifact.id).replace(/-\d{13}(?=\.[^.]+$)/, "");
}

/** One chat-created artifact. Images carry a real thumbnail; conventional
 * files use the same quiet format marks as tabs and the System browser. */
function ArtifactItem({ artifact, onOpen }: { artifact: ChatArtifact; onOpen: () => void }) {
  const type = artifactType(artifact);
  const url = useQuery({
    queryKey: ["asset-url", artifact.id],
    queryFn: () => fileAssetUrl(artifact.id),
    enabled: type === "image",
  });
  const name = fileName(artifact.id);
  return (
    <button type="button" className="chat-artifact" title={`Open ${name}`} onClick={onOpen}>
      <span className={`chat-artifact-preview ${type}`}>
        {type === "image" && url.data ? (
          <img src={url.data} alt="" />
        ) : type === "image" ? (
          <ImageGlyph size={18} />
        ) : type === "word" ? (
          <WordGlyph size={22} />
        ) : type === "document" ? (
          <DocumentGlyph size={18} />
        ) : type === "note" ? (
          <DocumentGlyph size={18} />
        ) : type === "board" ? (
          <BoardGlyph size={18} />
        ) : (
          <DocumentGlyph size={18} />
        )}
      </span>
      <span className="chat-artifact-copy">
        <strong>{artifactName(artifact)}</strong>
        <small>
          {type === "word"
            ? `Microsoft Word · ${extOf(name).toUpperCase()}`
            : type === "note"
              ? "Editable Markdown source"
              : type === "board"
                ? "Board"
                : extOf(name).toUpperCase() || "File"}
        </small>
      </span>
    </button>
  );
}

/** Conventional files remain visible in the transcript itself as ordinary
 * click targets. The rail is the complete artifact browser; this compact row
 * keeps the file promised by the assistant next to the conversation that made
 * it without forcing the file open. */
function ChatArtifactButtons({
  artifacts,
  onOpen,
}: {
  artifacts: ChatArtifact[];
  onOpen: (artifact: ChatArtifact) => void;
}) {
  const files = artifacts
    .filter((artifact) => {
      const type = artifactType(artifact);
      return type === "word" || type === "document" || type === "note";
    })
    .reverse();
  if (files.length === 0) return null;
  return (
    <div className="chat-inline-artifacts" aria-label="Documents created in this chat">
      {files.map((artifact) => {
        const type = artifactType(artifact);
        const name = artifactName(artifact);
        return (
          <button
            key={`${artifact.kind}:${artifact.id}`}
            type="button"
            className={`chat-inline-artifact ${type}`}
            title={`Open ${name}`}
            onClick={() => onOpen(artifact)}
          >
            <span className="chat-inline-artifact-icon">
              {type === "word" ? <WordGlyph size={22} /> : <DocumentGlyph size={19} />}
            </span>
            <span className="chat-inline-artifact-copy">
              <strong>{name}</strong>
              <small>
                {type === "word"
                  ? "Microsoft Word document"
                  : type === "note"
                    ? "Editable Markdown source"
                    : "Document"}
              </small>
            </span>
            <span className="chat-inline-artifact-open" aria-hidden="true">
              Open
            </span>
          </button>
        );
      })}
    </div>
  );
}

function ArtifactList({
  artifacts,
  onOpen,
}: {
  artifacts: ChatArtifact[];
  onOpen: (artifact: ChatArtifact) => void;
}) {
  return (
    <div className="chat-artifacts-list">
      {artifacts.map((artifact) => (
        <ArtifactItem
          key={`${artifact.kind}:${artifact.id}`}
          artifact={artifact}
          onOpen={() => onOpen(artifact)}
        />
      ))}
    </div>
  );
}

function ArtifactsDrawer({
  artifacts,
  anchorRef,
  onOpen,
  onClose,
}: {
  artifacts: ChatArtifact[];
  anchorRef: RefObject<HTMLElement | null>;
  onOpen: (artifact: ChatArtifact) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useTransientPopover([ref, anchorRef], true, onClose);
  return (
    <div className="chat-artifacts-pop" ref={ref} role="dialog" aria-label="Chat artifacts">
      <ArtifactList artifacts={artifacts} onOpen={onOpen} />
    </div>
  );
}

function ArtifactsPanel({
  artifacts,
  onOpen,
  onClose,
}: {
  artifacts: ChatArtifact[];
  onOpen: (artifact: ChatArtifact) => void;
  onClose: () => void;
}) {
  return (
    <aside className="chat-artifacts-panel" aria-label="Chat artifacts">
      <div className="chat-artifacts-head">
        <div>
          <strong>Artifacts</strong>
          <span>{artifacts.length}</span>
        </div>
        <button type="button" className="chat-panel-close" aria-label="Close artifacts" onClick={onClose}>
          <XGlyph size={14} />
        </button>
      </div>
      <ArtifactList artifacts={artifacts} onOpen={onOpen} />
    </aside>
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

function ReasoningPicker({
  provider,
  modelId,
  effort,
  serviceTier,
  onEffort,
  onServiceTier,
}: {
  provider: string;
  modelId: string;
  effort: ChatReasoningEffort | undefined;
  serviceTier: ChatServiceTier | undefined;
  onEffort: (value: ChatReasoningEffort | null) => void;
  onServiceTier: (value: ChatServiceTier | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const box = useAnchoredPopoverBox(open, anchorRef, popRef);
  const choices = reasoningChoices(provider, modelId);
  const tiers = serviceTierChoices(provider, modelId);
  const label = choices.find((choice) => choice.value === (effort ?? null))?.label ?? "Default";
  useTransientPopover([popRef, anchorRef], open, () => setOpen(false));

  return (
    <div className="chat-reasoning-pick">
      <button
        type="button"
        ref={anchorRef}
        className="chat-reasoning-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Reasoning effort"
        onClick={() => setOpen((current) => !current)}
      >
        {label}
        <span aria-hidden="true">▾</span>
      </button>
      {open &&
        createPortal(
          <div
            ref={popRef}
            className="chat-reasoning-pop"
            role="dialog"
            aria-label="Reasoning and service tier"
            style={{
              left: box?.left ?? 0,
              top: box?.top ?? 0,
              maxHeight: box?.maxHeight,
              visibility: box ? undefined : "hidden",
            }}
          >
            <p>Reasoning</p>
            {choices.map((choice) => (
              <button
                type="button"
                key={choice.value ?? "default"}
                className={(effort ?? null) === choice.value ? "sel" : undefined}
                aria-pressed={(effort ?? null) === choice.value}
                onClick={() => {
                  onEffort(choice.value);
                  setOpen(false);
                }}
              >
                <span>{choice.label}</span>
                {(effort ?? null) === choice.value && <CheckGlyph size={12} />}
              </button>
            ))}
            {tiers.length > 0 && (
              <>
                <p className="tier">Service tier</p>
                {tiers.map((tier) => (
                  <button
                    type="button"
                    key={tier}
                    className={(serviceTier ?? "standard") === tier ? "sel" : undefined}
                    aria-pressed={(serviceTier ?? "standard") === tier}
                    onClick={() => {
                      onServiceTier(tier === "standard" ? null : tier);
                      setOpen(false);
                    }}
                  >
                    <span>{tier === "standard" ? "Standard" : "Fast"}</span>
                    {(serviceTier ?? "standard") === tier && <CheckGlyph size={12} />}
                  </button>
                ))}
              </>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}

function ComposerAddMenu({
  web,
  webDisabled,
  hasImages,
  canVision,
  onAttach,
  onToggleWeb,
}: {
  web: boolean;
  webDisabled: boolean;
  hasImages: boolean;
  canVision: boolean;
  onAttach: () => void;
  onToggleWeb: () => void;
}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const box = useAnchoredPopoverBox(open, anchorRef, popRef);
  useTransientPopover([popRef, anchorRef], open, () => setOpen(false));

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() =>
      popRef.current?.querySelector<HTMLButtonElement>("button")?.focus(),
    );
    return () => cancelAnimationFrame(frame);
  }, [open]);

  return (
    <div className="chat-add">
      <button
        ref={anchorRef}
        type="button"
        className={open || web || hasImages ? "chat-tool chat-add-trigger on" : "chat-tool chat-add-trigger"}
        aria-label="Add files or web search"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Add files or web search"
        onClick={() => setOpen((value) => !value)}
      >
        <PlusGlyph />
      </button>
      {open &&
        createPortal(
          <div
            ref={popRef}
            className="chat-add-menu"
            role="menu"
            aria-label="Add to this message"
            data-placement={box?.placement ?? "up"}
            style={{
              left: box?.left ?? 0,
              top: box?.top ?? 0,
              maxHeight: box?.maxHeight,
              visibility: box ? undefined : "hidden",
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                setOpen(false);
                anchorRef.current?.focus();
                return;
              }
              if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
              event.preventDefault();
              const items = Array.from(
                popRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [],
              );
              if (items.length === 0) return;
              const current = items.indexOf(document.activeElement as HTMLButtonElement);
              const delta = event.key === "ArrowDown" ? 1 : -1;
              items[(current + delta + items.length) % items.length]?.focus();
            }}
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onAttach();
              }}
            >
              <span className="chat-add-menu-icon">
                <ClipGlyph />
              </span>
              <span>
                <strong>Add files or photos</strong>
                {!canVision && <small>Pick a vision model to attach images</small>}
              </span>
            </button>
            <button
              type="button"
              role="menuitemcheckbox"
              aria-checked={web}
              disabled={webDisabled}
              onClick={() => {
                setOpen(false);
                onToggleWeb();
              }}
            >
              <span className="chat-add-menu-icon">
                <GlobeGlyph />
              </span>
              <span>
                <strong>Web search</strong>
                {webDisabled && <small>Unavailable after secure content enters the chat</small>}
              </span>
              {web && <CheckGlyph size={14} />}
            </button>
          </div>,
          document.body,
        )}
    </div>
  );
}

/** The processing vocabulary (the maintainer, 2026-07-30: "add something fun here") —
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
 * the maintainer 2026-08-03). Async render off the shared editor engine; while it loads
 * — or when the source doesn't parse (a model mid-stream, or plain wrong) —
 * the source shows as code, so nothing ever blanks out. */
function ChatMermaid({ code }: { code: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const renderSeq = useRef(0);
  const dark = useIsDarkTheme(); // re-renders the diagram when the theme flips
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const seq = ++renderSeq.current;
    setFailed(false);
    void renderMermaidElement(code, {
      dark,
      id: `rotli-chat-mermaid-${seq}-${Date.now()}`,
    })
      .then((element) => {
        if (renderSeq.current === seq) host.replaceChildren(element);
      })
      .catch(() => {
        if (renderSeq.current === seq) setFailed(true);
      });
    return () => {
      host.replaceChildren();
    };
  }, [code, dark]);
  return failed ? (
    <pre className="cmsg-code">
      <code>{code}</code>
    </pre>
  ) : (
    <div className="cmsg-mermaid" ref={hostRef} />
  );
}

function ChatCodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="cmsg-codeblock">
      <div className="cmsg-codehead">
        <span>{lang || "text"}</span>
        <button
          type="button"
          aria-label="Copy code"
          title="Copy code"
          onClick={() => {
            void navigator.clipboard.writeText(code).then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1200);
            });
          }}
        >
          {copied ? <CheckGlyph size={13} /> : <CopyGlyph size={13} />}
        </button>
      </div>
      <pre className="cmsg-code">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function renderStructuredLines(lines: readonly string[], key: number): ReactNode {
  return structureMessageLines(lines).map((line, index) => {
    const itemKey = `${key}-${index}`;
    switch (line.kind) {
      case "heading":
        return line.level <= 2 ? (
          <h2 key={itemKey} className="cmsg-heading level-1">
            {renderInline(line.text)}
          </h2>
        ) : line.level === 3 ? (
          <h3 key={itemKey} className="cmsg-heading level-2">
            {renderInline(line.text)}
          </h3>
        ) : (
          <h4 key={itemKey} className="cmsg-heading level-3">
            {renderInline(line.text)}
          </h4>
        );
      case "paragraph":
        return (
          <p key={itemKey} className="cmsg-line">
            {renderInline(line.text)}
          </p>
        );
      case "quote":
        return (
          <blockquote key={itemKey} className="cmsg-quote">
            {renderInline(line.text)}
          </blockquote>
        );
      case "space":
        return <span key={itemKey} className="cmsg-space" aria-hidden="true" />;
      case "list": {
        const List = line.ordered ? "ol" : "ul";
        const tasks = line.items.filter((item) => item.taskState);
        const complete = tasks.filter((item) => item.taskState === "done").length;
        return (
          <div key={itemKey} className={tasks.length > 0 ? "cmsg-list-wrap tasks" : "cmsg-list-wrap"}>
            {tasks.length > 0 && (
              <div className="cmsg-task-summary" aria-label={`${complete} of ${tasks.length} tasks complete`}>
                <span>Progress</span>
                <strong>
                  {complete}/{tasks.length}
                </strong>
              </div>
            )}
            <List className="cmsg-list">
              {line.items.map((item, itemIndex) => (
                <li
                  key={`${itemKey}-${itemIndex}`}
                  className={item.taskState ? `task ${item.taskState}` : undefined}
                  style={{ "--cmsg-list-depth": item.depth } as CSSProperties}
                >
                  {item.taskState && (
                    <span
                      className="cmsg-task-mark"
                      role="checkbox"
                      aria-checked={
                        item.taskState === "done" ? "true" : item.taskState === "active" ? "mixed" : "false"
                      }
                      aria-label={`${item.taskState} task`}
                    >
                      {item.taskState === "done" ? "✓" : item.taskState === "active" ? "•" : ""}
                    </span>
                  )}
                  <span>{renderInline(item.text)}</span>
                </li>
              ))}
            </List>
          </div>
        );
      }
    }
  });
}

/** Render an assistant message as light markdown: ``` fenced code → <pre>,
 * ```mermaid → the rendered diagram, GFM tables → real tables, every other
 * line via the editor's inline renderer (bold/italic/code/links), blank lines
 * kept as gaps. Source-of-truth stays the .md; this is display only. */
function renderMessage(text: string): ReactNode {
  return splitMessageBlocks(text).map((block, key) => {
    switch (block.kind) {
      case "code":
        return <ChatCodeBlock key={key} lang={block.lang} code={block.code} />;
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
        return renderStructuredLines(block.lines, key);
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
  onSpeak,
  speech = "idle",
  endMark = false,
  at,
  images = [],
  artifacts = [],
  onOpenArtifact,
}: {
  text: string;
  you: boolean;
  index: number;
  copied: boolean;
  onCopy: (index: number, text: string) => void;
  /** Absent when reading aloud is off — the button simply doesn't exist. */
  onSpeak?: (index: number, text: string) => void;
  /** This row's speech state; only the row being read is ever non-idle. */
  speech?: "idle" | "preparing" | "speaking";
  at?: string;
  images?: string[];
  /** The one quiet Rotli signature rests below the final reply's controls so
   * hover actions never overlap or visually merge with it. */
  endMark?: boolean;
  /** Files created by the completed assistant turn stay attached to that turn. */
  artifacts?: ChatArtifact[];
  onOpenArtifact?: (artifact: ChatArtifact) => void;
}) {
  const timeFormat = useUiStore((state) => state.timeFormat);
  const timeLabel = formatChatTime(at, timeFormat);
  return (
    <div className={you ? "cmsg you" : "cmsg ai"} data-chat-message-index={index}>
      <div className="cmsg-bubble">
        {you && images.length > 0 && <ChatAttachedImages images={images} />}
        {you ? <UserMessageText text={text} /> : renderMessage(text)}
      </div>
      {!you && onOpenArtifact && <ChatArtifactButtons artifacts={artifacts} onOpen={onOpenArtifact} />}
      <div className={endMark ? "cmsg-footer has-endmark" : "cmsg-footer"}>
        <div className="cmsg-actions">
          {timeLabel && <time dateTime={at}>{timeLabel}</time>}
          <button
            type="button"
            className="cmsg-act"
            aria-label="Copy message"
            title="Copy"
            onClick={() => onCopy(index, text)}
          >
            {copied ? <CheckGlyph size={13} /> : <CopyGlyph size={13} />}
          </button>
          {!you && onSpeak && (
            <button
              type="button"
              className={speech === "idle" ? "cmsg-act" : "cmsg-act on"}
              aria-label={speech === "idle" ? "Read aloud" : "Stop reading"}
              title={
                speech === "preparing" ? "Preparing the voice…" : speech === "idle" ? "Read aloud" : "Stop"
              }
              onClick={() => onSpeak(index, text)}
            >
              {speech === "idle" ? <SpeakerGlyph size={13} /> : <SquareGlyph size={11} />}
            </button>
          )}
        </div>
      </div>
      {endMark && (
        <div className="chat-endmark-row">
          <Character name="celebrating" size={80} className="chat-endmark" personalIdle />
        </div>
      )}
    </div>
  );
});

export function ChatSurface({
  paneId,
  tabId,
  chatSlug,
  vaultId,
}: {
  paneId: string;
  tabId: string;
  chatSlug: string | null;
  vaultId?: string;
}) {
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen);
  // the seed a NEW chat starts on (the last model picked anywhere) + the
  // per-chat map that owns every chat's actual choice
  const chatModelSeed = useUiStore((s) => s.chatModelId);
  const setChatModelSeed = useUiStore((s) => s.setChatModelId);
  const chatModelMap = useUiStore((s) => s.chatModel);
  const setChatModel = useUiStore((s) => s.setChatModel);
  const clearChatModel = useUiStore((s) => s.clearChatModel);
  const chatReasoning = useUiStore((s) => s.chatReasoning);
  const setChatReasoning = useUiStore((s) => s.setChatReasoning);
  const chatServiceTier = useUiStore((s) => s.chatServiceTier);
  const setChatServiceTier = useUiStore((s) => s.setChatServiceTier);
  const chatWeb = useUiStore((s) => s.chatWeb);
  const setChatWeb = useUiStore((s) => s.setChatWeb);
  const clearChatWeb = useUiStore((s) => s.clearChatWeb);
  const chatMeasure = useUiStore((s) => s.chatMeasure);
  const setChatMeasure = useUiStore((s) => s.setChatMeasure);
  const clearChatMeasure = useUiStore((s) => s.clearChatMeasure);
  const chatNoteOpen = useUiStore((s) => s.chatNoteOpen);
  const chatWelcomeStyle = useUiStore((s) => s.chatWelcomeStyle);
  const chatNaming = useUiStore((s) => s.chatNaming);
  const chatArtifactOpen = useUiStore((s) => s.chatArtifactOpen);
  const activeView = useUiStore((s) => s.activeView);
  const userName = useUiStore((s) => s.userName);
  const isFocusedPane = usePanesStore((s) => s.focusedPaneId === paneId);
  const bindChat = usePanesStore((s) => s.bindChat);
  const openNote = usePanesStore((s) => s.openNote);
  const openToSide = usePanesStore((s) => s.openToSide);
  const noteIndex = useNoteIndex();
  const setAttached = useSetChatAttachedTo();

  /** Honor the explicit artifact-opening preference. The default sidecar keeps
   * every file from this chat in one pane to the right; split and tab remain
   * deliberate escape hatches. The pane splitter owns the narrow fallback. */
  const openArtifact = useCallback(
    (kind: HostArtifactKind, id: string) => {
      const panes = usePanesStore.getState();
      if (chatArtifactOpen === "tab") {
        panes.focusPane(paneId);
        if (kind === "canvas") panes.openCanvas(id, { newTab: true });
        else if (kind === "note") panes.openNote(id, { newTab: true });
        else panes.openFile(id, { newTab: true });
        return;
      }
      if (chatArtifactOpen === "split") {
        panes.focusPane(paneId);
        panes.openToSide(kind, id);
        return;
      }

      const existingId = artifactSidecarByTab.get(tabId);
      if (existingId && findLeaf(panes.root, existingId)) {
        panes.focusPane(existingId);
        if (kind === "canvas") panes.openCanvas(id);
        else if (kind === "note") panes.openNote(id);
        else panes.openFile(id);
        return;
      }

      const before = new Set(leaves(panes.root).map((leaf) => leaf.id));
      panes.focusPane(paneId);
      panes.openToSide(kind, id);
      const created = leaves(usePanesStore.getState().root).find((leaf) => !before.has(leaf.id));
      if (created) artifactSidecarByTab.set(tabId, created.id);
      else artifactSidecarByTab.delete(tabId);
    },
    [chatArtifactOpen, paneId, tabId],
  );
  const openArtifactItem = useCallback(
    (artifact: ChatArtifact) => openArtifact(artifact.kind, artifact.id),
    [openArtifact],
  );

  const cfg = useMemexConfig();
  // A saved tab stays attached to the vault that owns its chat. Legacy and
  // pristine tabs resolve the current active vault until their first save
  // binds that owner into viewstate.
  const active = cfg.data
    ? vaultId
      ? (cfg.data.instances.find((instance) => instance.id === vaultId) ?? null)
      : activeInstance(cfg.data)
    : null;
  const chats = useInstanceChats(active);
  const write = useWriteChat();
  const updateTitle = useUpdateChatTitle();
  // The stored title is presentation; attachment identity is the note stem.
  // A session mapping makes a just-created note chat immediately resolvable,
  // while a current or preserved filename alias restores it after relaunch.
  // The resolver retains the old id-tail path for pre-readable-name chats.
  const summary = chatSlug ? chats.data?.find((chat) => chat.slug === chatSlug) : undefined;
  const storedTitle = summary?.title ?? null;
  const displayTitle = storedTitle || chatSlug?.replace(/-/g, " ") || "New chat";
  const [editingStoredTitle, setEditingStoredTitle] = useState(false);
  const [storedTitleDraft, setStoredTitleDraft] = useState("");
  const [titleRenameErr, setTitleRenameErr] = useState<string | null>(null);
  useEffect(() => {
    setEditingStoredTitle(false);
    setStoredTitleDraft(displayTitle);
    setTitleRenameErr(null);
  }, [chatSlug, displayTitle]);

  const attachedStem = (summary?.attachedTo ?? "").replace(/^\[\[|\]\]$/g, "").trim();
  const attachedNoteId =
    rememberedChatNote(chatSlug) ??
    (attachedStem ? resolveAttachedNoteId(attachedStem, noteIndex.values()) : null);
  const secureAttachmentHint = attachedStem.startsWith("secure-note-");

  // a runtime that can answer: the Mac app's Rust side, or Rotli Helper paired
  // with this page — subscribed, so pairing mid-session flips the surface
  const helperLinked = useHelperLink((s) => helperReadyFrom(s)); // paired AND answering AND not refused
  const runtimeAvailable = isTauri() || helperLinked;
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
  const providerDefaults = useUiStore((s) => s.providerDefaults);
  const hybridPresets = useUiStore((s) => s.hybridPresets);
  const blockedModels = useUiStore((s) => s.blockedModels);
  const providerChecks = useQueries({
    queries: PROVIDER_IDS.map((id) => ({
      queryKey: ["cli-detect", id],
      queryFn: () => cliDetect(id),
      enabled: runtimeAvailable && aiProviders[id],
      staleTime: 60_000,
    })),
  });
  const providerReady = PROVIDER_IDS.reduce<Record<ProviderId, boolean>>(
    (out, id, index) => {
      const detected = providerChecks[index]?.data;
      out[id] = !!detected?.installed && !!detected.authenticated;
      return out;
    },
    { claude: false, codex: false, cursor: false, antigravity: false },
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
  // Independent per chat (the maintainer, 2026-08-01): two chat panes side by side each
  // send to their own model, and picking in one never moves the other.
  const chatKeyId = chatKey(active?.id ?? null, chatSlug, tabId);
  // The run signals are the one truth the sidebar reads too. A turn that
  // took off from an earlier mount of this chat (the user left and came
  // back mid-run) is still "running" here while this mount is not busy.
  const runState = useChatRuns((s) => s.runs[chatKeyId]);
  const persistedTick = useChatRuns((s) => s.persisted[chatKeyId] ?? 0);
  useEffect(() => {
    if (active && chatSlug) touchChatActivity(`${active.id}:${chatSlug}`);
  }, [active, chatSlug]);
  const chatModelId = chatModelFor(chatModelMap, chatKeyId, chatModelSeed);
  const savedPick = modelList.find((m) => m.id === chatModelId);
  const fallbackPick = modelList.find((m) => m.isDefault) ?? modelList[0] ?? null;
  // A persisted remote choice must not silently become the local default while
  // its account probe is still resolving on a fresh launch.
  const waitingForSavedPick = !!chatModelId && !catalogSettled && (!savedPick || savedPick.api === "preset");
  const picked = waitingForSavedPick ? null : (savedPick ?? fallbackPick);
  const fallbackFrom = catalogSettled && chatModelId && !savedPick && fallbackPick ? chatModelId : null;
  const reasoningEffort = normalizedReasoning(picked?.provider, picked?.id, chatReasoning[chatKeyId]);
  const serviceTier = normalizedServiceTier(picked?.provider, picked?.id, chatServiceTier[chatKeyId]);
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
    void syncChatModelMeta(active, chatSlug, id, modelList, hybridPresets); // into the chat's own file
  };

  const draft = useChatDrafts((state) => chatDraftFor(state.drafts, tabId));
  const setDraftTitle = useChatDrafts((state) => state.setTitle);
  const setDraftMessage = useChatDrafts((state) => state.setMessage);
  const setDraftImages = useChatDrafts((state) => state.setImages);
  const clearDraft = useChatDrafts((state) => state.clear);
  const setDraftQuestion = useChatDrafts((state) => state.setQuestion);
  const title = draft.title;
  const message = draft.message;
  const images = draft.images;
  const pendingQuestion = draft.questionKey === chatKeyId ? draft.question : null;
  const [messages, setMessages] = useState<Msg[]>([]);
  const [hiddenMessageCount, setHiddenMessageCount] = useState(0);
  // The draft store clears as soon as the first prompt sends. Keep the title
  // chosen/derived for the brief pre-bind interval so the real input retires
  // immediately into ordinary header text instead of flashing "New chat".
  const [provisionalTitle, setProvisionalTitle] = useState<string | null>(null);
  const firstUserPrompt = messages.find((item) => item.speaker === "you")?.text ?? "";
  const hasSentPrompt = firstUserPrompt !== "";
  // the title reads the prose, never an attachment's storage path
  const provisionalDisplayTitle = provisionalTitle ?? deriveChatTitle(visibleChatText(firstUserPrompt));
  const prompts = useMemo(
    () => conversationPrompts(messages.map((item) => ({ ...item, text: visibleChatText(item.text) }))),
    [messages],
  );
  const [activePromptIndexes, setActivePromptIndexes] = useState<readonly number[]>([]);
  const [busy, setBusy] = useState(false);
  /** A predecessor mount's turn is in flight: show it, and hold the composer. */
  const foreignRun = runState === "running" && !busy;
  /** Once a run settles, the composer stays held until its reply has been
   * persisted and reread (a send in that gap would read a thread without the
   * answer — review 2026-09-16). Derived from the store: a failed run never
   * persists, so the store's grace tick releases the hold on its own. */
  // (any store change, the grace tick included, re-runs this selector)
  const foreignPending = useChatRuns((s) => !busy && replyPending(s, chatKeyId, Date.now()));
  const working = busy || foreignRun || foreignPending;
  /** The persisted count this mount's own send produced, so its own landing
   * does not trigger a reread; a foreign landing does. */
  const ownPersistRef = useRef(0);
  const loadedTickRef = useRef(0);
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
  const [visionHint, setVisionHint] = useState(false);
  const [dropVisionError, setDropVisionError] = useState(false);
  // a failed chats/<slug>.md write — the thread still shows for this session,
  // but SAY it won't survive a reload (#11, audit 2026-07); cleared on the
  // next successful save.
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [attachmentErr, setAttachmentErr] = useState<string | null>(null);
  const [artifactErr, setArtifactErr] = useState<string | null>(null);
  // the attached-note toggle (header): creating/opening state + its error slot
  const [noteBusy, setNoteBusy] = useState(false);
  const [noteErr, setNoteErr] = useState<string | null>(null);
  const [measureOpen, setMeasureOpen] = useState(false);
  const [artifactsOpen, setArtifactsOpen] = useState(false);
  const [artifactRefs, setArtifactRefs] = useState<ChatArtifact[]>([]);
  const [artifactsCompact, setArtifactsCompact] = useState(false);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const msgRef = useRef<HTMLTextAreaElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  /** One-shot: a new chat follows its naming preference, and nothing later
   * steals focus back from whichever field the user receives. */
  const didFocusNewChat = useRef(false);
  // true once THIS chat's history carries secure-note content (loaded marker
  // or a secure read during a live turn) — drives the one-way taint
  const secureReadRef = useRef(false);
  const measureBtnRef = useRef<HTMLButtonElement>(null);
  const artifactsBtnRef = useRef<HTMLButtonElement>(null);
  // the live turn's cancel key (connected CLIs — Rust kills the child)
  const requestRef = useRef<string | null>(null);
  // run sequence: Stop orphans the in-flight run — its late events and reply
  // must land NOWHERE (the local lane can't abort the HTTP mid-generation;
  // orphaning is the honest cancel: the UI is free, the result is discarded)
  const runSeq = useRef(0);
  // what Stop gives back to the composer — the sent prompt returns intact
  const lastSentRef = useRef<{
    text: string;
    images: ChatImageAttachment[];
  } | null>(null);
  // this turn's place in the local-compute queue, or null when it's actually
  // generating. Local models share one Mac: a send that doesn't fit measured
  // headroom WAITS rather than piling on (docs/design/local-compute-guardrails.md).
  const [queued, setQueued] = useState<LocalQueueEntry | null>(null);

  // — read aloud (voice tier 0, 2026-08-04) — one speaker for the whole app, so
  // starting a read anywhere stops the previous one. Sentences are cut as they
  // are spoken, which is what lets a long reply start talking immediately.
  const readAloud = useUiStore((s) => s.readAloud);
  const readAloudVoice = useUiStore((s) => s.readAloudVoice);
  const [speech, setSpeech] = useState(() => speaker.snapshot());
  useEffect(() => speaker.subscribe((state, owner) => setSpeech({ state, owner })), []);
  useEffect(() => () => speaker.stop(), []); // leaving the chat stops the voice
  const speechState = speech.state;
  const speechOwner = speech.owner;

  const onSpeakMessage = useCallback(
    (idx: number, text: string) => {
      const owner = `${paneId}:${idx}`;
      // pressing the button on the row that is speaking = stop
      if (speaker.snapshot().owner === owner) {
        speaker.stop();
        return;
      }
      const { speak } = takeSentences(text, true);
      void speaker
        .read(
          owner,
          speak.map((s) => s.text),
          readAloudVoice,
        )
        .catch((e: unknown) => setSaveErr(e instanceof Error ? e.message : String(e)));
    },
    [paneId, readAloudVoice],
  );

  // stable across renders so the memoized message rows keep skipping — the ✓
  // beat is undone only if that same row is still the copied one.
  const onCopyMessage = useCallback((idx: number, text: string) => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopiedIdx(idx);
      window.setTimeout(() => setCopiedIdx((cur) => (cur === idx ? null : cur)), 1200);
    });
  }, []);

  const writable = active?.perms === "chats+inbox";
  const beginStoredTitleEdit = () => {
    if (!chatSlug || !writable) return;
    setStoredTitleDraft(displayTitle);
    setTitleRenameErr(null);
    setEditingStoredTitle(true);
  };
  const commitStoredTitle = () => {
    setEditingStoredTitle(false);
    const next = normalizeChatTitle(storedTitleDraft);
    if (!active || !chatSlug || !next || next === displayTitle) return;
    void updateTitle
      .mutateAsync({ instance: active, slug: chatSlug, title: next })
      .catch((error) => setTitleRenameErr(error instanceof Error ? error.message : String(error)));
  };

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
    // a reply landed on disk (persistedTick moved): reread unless this mount
    // wrote it — its thread already holds the settled turn
    const tickMoved = persistedTick !== loadedTickRef.current;
    loadedTickRef.current = persistedTick;
    if (tickMoved && persistedTick === ownPersistRef.current) return;
    let cancelled = false;
    setArtifactErr(null);
    if (active && chatSlug) {
      readChat(active, chatSlug)
        .then((t) => {
          if (cancelled) return;
          const rootPrefix = active.id === CORPUS_INSTANCE_ID ? "" : `${active.id}:`;
          const thread = recentChatThread(parseMessages(t, rootPrefix));
          setMessages(thread.messages);
          setHiddenMessageCount(thread.hiddenCount);
          setArtifactRefs(parseChatArtifacts(t));
          const tainted = hasSecureContext(t);
          secureReadRef.current = tainted;
          setSecureContext(tainted);
        })
        .catch(() => {
          if (cancelled) return;
          setMessages([]);
          setHiddenMessageCount(0);
          setArtifactRefs([]);
        });
    } else {
      setMessages([]);
      setHiddenMessageCount(0);
      setArtifactRefs([]);
      secureReadRef.current = false;
      setSecureContext(false);
    }
    return () => {
      cancelled = true;
    };
  }, [active, chatSlug, persistedTick]);

  useLayoutEffect(() => {
    const element = surfaceRef.current;
    if (!element) return;
    const update = () => setArtifactsCompact(element.clientWidth < 920);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // A NEW chat either opens ready to be named in the persistent header, or
  // goes straight to the composer when first-message naming is selected. In
  // ask mode, ⏎ always skips/accepts and moves to the composer. Deps rather than mount-only because
  // `writable` resolves with the memex config, so the input may not exist on
  // the first paint; the ref makes it fire exactly once, so a later config
  // refetch can never yank focus out of the message box. Only the FOCUSED
  // pane's chat claims focus — a chat opened into a split must not steal it.
  useEffect(() => {
    if (didFocusNewChat.current || chatSlug || !writable || !isFocusedPane) return;
    didFocusNewChat.current = true;
    (chatNaming === "ask" ? titleRef.current : msgRef.current)?.focus();
  }, [chatNaming, chatSlug, writable, isFocusedPane]);

  // keep the newest message in view — including the live streaming row as it grows
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight });
  }, [messages, busy, streamingText]);

  // Track the prompt nearest the reading edge. This is derived entirely from
  // the rendered transcript; it neither mutates nor mirrors durable chat data.
  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll || prompts.length < 3) {
      const last = prompts.at(-1)?.messageIndex;
      setActivePromptIndexes(last === undefined ? [] : [last]);
      return;
    }
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const viewRect = scroll.getBoundingClientRect();
        const bubbles = prompts.map((prompt) => {
          const rect = scroll
            .querySelector<HTMLElement>(`[data-chat-message-index="${prompt.messageIndex}"]`)
            ?.getBoundingClientRect();
          return {
            messageIndex: prompt.messageIndex,
            top: rect?.top ?? null,
            bottom: rect?.bottom ?? null,
          };
        });
        setActivePromptIndexes(visiblePromptIndexes(bubbles, viewRect.top, viewRect.bottom));
      });
    };
    update();
    scroll.addEventListener("scroll", update, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      scroll.removeEventListener("scroll", update);
    };
  }, [prompts]);

  const jumpToPrompt = (messageIndex: number) => {
    const node = scrollRef.current?.querySelector<HTMLElement>(`[data-chat-message-index="${messageIndex}"]`);
    node?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      block: "start",
    });
  };

  // the composer grows with its content (WKWebView has no field-sizing) —
  // the CSS max-height caps it around seven lines, then it scrolls inside
  useLayoutEffect(() => {
    const el = msgRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [message]);

  const send = async (answer?: string) => {
    const typed = (answer ?? message).trim();
    const imgs = answer === undefined ? images : [];
    const createdArtifacts: ChatArtifact[] = [];
    const assistantTurn = messages.filter((item) => item.speaker !== "you").length;
    const userAt = new Date().toISOString();
    // an image with no words is a real message ("what is this?") — the guard
    // used to require text, so attaching a picture and pressing send did nothing
    if (!active || !writable || (!typed && imgs.length === 0) || working) return;
    if (!picked) {
      setMessages((p) => [
        ...p,
        {
          speaker: "rotli",
          text: "⚠ No on-device model is set up — add one in Settings → Models.",
        },
      ]);
      return;
    }
    const consultMention = parseConsultMention(typed);
    if (consultMention.kind === "error") {
      setMessages((previous) => [...previous, { speaker: "rotli", text: `⚠ ${consultMention.message}` }]);
      return;
    }
    let turnModel = picked;
    let providerTyped = typed;
    if (consultMention.kind === "consult") {
      const resolved = resolveConsultModel(
        groups.connected,
        consultMention.provider,
        consultMention.modelId,
        providerDefaults,
      );
      if (!resolved.ok) {
        setMessages((previous) => [...previous, { speaker: "rotli", text: `⚠ ${resolved.message}` }]);
        return;
      }
      if (!consultMention.prompt && imgs.length === 0) {
        setMessages((previous) => [
          ...previous,
          { speaker: "rotli", text: "⚠ Add a question after the provider tag." },
        ]);
        return;
      }
      turnModel = resolved.model;
      providerTyped = consultMention.prompt;
    }
    if (imgs.length > 0 && !turnModel.vision) {
      setMessages((previous) => [
        ...previous,
        {
          speaker: "rotli",
          text: `⚠ ${turnModel.label} cannot receive image attachments through this Rotli integration.`,
        },
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
    if (attachedSecure && !modelIsOnDevice(turnModel)) {
      setMessages((previous) => [
        ...previous,
        {
          speaker: "rotli",
          text: "⚠ This chat carries secure-note content. Choose an on-device model to continue.",
        },
      ]);
      return;
    }
    // An attachment becomes PART OF THE MESSAGE (the maintainer, 2026-08-04: "like a
    // #image one like claude does so we can reference it and talk about it").
    // The portable storage link makes an image referable afterwards and keeps
    // the relationship durable. The bubble hides its storage target; the Rust
    // command has already copied the bytes into this vault's asset lane.
    const userText =
      imgs.length > 0
        ? `${imgs
            .map((image, i) => (image.id ? attachmentReference(i + 1, image.id) : `[Image #${i + 1}]`))
            .join(" ")}${typed ? `\n${typed}` : ""}`
        : typed;
    // Routing syntax remains in the durable user turn, while the provider sees
    // the question without Rotli's @provider[:model] control token.
    const providerUserText =
      imgs.length > 0
        ? `${imgs
            .map((image, i) => (image.id ? attachmentReference(i + 1, image.id) : `[Image #${i + 1}]`))
            .join(" ")}${providerTyped ? `\n${providerTyped}` : ""}`
        : providerTyped;
    const sentTitle = normalizeChatTitle(title) || deriveChatTitle(visibleChatText(userText));
    setProvisionalTitle(sentTitle);
    lastSentRef.current = { text: typed, images: imgs };
    clearDraft(tabId);
    // history = the prior turns; the new user message rides as runAgent's userText
    const history: ChatTurn[] = messages.map((m) => ({
      role: m.speaker === "you" ? "user" : "assistant",
      text: m.text,
    }));
    setMessages((p) => [
      ...p,
      {
        speaker: "you",
        text: userText,
        at: userAt,
        images: imgs.map((image) => image.src),
      },
    ]);
    setBusy(true);
    busyRef.current = true;
    setStatus(THINK_WORDS[0]!);
    setStreaming("");
    const myRun = ++runSeq.current;

    // — persist the user turn NOW (the maintainer, 2026-08-03: "once sent, instantly I
    // should see it in the left bar"): the chat file exists (or bumps its
    // mtime) before the model even starts, so the sidebar row appears at the
    // top, pulsing, the moment Send is pressed. A brand-new chat binds its tab
    // HERE, synchronously with the send — which also retires the old
    // completion-time bind race (the reply used to bind to whatever chat tab
    // was active in the pane by then). If the write fails (read-only vault,
    // disk trouble), the run continues in-memory and the completion path falls
    // back to the old persist-at-the-end shape — same net behavior as before.
    let sentSlug: string | null = chatSlug;
    let sentPersisted = false;
    try {
      if (chatSlug) {
        await write.mutateAsync({
          instance: active,
          existingSlug: chatSlug,
          title: storedTitle ?? chatSlug,
          messages: [{ speaker: "you", text: userText, at: userAt }],
          secureContext: attachedSecure,
        });
      } else {
        const res = await write.mutateAsync({
          instance: active,
          title: sentTitle,
          messages: [{ speaker: "you", text: userText, at: userAt }],
          secureContext: attachedSecure,
        });
        sentSlug = res.slug;
        bindChat(paneId, tabId, res.slug, active.id); // this tab IS that chat, from the send on
        // view inheritance: a chat born while a named view is active belongs to
        // that view (the maintainer, 2026-08-03: organize chats by work vs personal)
        const bornInView = useUiStore.getState().activeView;
        if (bornInView) {
          const views = useViewsStore.getState();
          if (views.hydrated && views.writable) {
            views.setManifest(assignChatToView(views.manifest, res.slug, bornInView));
          }
        }
        // folder inheritance (the maintainer, 2026-07-30): a new chat opened FROM a
        // foldered chat files itself into the same folder. Best-effort — a
        // manifest hiccup must never fail the send.
        const originSlug = useUiStore.getState().newChatOrigin;
        useUiStore.getState().setNewChatOrigin(null);
        if (originSlug) {
          try {
            const opened = await loadChatFolders(active);
            const folderId = opened.manifest.assignments[originSlug];
            if (folderId) {
              await saveChatFolders(
                active,
                assignChatToFolder(opened.manifest, res.slug, folderId),
                opened.revision,
              );
              await invalidateChatFolders();
            }
          } catch {
            /* the chat still saved — folder filing is recoverable by hand */
          }
        }
        // the saved chat's maps ride the VAULT-scoped key (2026-08-03)
        const savedKey = chatKey(active.id, res.slug, tabId);
        if (globeOn) setChatWeb(savedKey, true); // carry the globe to the saved chat
        clearChatWeb(webKey); // the pane-scoped unsaved key is spent (#7)
        const m = chatMeasure[webKey];
        if (m) setChatMeasure(savedKey, m); // carry the measure the same way
        clearChatMeasure(webKey);
        const pinnedModel = chatModelMap[webKey] ?? picked.id;
        setChatModel(savedKey, pinnedModel); // and the model this chat runs on
        void syncChatModelMeta(active, res.slug, pinnedModel, modelList, hybridPresets);
        clearChatModel(webKey);
        setChatReasoning(savedKey, chatReasoning[webKey] ?? null);
        setChatReasoning(webKey, null);
        setChatServiceTier(savedKey, chatServiceTier[webKey] ?? null);
        setChatServiceTier(webKey, null);
      }
      sentPersisted = true;
      setSaveErr(null);
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : String(e));
    }
    const runKey = sentSlug ? chatKey(active.id, sentSlug, tabId) : chatKeyId;
    useChatRuns.getState().markRunning(runKey); // the sidebar row shows Working

    const requestId = crypto.randomUUID();
    requestRef.current = requestId;
    const model = { id: turnModel.id, api: turnModel.api };
    const userName = useUiStore.getState().userName.trim();
    const runInput: RunInput = {
      history,
      userText: providerUserText,
      web: attachedSecure ? false : globeOn,
      model,
      ...(attachedNoteId ? { noteId: attachedNoteId } : {}),
      ...(imgs.length > 0 ? { images: imgs.map((image) => image.src) } : {}),
      // Cloud image-provider execution is intentionally absent. Rust refuses
      // the legacy command too, so stale state cannot restore this tool.
      // The host pins managed files to the chat's registered root; Rust routes
      // and re-validates that capability independently.
      ...(isTauri() ? { documentTool: true } : {}),
      // Sheets and PDF copies already route through a root-qualified native
      // capability; keep that established desktop lane available in every vault.
      ...(isTauri() ? { artifactTool: true } : {}),
      // the board tool is local conversion — offered whenever the desktop
      // bridge exists (the host re-checks the secure taint at call time)
      ...(isTauri() ? { boardTool: true } : {}),
      ...(userName ? { userName } : {}),
    };

    // a preset pick routes through the hybrid layer; everything else is the
    // normal loop. Both yield the same event stream.
    const preset = presetFor(turnModel.id, hybridPresets);
    // a secure-note read mid-run taints the chat immediately (UI + this
    // turn's persistence) and one-way — the marker lands on the chat file below
    const onSecureNoteRead = () => {
      secureReadRef.current = true;
      setSecureContext(true);
    };
    // live view of the taint, so a create_note AFTER a secure read in the
    // same run already sees the secure context (PR #4 P1)
    const isSecureContext = () => secureReadRef.current || attachedSecure;
    const webSearchProvider = useUiStore.getState().webSearchProvider;
    const baseOpts = {
      requestId,
      ...(turnModel.id === picked.id && reasoningEffort ? { reasoningEffort } : {}),
      ...(turnModel.id === picked.id && serviceTier ? { serviceTier } : {}),
      onSecureNoteRead,
      isSecureContext,
      webSearchProvider,
      artifactRootId: active.id === CORPUS_INSTANCE_ID ? "default" : active.id,
      onArtifactCreated: async (artifact: ChatArtifact) => {
        if (!createdArtifacts.some((item) => item.kind === artifact.kind && item.id === artifact.id)) {
          createdArtifacts.push(artifact);
        }
        setArtifactRefs((current) =>
          current.some((item) => item.kind === artifact.kind && item.id === artifact.id)
            ? current
            : [...current, artifact],
        );
        if (!artifactsCompact) setArtifactsOpen(true);
        if (!sentSlug) return;
        try {
          await registerChatArtifact(active, sentSlug, artifact);
          setArtifactErr(null);
        } catch (error) {
          setArtifactErr(
            `The artifact was created and is available for this session, but its chat reference could not be saved. ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      },
    };
    const hostOpts = baseOpts;
    const events = preset
      ? runHybrid(preset, modelList, runInput, (m, o) => makeTauriHost(m, { ...hostOpts, ...o }), requestId)
      : runAgent(makeTauriHost(turnModel, hostOpts), runInput);

    let reply = "";
    let questionAfterRun: AgentQuestion | null = null;
    try {
      for await (const ev of events) {
        if (runSeq.current !== myRun) return; // stopped — discard everything late
        if (ev.type === "status") {
          // the loop's generic thinking beats join the rotating vocabulary;
          // real tool statuses ("searching notes…") pass through untouched
          setStatus(ev.text.startsWith("thinking…") ? nextThinkWord() : ev.text);
        } else if (ev.type === "delta") {
          // the on-device answer, arriving as it's written — append to the live
          // row (a tool step or the thought scaffolding emits no deltas)
          setStreaming(streamRef.current + ev.text);
        } else if (ev.type === "question") {
          questionAfterRun = { prompt: ev.prompt, options: ev.options };
          reply = ev.prompt;
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
    setDraftQuestion(tabId, questionAfterRun, questionAfterRun ? runKey : null);

    if (!reply) reply = "(the model returned nothing)";
    if (consultMention.kind === "consult" && !reply.startsWith("⚠")) {
      reply = attributedConsultReply(turnModel, reply);
    }
    const failed = reply.startsWith("⚠");
    const assistantAt = new Date().toISOString();
    const settledThread = recentChatThread([
      ...messages,
      { speaker: "you", text: userText, at: userAt, images: imgs.map((image) => image.src) },
      {
        speaker: "rotli",
        text: reply,
        at: assistantAt,
        ...(createdArtifacts.length ? { artifacts: [...createdArtifacts] } : {}),
      },
    ]);
    setMessages(settledThread.messages);
    if (settledThread.hiddenCount > 0) {
      setHiddenMessageCount((count) => count + settledThread.hiddenCount);
    }
    // the answer is IN — settle the sidebar signal now (not after the slower
    // persistence + note-memory pass): watched clears, unwatched flips unread.
    // A failed turn always clears — its ⚠ only lives in this mounted session,
    // so an unread badge would point at nothing.
    useChatRuns.getState().settleRun(runKey, failed || aliveRef.current);
    if (failed) return; // a failed REPLY isn't persisted (the sent user turn already is)

    // persist the assistant turn to chats/<slug>.md (the user turn landed at
    // send time; when THAT write failed, this fallback writes both)
    const turn: Msg[] = [
      { speaker: "you", text: userText, at: userAt },
      { speaker: "rotli", text: reply, at: assistantAt },
    ];
    const diskTurn: Msg[] = sentPersisted ? [{ speaker: "rotli", text: reply, at: assistantAt }] : turn;
    const memoryTurns = [...messages, ...turn];
    // the notes-keeping model: the same pick as the chat rewrites the attached
    // note's "Conversation notes" each turn (a preset routes per-leg, so it
    // falls back to the deterministic topics digest instead)
    const composeNotes =
      turnModel.api === "preset"
        ? undefined
        : (context: { turns: readonly MemoryTurn[]; currentNotes: string | null }) =>
            makeTauriHost(turnModel, {}).complete({
              messages: [
                {
                  role: "user",
                  content: buildChatNotesPrompt(context.currentNotes, context.turns),
                },
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
          secureContext: secureReadRef.current || attachedSecure,
        });
        // the reply is on disk: a surface that remounted mid-run rereads now
        ownPersistRef.current = useChatRuns.getState().markPersisted(runKey);
        if (createdArtifacts.length) {
          try {
            await registerChatArtifactTurn(active, sentSlug, assistantTurn, createdArtifacts);
            const main = useMainStore.getState();
            let tree = main.manifest.tree;
            for (const artifact of createdArtifacts) {
              tree = fileNoteInNamedRootFolder(tree, artifact.id, artifactMainFolderName(memoryTitle));
            }
            main.setTree(tree);
            setArtifactErr(null);
          } catch (error) {
            setArtifactErr(
              `The response saved, but its artifact placement could not be saved. ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
          }
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
            model: turnModel,
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
          secureContext: secureReadRef.current || attachedSecure,
        });
        if (createdArtifacts.length) {
          try {
            await registerChatArtifactTurn(active, res.slug, assistantTurn, createdArtifacts);
            const main = useMainStore.getState();
            let tree = main.manifest.tree;
            for (const artifact of createdArtifacts) {
              tree = fileNoteInNamedRootFolder(tree, artifact.id, artifactMainFolderName(sentTitle));
            }
            main.setTree(tree);
            setArtifactErr(null);
          } catch (error) {
            setArtifactErr(
              `The response saved, but its artifact placement could not be saved. ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
          }
        }
        if (!secureReadRef.current) {
          await syncManagedChatMemory({
            instance: active,
            title: sentTitle,
            chatSlug: res.slug,
            ...(composeNotes ? { composeNotes } : {}),
            model: turnModel,
            turns: memoryTurns,
          }).catch((error) => setNoteErr(error instanceof Error ? error.message : String(error)));
        }
        bindChat(paneId, tabId, res.slug, active.id); // this tab now IS that chat
        // the run signal + an unread flag follow the unsaved key to the slug
        useChatRuns.getState().retargetRun(runKey, chatKey(active.id, res.slug, tabId));
        ownPersistRef.current = useChatRuns.getState().markPersisted(chatKey(active.id, res.slug, tabId));
        // the saved chat's maps ride the VAULT-scoped key (2026-08-03)
        const savedKey = chatKey(active.id, res.slug, tabId);
        if (questionAfterRun) setDraftQuestion(tabId, questionAfterRun, savedKey);
        if (globeOn) setChatWeb(savedKey, true); // carry the globe to the saved chat
        clearChatWeb(webKey); // the pane-scoped unsaved key is spent (#7)
        const m = chatMeasure[webKey];
        if (m) setChatMeasure(savedKey, m); // carry the measure the same way
        clearChatMeasure(webKey);
        const pinnedModel = chatModelMap[webKey] ?? picked.id;
        setChatModel(savedKey, pinnedModel); // and the model this chat runs on
        void syncChatModelMeta(active, res.slug, pinnedModel, modelList, hybridPresets);
        clearChatModel(webKey);
        setChatReasoning(savedKey, chatReasoning[webKey] ?? null);
        setChatReasoning(webKey, null);
        setChatServiceTier(savedKey, chatServiceTier[webKey] ?? null);
        setChatServiceTier(webKey, null);
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

  // Leaving the chat NO LONGER cancels a queued send (flip, the maintainer 2026-08-03:
  // fire off several chats and switch between them — the sidebar's run/unread
  // signals carry the result back). A queued or running turn survives unmount,
  // lands on disk through the same closure, and flips its row to unread.
  // Deliberate abandonment stays one click away: open the chat and Stop.

  /** Stop (the maintainer, 2026-07-30): orphan the run, kill any CLI child, abort a local
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
      setMessages((p) => [...p, { speaker: "rotli", text: partial, at: new Date().toISOString() }]);
      return;
    }
    setMessages((p) => (p.length > 0 && p[p.length - 1]?.speaker === "you" ? p.slice(0, -1) : p));
    const sent = lastSentRef.current;
    if (sent) {
      setDraftMessage(tabId, sent.text);
      setDraftImages(tabId, sent.images);
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
    // Finder/WebKit can omit MIME metadata for otherwise valid local images.
    // The extension allowlist is the portable UI check; Rust independently
    // validates both the name and decoded payload before writing the asset.
    const picks = [...files].filter((file) => CHAT_IMAGE_ASSET_EXTS.includes(extOf(file.name)));
    if (picks.length !== files.length) {
      setAttachmentErr("Only supported image files can be attached.");
    }
    if (picks.length === 0 || !active) return;
    const rootId = active.id === CORPUS_INSTANCE_ID ? "default" : active.id;
    const attached: ChatImageAttachment[] = [];
    for (const file of picks) {
      try {
        const src = await readAsDataURL(file);
        const payload = src.split(",", 2)[1];
        if (!payload) throw new Error("the selected image could not be encoded");
        const id = isTauri() ? await corpusCreateImageAsset(rootId, file.name, payload) : "";
        attached.push({ id, name: file.name, src });
      } catch (error) {
        setAttachmentErr(
          `“${file.name}” could not be attached. ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    if (attached.length > 0) {
      setDraftImages(tabId, [...(useChatDrafts.getState().drafts[tabId]?.images ?? []), ...attached]);
      if (attached.length === picks.length && picks.length === files.length) setAttachmentErr(null);
    }
  };

  // — dropped images (the maintainer, 2026-08-04) — the window handler hands us OS PATHS.
  // Import each into the vault's asset store first (the same lane a drop
  // anywhere else uses), then read it back over the IPC byte lane: the
  // composer speaks data URLs, and the image becomes a durable vault asset
  // instead of a byte blob that exists only until you hit send. NOT a webview
  // network read of asset://… — connect-src is ipc-only, so that fails with
  // "Load failed" after the file has already been copied in (2026-09-01).
  const attachPaths = useCallback(
    (paths: readonly string[]) => {
      void (async () => {
        if (!active) return;
        const rootId = active.id === CORPUS_INSTANCE_ID ? "default" : active.id;
        const attached: ChatImageAttachment[] = [];
        for (const path of paths) {
          if (!CHAT_IMAGE_ASSET_EXTS.includes(extOf(path))) {
            setAttachmentErr(`“${fileName(path)}” is not a supported image file.`);
            continue;
          }
          try {
            const id = await corpusImportFile(rootId, path);
            if (!id) continue;
            const stat = await corpusFileStat(id);
            if (stat && stat.len > CHAT_IMAGE_ASSET_MAX_BYTES) {
              throw new Error("image is larger than 25 MB");
            }
            const base64 = await corpusFileBytes(id, CHAT_IMAGE_ASSET_MAX_BYTES);
            if (!base64) throw new Error("the imported image could not be read back");
            const name = fileName(path);
            attached.push({ id, name, src: `data:${imageMimeOf(extOf(name))};base64,${base64}` });
          } catch (error) {
            setAttachmentErr(
              `One dropped image could not be attached. ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
        if (attached.length > 0) {
          setDraftImages(tabId, [...(useChatDrafts.getState().drafts[tabId]?.images ?? []), ...attached]);
          if (attached.length === paths.length) setAttachmentErr(null);
        }
      })();
    },
    [active, tabId, setDraftImages],
  );

  useChatDropTarget(paneId, chatSlug, attachPaths, canVision, () => setDropVisionError(true), !!active);

  // this chat's generated assets: everything under storage/chats/<slug>/ in the
  // active root (wire ids are bare for the corpus, "<rootid>:rel" otherwise)
  const assetPrefix =
    active && chatSlug
      ? `${active.id === CORPUS_INSTANCE_ID ? "" : `${active.id}:`}storage/chats/${chatSlug}/`
      : null;
  const artifacts = useMemo(() => {
    const next = [...artifactRefs];
    const assetIds = assetPrefix
      ? [...noteIndex.keys()].filter((id) => id.startsWith(assetPrefix)).sort()
      : [];
    const rootPrefix = active && active.id !== CORPUS_INSTANCE_ID ? `${active.id}:` : "";
    const workItems = projectChatWorkItems({
      rootPrefix,
      messages,
      attachmentIds: images.map((image) => image.id).filter(Boolean),
      discoveredIds: assetIds,
    });
    for (const item of workItems) {
      if (!next.some((artifact) => artifact.kind === item.surfaceKind && artifact.id === item.id)) {
        next.push({ kind: item.surfaceKind, id: item.id, label: item.name });
      }
    }
    return next;
  }, [active, artifactRefs, assetPrefix, images, messages, noteIndex]);
  const artifactRevealKey = `${chatKeyId}:${artifacts.length}`;
  const lastArtifactReveal = useRef("");
  useEffect(() => {
    if (!artifacts.length || artifactsCompact || lastArtifactReveal.current === artifactRevealKey) return;
    lastArtifactReveal.current = artifactRevealKey;
    setArtifactsOpen(true);
  }, [artifactRevealKey, artifacts.length, artifactsCompact]);
  const showArtifactsPanel = artifactsOpen && !artifactsCompact;
  const pristineChat = runtimeAvailable && !chatSlug && messages.length === 0 && !busy;
  const welcomeHour = new Date().getHours();
  const welcomeDaypart = chatDaypart(welcomeHour);
  const welcomeSuggestions = chatWelcomeSuggestions(welcomeHour);
  /** Open the attached note per the Settings choice: a new tab here, or a
   * right split beside the chat. The split path carves the pane WITH the note
   * tab directly (openToSide) — splitRight() duplicates the active tab, so the
   * old splitRight+openNote pair left a copy of the chat riding in the new
   * pane next to the note (the maintainer, 2026-07-30: "only the note should open"). */
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
      // same-title notes are told apart by their back-link to this chat, so
      // an ambiguous stem opens the chat's note instead of minting another
      const existingId = await resolveChatNoteId(attachedStem, chatSlug, noteIndex.values());
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
        shelf: [], // a chat's note is not a capture
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
      ref={surfaceRef}
      className={[
        "chat-surface",
        showArtifactsPanel ? "artifacts-visible" : "",
        pristineChat ? "is-new" : "",
        pristineChat ? `welcome-${chatWelcomeStyle}` : "",
        pristineChat ? `welcome-${welcomeDaypart}` : "",
      ]
        .filter(Boolean)
        .join(" ")}
      {...{ [CHAT_PANE_ATTR]: paneId }}
      style={{ "--chat-measure": `${CHAT_MEASURE_PX[measure]}px` } as CSSProperties}
    >
      <header className="chat-head">
        <div className="chat-breadcrumb" aria-label="Chat location and title">
          <span className="chat-context">{activeView || active?.label || "Chat"}</span>
          <span className="chat-breadcrumb-separator" aria-hidden="true">
            /
          </span>
          {!chatSlug && !hasSentPrompt && chatNaming === "ask" && writable ? (
            <label className="chat-title-field">
              <input
                ref={titleRef}
                className="chat-title-edit is-new"
                aria-label="Chat name, optional"
                placeholder={CHAT_TITLE_PLACEHOLDER}
                maxLength={CHAT_TITLE_MAX_LENGTH}
                value={title}
                onChange={(event) => setDraftTitle(tabId, event.currentTarget.value)}
                onKeyDown={(event) => {
                  event.stopPropagation();
                  if (event.key === "Enter") {
                    event.preventDefault();
                    msgRef.current?.focus();
                  }
                }}
              />
            </label>
          ) : chatSlug && editingStoredTitle ? (
            <input
              className="chat-title-edit"
              aria-label="Rename chat"
              autoFocus
              maxLength={CHAT_TITLE_MAX_LENGTH}
              value={storedTitleDraft}
              onChange={(event) => setStoredTitleDraft(event.currentTarget.value)}
              onBlur={commitStoredTitle}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === "Enter") {
                  event.preventDefault();
                  event.currentTarget.blur();
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  setStoredTitleDraft(displayTitle);
                  setEditingStoredTitle(false);
                }
              }}
            />
          ) : chatSlug ? (
            <button
              type="button"
              className="chat-title-h"
              title={writable ? "Rename chat" : displayTitle}
              disabled={!writable}
              onClick={beginStoredTitleEdit}
            >
              {displayTitle}
            </button>
          ) : !chatSlug && hasSentPrompt ? (
            <span className="chat-title-h">{provisionalDisplayTitle}</span>
          ) : (
            <span className="chat-title-h is-placeholder">New chat</span>
          )}
          {titleRenameErr && (
            <span className="chat-title-error" role="alert" title={titleRenameErr}>
              Couldn’t rename
            </span>
          )}
        </div>
        {active && (
          <div className="chat-head-tools">
            {artifacts.length > 0 && (artifactsCompact || !artifactsOpen) && (
              <>
                <button
                  ref={artifactsBtnRef}
                  type="button"
                  className={[
                    "chat-head-action",
                    "artifacts",
                    artifactsCompact ? "icon-only" : "",
                    artifactsOpen ? "on" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  aria-expanded={artifactsOpen}
                  aria-label={`Chat artifacts, ${artifacts.length}`}
                  title={`Artifacts created in this chat (${artifacts.length})`}
                  onClick={() => setArtifactsOpen((value) => !value)}
                >
                  <AssetsGlyph />
                  {!artifactsCompact && (
                    <>
                      <span>Artifacts</span>
                      <span className="chat-head-count">{artifacts.length}</span>
                    </>
                  )}
                </button>
                {artifactsOpen && artifactsCompact && (
                  <ArtifactsDrawer
                    artifacts={artifacts}
                    anchorRef={artifactsBtnRef}
                    onOpen={(artifact) => {
                      setArtifactsOpen(false);
                      openArtifact(artifact.kind, artifact.id);
                    }}
                    onClose={() => setArtifactsOpen(false)}
                  />
                )}
              </>
            )}
            <button
              ref={measureBtnRef}
              type="button"
              className={measureOpen ? "chat-head-action icon-only on" : "chat-head-action icon-only"}
              aria-label="Chat width"
              aria-expanded={measureOpen}
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
              className={attachedStem ? "chat-head-action icon-only available" : "chat-head-action icon-only"}
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

      {!runtimeAvailable ? (
        <div className="list-empty chat-empty">
          <Character name="listening" size={120} accessorized />
          {PLATFORM === "web" ? (
            <>
              <p>Chat runs the AI tools on your own computer. On the web that takes Rotli Helper.</p>
              <button type="button" className="chat-cta" onClick={() => useChatSetupGuide.getState().show()}>
                Set up chat on the web
              </button>
            </>
          ) : (
            <p>Chat uses your vault as context — it runs in the app.</p>
          )}
        </div>
      ) : !active ? (
        <div className="list-empty chat-empty">
          <Character name="attention" size={120} />
          <p>No vault connected yet.</p>
          <button type="button" className="chat-cta" onClick={() => setSettingsOpen(true)}>
            Connect one in Settings → Location
          </button>
        </div>
      ) : (
        <main className="chat-main">
          <div className={pristineChat ? "chat-conversation is-new" : "chat-conversation"}>
            <ChatPromptNavigator
              prompts={prompts}
              activeMessageIndexes={activePromptIndexes}
              onJump={jumpToPrompt}
            />
            <div className="chat-scroll" ref={scrollRef}>
              <div className="chat-thread" onCopy={(event) => copyChatSelection(event, messages)}>
                {hiddenMessageCount > 0 && (
                  <p className="chat-thread-window" role="status">
                    Showing the latest {CHAT_MESSAGE_WINDOW} messages. {hiddenMessageCount.toLocaleString()}{" "}
                    earlier messages remain in this chat&rsquo;s Markdown file.
                  </p>
                )}
                {messages.length === 0 ? (
                  <div className={`chat-newhint ${pristineChat ? chatWelcomeStyle : "calm"}`}>
                    <div className="chat-welcome-heading">
                      <div className="chat-welcome-scene">
                        <Character
                          name={pristineChat ? chatWelcomeCharacter(welcomeHour, chatWelcomeStyle) : "chat"}
                          size={pristineChat ? 58 : 50}
                          className="chat-welcome-character"
                          accessorized={pristineChat}
                          // Calm = the user's preferred idle pose; Lively = the
                          // time-of-day pose from chatWelcomeCharacter (personalIdle
                          // used to discard it, DESIGN.md "Calm/Lively", 2026-09-01)
                          personalIdle={pristineChat && chatWelcomeStyle === "calm"}
                        />
                      </div>
                      <p className="chat-hint-title">
                        {pristineChat ? chatWorkPrompt(userName) : "No messages yet."}
                      </p>
                    </div>
                    {!pristineChat && (
                      <p className="chat-sub">This saved chat is ready for its first message.</p>
                    )}
                    {catalogSettled && !picked && (
                      <ChatSetupGuide secureOnly={secureChat} onOpenSettings={() => setSettingsOpen(true)} />
                    )}
                  </div>
                ) : (
                  // messages are PLAIN text — no per-message author label; the
                  // brand mark appears once at the thread's live edge instead
                  // (the maintainer, 2026-07-30: match the premium chat grammar). Options
                  // ride each message, revealed on hover/focus.
                  messages.map((m, idx) => (
                    <ChatMessage
                      key={idx}
                      text={m.speaker === "you" ? visibleChatText(m.text) : m.text}
                      you={m.speaker === "you"}
                      index={idx}
                      copied={copiedIdx === idx}
                      onCopy={onCopyMessage}
                      {...(readAloud ? { onSpeak: onSpeakMessage } : {})}
                      speech={speechOwner === `${paneId}:${idx}` ? speechState : "idle"}
                      {...(m.at ? { at: m.at } : {})}
                      {...(m.images ? { images: m.images } : {})}
                      endMark={!busy && idx === messages.length - 1 && m.speaker !== "you"}
                      {...(!busy && m.artifacts?.length
                        ? {
                            artifacts: m.artifacts,
                            onOpenArtifact: openArtifactItem,
                          }
                        : {})}
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
                {working && !streamingText && (
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
                {saveErr && (
                  <p className="file-err chat-save-err" role="alert">
                    ⚠ This conversation couldn’t be saved — it stays for this session but won’t survive a
                    reload. {saveErr}
                  </p>
                )}
                {artifactErr && (
                  <p className="file-err chat-save-err" role="alert">
                    ⚠ {artifactErr}
                  </p>
                )}
                {attachmentErr && (
                  <p className="file-err chat-save-err" role="alert">
                    ⚠ {attachmentErr}
                  </p>
                )}
                {noteErr && (
                  <p className="file-err chat-save-err" role="alert">
                    ⚠ Couldn’t create this chat’s note. {noteErr}
                  </p>
                )}
              </div>
            </div>

            {!busy && pendingQuestion && (
              <ChatClarificationBar question={pendingQuestion} onAnswer={(answer) => void send(answer)} />
            )}

            {writable ? (
              <>
                <div className="chat-composer">
                  <div className="chat-composer-inner">
                    {images.length > 0 && (
                      <div className="chat-attachments">
                        {images.map((image, i) => (
                          <span key={image.id || `${image.name}:${i}`} className="chat-attachment">
                            {/* the handle you can talk about — the same number the
                            sent message carries as [Image #N] (2026-08-04) */}
                            <span className="chat-attachment-n" aria-hidden="true">{`#${i + 1}`}</span>
                            <img src={image.src} alt={`Attached image ${i + 1}`} />
                            <button
                              type="button"
                              className="chat-attachment-x"
                              title="Remove"
                              onClick={() =>
                                setDraftImages(
                                  tabId,
                                  images.filter((_, j) => j !== i),
                                )
                              }
                            >
                              ×
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                    {dropVisionError &&
                      createPortal(
                        <WebDialogFrame
                          id="chat-image-drop-error"
                          title="This model can’t see images"
                          onClose={() => setDropVisionError(false)}
                          actions={
                            <button
                              type="button"
                              className="rename-btn primary"
                              onClick={() => setDropVisionError(false)}
                            >
                              OK
                            </button>
                          }
                        >
                          <p>
                            Choose a model that supports images, then drop the image again. Nothing was
                            attached or saved.
                          </p>
                        </WebDialogFrame>,
                        document.body,
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
                          <span>No vision-capable model is set up in Settings → Models yet.</span>
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
                        placeholder={working ? "thinking…" : "Message rotli…  (⏎ to send · ⇧⏎ new line)"}
                        value={message}
                        onChange={(e) => setDraftMessage(tabId, e.target.value)}
                        onKeyDown={(e) => {
                          e.stopPropagation();
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            void send();
                          }
                        }}
                      />
                      <div className="chat-box-foot">
                        <ComposerAddMenu
                          web={globeOn}
                          webDisabled={secureChat}
                          hasImages={images.length > 0}
                          canVision={canVision}
                          onAttach={onAttachClick}
                          onToggleWeb={() => setChatWeb(webKey, !globeOn)}
                        />
                        <span className="chat-box-grow" />
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
                        {picked &&
                          (reasoningChoices(picked.provider, picked.id).length > 0 ||
                            serviceTierChoices(picked.provider, picked.id).length > 0) && (
                            <ReasoningPicker
                              provider={picked.provider}
                              modelId={picked.id}
                              effort={reasoningEffort}
                              serviceTier={serviceTier}
                              onEffort={(value) => setChatReasoning(chatKeyId, value)}
                              onServiceTier={(value) => setChatServiceTier(chatKeyId, value)}
                            />
                          )}
                        {/* EVERY lane stops now (the maintainer, 2026-07-30): CLIs die for
                        real (Rust kills the child); the local lane orphans the
                        run — the reply is discarded and the prompt returns to
                        the composer either way */}
                        <button
                          type="button"
                          className="chat-send"
                          aria-label={busy ? "Stop" : "Send"}
                          title={busy ? "Stop — cancel this reply and get the prompt back" : undefined}
                          disabled={
                            busy ? false : foreignRun || (!message.trim() && images.length === 0) || !picked
                          }
                          onClick={() => {
                            if (busy) stopTurn();
                            else void send();
                          }}
                        >
                          {busy ? <StopGlyph /> : <SendGlyph />}
                        </button>
                      </div>
                    </div>
                    <p className="chat-model-disclaimer">
                      Models can make mistakes. Check important information.
                    </p>
                  </div>
                </div>
                {pristineChat && (
                  <div className={`chat-welcome-actions ${chatWelcomeStyle}`} aria-label="Start a chat">
                    {welcomeSuggestions.map((suggestion) => (
                      <button
                        type="button"
                        key={suggestion.kind}
                        onClick={() => {
                          setDraftMessage(tabId, suggestion.prompt);
                          requestAnimationFrame(() => msgRef.current?.focus());
                        }}
                      >
                        <WelcomeSuggestionGlyph kind={suggestion.kind} />
                        <span>{suggestion.label}</span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div className="chat-readonly">
                This vault is connected read-only — enable “Chats + inbox” in Settings → Location to write.
              </div>
            )}
          </div>
          {showArtifactsPanel && (
            <ArtifactsPanel
              artifacts={artifacts}
              onOpen={openArtifactItem}
              onClose={() => {
                setArtifactsOpen(false);
                requestAnimationFrame(() => artifactsBtnRef.current?.focus());
              }}
            />
          )}
        </main>
      )}
    </div>
  );
}
