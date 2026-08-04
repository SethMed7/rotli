// The /image-gen popover (Seth, 2026-08-04: "/image-gen {choose your model}
// {your prompt} — it will only offer models you are actively logged into").
// Anchored at the slash line like the embed pickers: pick an image engine,
// type the prompt, Generate. The PNG lands in the memex's storage/images/
// asset home and the caller inserts `![…](storage:images/<file>)`.
//
// Engine gating is capability- + login-based (ROTLI_MODELS): an engine is
// offered only when its lane is ENABLED in Settings → AI Models AND its CLI
// probe reports installed + authenticated. No engine ⇒ the popover says how to
// connect one instead of failing later.

import { useQueries } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { type CliDetect, cliDetect, generateImage, cliCancel, isTauri } from "../lib/tauri";
import { activeInstance } from "../memex/config";
import { useMemexConfig } from "../memex/useMemex";
import { useUiStore } from "../state/ui";

export type ImageEngineId = "codex" | "agy";

export interface ImageEngineOption {
  id: ImageEngineId;
  label: string;
}

const ENGINE_LABELS: Record<ImageEngineId, string> = {
  codex: "GPT Image (Codex)",
  agy: "Nano Banana (Gemini)",
};

/** The engines the popover may offer: enabled lane + installed + authenticated.
 * Pure — exported for tests. */
export function readyImageEngines(
  enabled: Record<string, boolean>,
  detects: Partial<Record<ImageEngineId, CliDetect | undefined>>,
): ImageEngineOption[] {
  return (["codex", "agy"] as const)
    .filter((id) => enabled[id] && !!detects[id]?.installed && !!detects[id]?.authenticated)
    .map((id) => ({ id, label: ENGINE_LABELS[id] }));
}

/** The inserted markdown for a finished generation. Pure — exported for tests.
 * The alt is the prompt, flattened and clipped so the line stays readable; the
 * src uses the `storage:` shorthand every other note image speaks. */
export function imageGenMarkdown(prompt: string, rel: string): string {
  const alt = prompt
    .replace(/\s+/g, " ")
    .replace(/[[\]()]/g, "")
    .trim()
    .slice(0, 80);
  const src = rel.replace(/^storage\//i, "");
  return `![${alt}](storage:${src})\n`;
}

export function ImageGenPopover({
  onDone,
  onClose,
}: {
  /** Insert the finished image's markdown at the slash point. */
  onDone: (markdown: string) => void;
  onClose: () => void;
}) {
  const cfg = useMemexConfig();
  const active = cfg.data ? activeInstance(cfg.data) : null;
  const aiProviders = useUiStore((s) => s.aiProviders);
  const defaultEngine = useUiStore((s) => s.imageEngine);
  const checks = useQueries({
    queries: (["codex", "agy"] as const).map((id) => ({
      queryKey: ["cli-detect", id],
      queryFn: () => cliDetect(id),
      enabled: isTauri() && aiProviders[id],
      staleTime: 60_000,
    })),
  });
  const engines = readyImageEngines(aiProviders, {
    codex: checks[0]?.data,
    agy: checks[1]?.data,
  });
  const checking = (["codex", "agy"] as const).some((id, i) => aiProviders[id] && !checks[i]?.isFetched);

  const [engine, setEngine] = useState<ImageEngineId | null>(null);
  const picked = engine ?? (engines.some((e) => e.id === defaultEngine) ? defaultEngine : engines[0]?.id);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => inputRef.current?.focus(), []);
  // an unmount mid-generation abandons the job (kills the engine child)
  useEffect(
    () => () => {
      const id = requestRef.current;
      if (id) void cliCancel(id).catch(() => {});
    },
    [],
  );

  const generate = async () => {
    if (!active || !picked || !prompt.trim() || busy) return;
    setBusy(true);
    setError(null);
    const requestId = crypto.randomUUID();
    requestRef.current = requestId;
    try {
      const rel = await generateImage({
        requestId,
        root: active.root,
        slug: "", // the NOTES lane — storage/images/
        prompt: prompt.trim(),
        engine: picked,
      });
      requestRef.current = null;
      onDone(imageGenMarkdown(prompt.trim(), rel));
    } catch (e) {
      requestRef.current = null;
      setBusy(false);
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div
      className="rotli-imagegen"
      role="dialog"
      aria-label="Generate image"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      {engines.length === 0 ? (
        <p className="rotli-imagegen-empty">
          {checking
            ? "Checking your connected models…"
            : "No image engine is signed in — connect Codex (GPT) or Gemini in Settings → AI Models."}
        </p>
      ) : (
        <>
          <div className="rotli-imagegen-engines" role="radiogroup" aria-label="Image model">
            {engines.map((option) => (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={picked === option.id}
                className={`rotli-imagegen-engine${picked === option.id ? " sel" : ""}`}
                disabled={busy}
                onClick={() => setEngine(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <textarea
            ref={inputRef}
            className="rotli-imagegen-prompt"
            placeholder="Describe the image…"
            value={prompt}
            rows={3}
            disabled={busy}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void generate();
              }
            }}
          />
          {error && <p className="rotli-imagegen-error">⚠ {error}</p>}
          <div className="rotli-imagegen-row">
            <span className="rotli-imagegen-note">
              {busy ? "Generating — this can take a minute…" : "Saved to storage/images/"}
            </span>
            <button type="button" className="rotli-imagegen-cancel" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="rotli-imagegen-go"
              disabled={busy || !prompt.trim() || !picked}
              onClick={() => void generate()}
            >
              {busy ? "Generating…" : "Generate"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
