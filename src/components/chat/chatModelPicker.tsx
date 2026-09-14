// The chat composer's model picker: a compact, portaled popover grouped by
// provider (On this Mac · each connected lane · Routing presets), with a
// local-vs-"leaves your Mac" cue and a vision badge. Split out of chatSurface
// so the surface stays under its size ceiling; the surface only passes the
// grouped models, the pick, and the pick callback.

import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { PROVIDER_IDS, PROVIDER_LABELS, type ModelGroups, type ProviderId } from "../../ai/models";
import { useAnchoredPopoverBox, useTransientPopover } from "../../lib/popover";
import { CloudGlyph, EyeGlyph, LaptopGlyph, SearchGlyph } from "../glyphs";
import { chatMark } from "../sidebar/chatMark";
import { ModelLogo } from "../sidebar/modelLogo";

/** The list's own height cap: beside the composer chip it must fit the window,
 * and a short list reads as a menu rather than a panel. */
const PICKER_MAX_HEIGHT = 360;

type ChatModelInfo = ModelGroups["local"][number];

/** Strip the transport suffix + quant noise so a raw id reads as a name —
 * "gemma-3-12b-it-qat-4bit · MLX" → "gemma-3-12b" (mirrors Settings' pretty()). */
export function shortModelLabel(label: string): string {
  return label.replace(/ · (MLX|llama\.cpp)$/, "").replace(/-(it-qat|instruct)-4bit$/i, "");
}

type ModelKind = "local" | "connected" | "preset";

const PICKER_PROVIDER_META: Record<ProviderId, { label: string; hint: string }> = {
  claude: { label: PROVIDER_LABELS.claude, hint: "Uses the Claude account signed in to Claude Code." },
  codex: { label: PROVIDER_LABELS.codex, hint: "Uses the ChatGPT account signed in to Codex." },
  cursor: {
    label: PROVIDER_LABELS.cursor,
    hint: "Uses Cursor's official ACP client in read-only Ask mode for software work.",
  },
  antigravity: {
    label: PROVIDER_LABELS.antigravity,
    hint: "Uses the Google account signed in to Google's Antigravity agent.",
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
 * that replaced the bare native <select>.
 *
 * The list is PORTALED to <body> and placed in viewport coordinates
 * (anchoredPopover). It used to be a pane-relative absolute box with a 62vh
 * cap: in a split the composer sits mid-window, so the list opened upward
 * straight past the window's top edge and came back clipped — a menu starting
 * mid-air over the transcript. It now prefers the chip's right side (clamped
 * to the window), and falls back to the vertical law when the window is too
 * narrow for a side list. */
export function ModelPicker({
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
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const box = useAnchoredPopoverBox(open, anchorRef, popRef, {
    prefer: "right",
    maxHeight: PICKER_MAX_HEIGHT,
    flipSide: false,
  });
  const searchRef = useRef<HTMLInputElement>(null);
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
    {
      key: "local",
      kind: "local" as const,
      label: "On this Mac",
      items: groups.local,
    },
    ...connectedSections,
    {
      key: "preset",
      kind: "preset" as const,
      label: "Routing presets",
      items: groups.presets,
      hint: "May route this turn to a connected account.",
    },
  ].filter((s) => s.items.length > 0);
  const selectedSection = sections.find((section) => section.items.some((item) => item.id === picked?.id));
  const currentSection =
    sections.find((section) => section.key === activeSection) ?? selectedSection ?? sections[0];
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const flatItems = (
    normalizedQuery ? sections.flatMap((section) => section.items) : (currentSection?.items ?? [])
  ).filter((model) =>
    normalizedQuery
      ? `${model.label} ${model.id} ${model.provider}`.toLocaleLowerCase().includes(normalizedQuery)
      : true,
  );
  const sectionFor = (model: ChatModelInfo) =>
    sections.find((section) => section.items.some((item) => item.id === model.id));
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
    if (!open) return;
    const selected = current ? items.findIndex((m) => m.id === current.id) : -1;
    const next = selected >= 0 ? selected : 0;
    setActiveIndex(next);
    const frame = requestAnimationFrame(() => searchRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [flatKey, open, picked?.id]);

  useEffect(() => {
    if (!open) return;
    setActiveSection((current) => current ?? selectedSection?.key ?? sections[0]?.key ?? null);
  }, [open, selectedSection?.key, sections]);

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
      moveActive(document.activeElement === searchRef.current ? 0 : activeIndex + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveActive(document.activeElement === searchRef.current ? flatItems.length - 1 : activeIndex - 1);
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

  return (
    <div className="chat-modelpick">
      <button
        type="button"
        ref={anchorRef}
        className="chat-model-trigger"
        title={triggerTitle}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setActiveSection(selectedSection?.key ?? sections[0]?.key ?? null);
          setQuery("");
          setOpen((v) => !v);
        }}
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
            role="dialog"
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
            <nav className="chat-modelpop-rail" aria-label="Model providers">
              {sections.map((section) => {
                const representative = section.items[0];
                const mark = representative ? chatMark(representative.provider, representative.label) : null;
                return (
                  <button
                    type="button"
                    key={section.key}
                    className={
                      currentSection?.key === section.key && !normalizedQuery
                        ? "chat-model-provider sel"
                        : "chat-model-provider"
                    }
                    aria-label={section.label}
                    aria-pressed={currentSection?.key === section.key && !normalizedQuery}
                    title={`${section.label} · ${section.items.length}`}
                    onClick={() => {
                      setQuery("");
                      setActiveSection(section.key);
                      setActiveIndex(0);
                      requestAnimationFrame(() => searchRef.current?.focus());
                    }}
                  >
                    {section.kind === "local" ? (
                      <LaptopGlyph size={15} />
                    ) : mark?.logo ? (
                      <ModelLogo logo={mark.logo} />
                    ) : (
                      <span aria-hidden="true">{mark?.initial ?? "⇢"}</span>
                    )}
                    <span className="chat-model-provider-count">{section.items.length}</span>
                  </button>
                );
              })}
            </nav>
            <div className="chat-modelpop-main">
              <label className="chat-model-search">
                <SearchGlyph size={14} />
                <input
                  ref={searchRef}
                  value={query}
                  placeholder="Search models…"
                  aria-label="Search models"
                  onChange={(event) => {
                    setQuery(event.currentTarget.value);
                    setActiveIndex(0);
                  }}
                />
              </label>
              <div className="chat-modelpop-heading">
                <div>
                  <strong>{normalizedQuery ? "Search results" : currentSection?.label}</strong>
                  {!normalizedQuery && currentSection?.hint && <span>{currentSection.hint}</span>}
                </div>
                <span>{flatItems.length}</span>
              </div>
              <div className="chat-modelpop-list" role="radiogroup" aria-label="Available models">
                {flatItems.length === 0 ? (
                  <p className="chat-model-empty">No models match “{query.trim()}”.</p>
                ) : (
                  flatItems.map((m, index) => {
                    const sel = m.id === picked?.id;
                    const mark = chatMark(m.provider, m.label);
                    const owner = sectionFor(m)?.label ?? m.provider;
                    return (
                      <button
                        type="button"
                        key={`${m.provider}:${m.id}`}
                        ref={(node) => {
                          rowRefs.current[index] = node;
                        }}
                        className={sel ? "chat-modelrow sel" : "chat-modelrow"}
                        role="radio"
                        aria-checked={sel}
                        tabIndex={activeIndex === index ? 0 : -1}
                        onFocus={() => setActiveIndex(index)}
                        onMouseEnter={() => setActiveIndex(index)}
                        onClick={() => {
                          onPick(m.id);
                          setOpen(false);
                        }}
                      >
                        <span className="chat-modelrow-logo">
                          {mark.logo ? (
                            <ModelLogo logo={mark.logo} />
                          ) : (
                            <span aria-hidden="true">{mark.initial}</span>
                          )}
                        </span>
                        <span className="chat-modelrow-copy">
                          <span className="chat-modelrow-name">{shortModelLabel(m.label)}</span>
                          {/* browsing a provider already names it in the heading */}
                          {normalizedQuery && <small>{owner}</small>}
                        </span>
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
                  })
                )}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
