import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";

import { CLI_CATALOG, PROVIDER_IDS, PROVIDER_LABELS, type ProviderId } from "../../ai/models";
import { BREVE_PDF_PRESETS, validateBrevePdfPalette } from "../../brand/brevePdfThemes";
import { type Block, parseBlock, renderInline } from "../../editor/render";
import {
  type BreveRoutine,
  type BreveSnapshot,
  type ChatModelInfo,
  breveImportLegacy,
  breveDeliverySettings,
  breveRemoveResendKey,
  breveStoreResendKey,
  breveTakeover,
  breveRetireLegacy,
  breveBriefSkill,
  breveTestEmail,
  breveTestSignal,
  breveWriteBriefSkill,
  breveWriteDeliverySettings,
  breveWriteConfig,
  chatModels,
  cliDetect,
  corpusFileText,
  corpusResolveRef,
  fileAssetUrl,
  isTauri,
  type BreveDeliverySettings,
  type BrevePdfPalette,
  type BrevePdfTheme,
  type BrevePdfThemePreset,
} from "../../lib/tauri";
import {
  EMPTY_BREVE_SNAPSHOT,
  formatNextRoutine,
  modelPolicyOptions,
  nextRoutineEpoch,
  sortBriefs,
} from "../../routines/briefs";
import { routinePipeline } from "../../routines/pipeline";
import { usePanesStore } from "../../state/panes";
import { useUiStore } from "../../state/ui";
import { CheckGlyph, ChevronRight, ClockGlyph, LockGlyph, SearchGlyph, XGlyph } from "../glyphs";
import {
  BreveSkeleton,
  EmptyMessage,
  PageHead,
  SaveNote,
  useBreveDraftGuard,
  type SaveState,
} from "./breveShared";
import { WatchlistView } from "./breveWatchlist";
import { RoutinePipelineView } from "./routinePipelineView";
import { BREVE_QUERY_KEY, useBreveSnapshot } from "./useBreve";

function SourceStrip({ snapshot }: { snapshot: BreveSnapshot }) {
  const label =
    snapshot.source === "rotli"
      ? "Rotli library"
      : snapshot.source === "legacy"
        ? "Legacy Breve detected"
        : "No Breve library detected";
  return (
    <div className="breve-source-strip">
      <span className="breve-source-state">
        <span className="breve-status-dot" aria-hidden="true" />
        {label}
      </span>
      {snapshot.legacyRoot && <code title={snapshot.legacyRoot}>{snapshot.legacyRoot}</code>}
    </div>
  );
}

/** The legacy-Breve migration ladder (import → take over scheduling → retire).
 * Lives in Settings (2026-07-30 rework) — Briefs is a reading surface now. */
function MigrationBands({ snapshot }: { snapshot: BreveSnapshot }) {
  const queryClient = useQueryClient();
  const [importState, setImportState] = useState<SaveState>("idle");
  const [takeoverState, setTakeoverState] = useState<SaveState>("idle");
  const [retireState, setRetireState] = useState<SaveState>("idle");
  const [retireArmed, setRetireArmed] = useState(false);
  const [error, setError] = useState("");

  const importLegacy = async () => {
    setImportState("saving");
    setError("");
    try {
      const next = await breveImportLegacy();
      queryClient.setQueryData(BREVE_QUERY_KEY, next);
      setImportState("saved");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setImportState("error");
    }
  };

  const takeOver = async () => {
    setTakeoverState("saving");
    setError("");
    try {
      const next = await breveTakeover();
      queryClient.setQueryData(BREVE_QUERY_KEY, next);
      setTakeoverState("saved");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setTakeoverState("error");
    }
  };

  const retireLegacy = async () => {
    setRetireState("saving");
    setError("");
    try {
      const next = await breveRetireLegacy();
      queryClient.setQueryData(BREVE_QUERY_KEY, next);
      setRetireState("saved");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setRetireState("error");
    }
  };

  return (
    <>
      {snapshot.source === "legacy" && !snapshot.imported && (
        <section className="breve-import-band" aria-labelledby="breve-import-title">
          <div>
            <h3 id="breve-import-title">Bring the Breve library into Rotli</h3>
            <p>The importer preserves the watchlist, schedules, brief Markdown, and related artifacts.</p>
          </div>
          <button
            type="button"
            className="ghostbtn primary"
            disabled={importState === "saving"}
            onClick={() => void importLegacy()}
          >
            {importState === "saving" ? "Importing…" : "Import from Breve"}
          </button>
          <SaveNote state={importState} error={error} />
        </section>
      )}

      {snapshot.legacyRoot && snapshot.scheduler !== "rotli" && (
        <section className="breve-import-band" aria-labelledby="breve-takeover-title">
          <div>
            <h3 id="breve-takeover-title">Move scheduling into Rotli</h3>
            <p>
              Copies private runtime state, disables Breve&rsquo;s seven legacy launchd jobs, and starts the
              Rotli-managed scheduler. The legacy folder is kept as a backup.
            </p>
          </div>
          <button
            type="button"
            className="ghostbtn primary"
            disabled={takeoverState === "saving"}
            onClick={() => void takeOver()}
          >
            {takeoverState === "saving" ? "Moving…" : "Move scheduling to Rotli"}
          </button>
          <SaveNote state={takeoverState} error={error} />
        </section>
      )}

      {snapshot.legacyRoot && snapshot.scheduler === "rotli" && (
        <section className="breve-import-band" aria-labelledby="breve-retire-title">
          <div>
            <h3 id="breve-retire-title">Legacy project is ready to retire</h3>
            <p>
              Rotli is running the scheduler. This verifies the managed state and moves
              <code>{snapshot.legacyRoot}</code> to Trash.
            </p>
          </div>
          <div className="breve-confirm-actions">
            {retireArmed ? (
              <>
                <button type="button" className="ghostbtn" onClick={() => setRetireArmed(false)}>
                  Keep project
                </button>
                <button
                  type="button"
                  className="ghostbtn primary"
                  disabled={retireState === "saving"}
                  onClick={() => void retireLegacy()}
                >
                  {retireState === "saving" ? "Verifying…" : "Confirm move to Trash"}
                </button>
              </>
            ) : (
              <button type="button" className="ghostbtn quiet" onClick={() => setRetireArmed(true)}>
                Review retirement
              </button>
            )}
          </div>
          <SaveNote state={retireState} error={error} />
        </section>
      )}
    </>
  );
}

/** The reader loads at most this much of a brief — far above any real brief. */
const BRIEF_READ_BYTES = 262_144;

/** Rotli frontmatter is metadata, not the brief — the reader starts at the
 * brief's own `# title`. The closing fence must be exactly `---` on its own
 * line (never `----` or a prefixed line), CRLF tolerated; anything that isn't
 * a well-formed fence pair renders untouched (adversarial review, LOW). */
function stripBriefFrontmatter(text: string): string {
  const fence = text.match(/^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/);
  return fence ? text.slice(fence[0].length) : text;
}

/** The inline reader's static markdown render — the SAME line grammar the
 * editor and Quick Look use (parseBlock + renderInline). Read-only by design:
 * the brief note itself stays one "Open in Notes" away. */
function BriefBody({ body }: { body: string }) {
  const blocks: ReactNode[] = [];
  let key = 0;
  for (const line of body.split("\n")) {
    const b: Block = parseBlock(line);
    key += 1;
    if (b.kind === "blank") blocks.push(<div key={key} className="pv-blank" />);
    else if (b.kind === "h1") blocks.push(<h1 key={key}>{renderInline(b.text)}</h1>);
    else if (b.kind === "h2") blocks.push(<h2 key={key}>{renderInline(b.text)}</h2>);
    else if (b.kind === "h3") blocks.push(<h3 key={key}>{renderInline(b.text)}</h3>);
    else if (b.kind === "quote") blocks.push(<blockquote key={key}>{renderInline(b.text)}</blockquote>);
    else if (b.kind === "bullet" || b.kind === "task" || b.kind === "numbered")
      blocks.push(
        <div key={key} className="pv-li" style={{ paddingLeft: `${(b.indent ?? 0) + 1.2}em` }}>
          <span className="pv-marker">{b.marker ?? "•"}</span>
          {renderInline(b.text)}
        </div>,
      );
    else blocks.push(<p key={key}>{renderInline(b.text)}</p>);
  }
  return <div className="pv-note breve-read">{blocks}</div>;
}

/** Same-day recency for the reader: night is the day's newest, morning its
 * oldest. sortBriefs keeps same-day kinds ASCENDING for the library list, so
 * the reader re-sorts (adversarial review: "latest" was the morning brief and
 * Older/Newer stepped backwards within a day). */
const KIND_RECENCY: Record<string, number> = { morning: 0, lunch: 1, night: 2 };

function briefDateLabel(date: string): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${date}T12:00:00`));
}

/** The brief's spoken version (storage/breveAudios/<stem>.mp3) as an inline
 * player — the asset URL resolves async, so the player appears once ready and
 * simply stays hidden if the file can't resolve. */
function BriefAudio({ path }: { path: string }) {
  const url = useQuery({
    queryKey: ["breve", "brief-audio", path],
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: () => fileAssetUrl(path),
  });
  if (!url.data) return null;
  return (
    <audio
      className="breve-reader-audio"
      controls
      preload="metadata"
      src={url.data}
      aria-label="Listen to this brief"
    />
  );
}

function BriefsView({ snapshot }: { snapshot: BreveSnapshot }) {
  const openNote = usePanesStore((s) => s.openNote);
  const setSidebarMode = useUiStore((s) => s.setSidebarMode);
  const setView = useUiStore((s) => s.setBreveView);
  const [briefQuery, setBriefQuery] = useState("");
  const [briefKind, setBriefKind] = useState<"all" | "morning" | "lunch" | "night">("all");
  // which brief the inline reader shows — reading happens HERE, never by
  // leaving Breve (Seth, 2026-07-30); default = the latest readable brief
  const [openStem, setOpenStem] = useState<string | null>(null);
  const readerRef = useRef<HTMLElement | null>(null);
  const briefs = useMemo(() => sortBriefs(snapshot.briefs), [snapshot.briefs]);
  const readable = useMemo(
    () =>
      briefs
        .filter((brief) => brief.path)
        .sort((a, b) =>
          a.date === b.date
            ? (KIND_RECENCY[b.kind] ?? 0) - (KIND_RECENCY[a.kind] ?? 0)
            : b.date.localeCompare(a.date),
        ),
    [briefs],
  );
  const current = readable.find((brief) => brief.stem === openStem) ?? readable[0];
  const currentIndex = current ? readable.findIndex((brief) => brief.stem === current.stem) : -1;
  const newer = currentIndex > 0 ? readable[currentIndex - 1] : undefined;
  const older = currentIndex >= 0 ? readable[currentIndex + 1] : undefined;
  const normalizedBriefQuery = briefQuery.trim().toLowerCase();
  const visibleBriefs = briefs.filter(
    (brief) =>
      (briefKind === "all" || brief.kind === briefKind) &&
      (!normalizedBriefQuery ||
        `${brief.title} ${brief.date} ${brief.kind}`.toLowerCase().includes(normalizedBriefQuery)),
  );
  const now = Date.now();
  const nextBriefRoutine = snapshot.config.routines
    .filter((routine) => routine.enabled && routine.kind === "brief")
    .map((routine) => ({ routine, epoch: nextRoutineEpoch(routine, now, snapshot.config.timezone) }))
    .filter((entry): entry is { routine: BreveRoutine; epoch: number } => entry.epoch !== null)
    .sort((a, b) => a.epoch - b.epoch)[0]?.routine;

  const body = useQuery({
    queryKey: ["breve", "brief-body", current?.path ?? ""],
    enabled: !!current?.path,
    staleTime: 60_000,
    queryFn: () => corpusFileText(current!.path!, BRIEF_READ_BYTES),
  });
  const briefText = body.data ? stripBriefFrontmatter(body.data) : "";
  const readMinutes = briefText ? Math.max(1, Math.round(briefText.split(/\s+/).length / 220)) : null;

  const readBrief = (stem: string) => {
    setOpenStem(stem);
    requestAnimationFrame(() => readerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  return (
    <div className="breve-page">
      <PageHead title="Briefs" detail="Today's brief, read right here — the library sits below." />

      {snapshot.source === "legacy" && !snapshot.imported && (
        <div className="breve-honesty" role="status">
          <p>
            A legacy Breve library was found but not imported yet — bring it in from{" "}
            <button type="button" className="breve-linkbtn" onClick={() => setView("settings")}>
              Settings
            </button>
            .
          </p>
        </div>
      )}

      {!current ? (
        briefs.length > 0 ? (
          <EmptyMessage
            title="These briefs live in the legacy library."
            detail="Import them from Settings to read them here without leaving Breve."
            action={
              <button type="button" className="ghostbtn primary" onClick={() => setView("settings")}>
                Open Settings
              </button>
            }
          />
        ) : (
          <EmptyMessage
            title="Your first brief has not arrived yet."
            detail={
              snapshot.counts.topics > 0
                ? "Your watchlist is ready. Review the routine schedule to choose when Breve should arrive."
                : "Add the topics you care about, then choose when each briefing should arrive."
            }
            action={
              <button
                type="button"
                className="ghostbtn primary"
                onClick={() => setView(snapshot.counts.topics > 0 ? "routines" : "watchlist")}
              >
                {snapshot.counts.topics > 0 ? "Review routines" : "Build watchlist"}
              </button>
            }
          />
        )
      ) : (
        <section className="breve-reader" aria-label={`Brief: ${current.title}`} ref={readerRef}>
          <div className="breve-reader-bar">
            <div className="breve-reader-nav" role="group" aria-label="Brief navigation">
              <button
                type="button"
                className="breve-reader-step"
                disabled={!older}
                aria-label="Older brief"
                title={older ? `Older — ${older.title}` : "This is the oldest brief"}
                onClick={() => older && readBrief(older.stem)}
              >
                <ChevronRight size={12} className="flip" />
              </button>
              <button
                type="button"
                className="breve-reader-step"
                disabled={!newer}
                aria-label="Newer brief"
                title={newer ? `Newer — ${newer.title}` : "This is the latest brief"}
                onClick={() => newer && readBrief(newer.stem)}
              >
                <ChevronRight size={12} />
              </button>
            </div>
            <span className={`breve-kind ${current.kind}`}>{current.kind}</span>
            <time dateTime={current.date}>{briefDateLabel(current.date)}</time>
            {readMinutes !== null && <span className="breve-reader-min">~{readMinutes} min</span>}
            <span className="breve-toolbar-grow" />
            <button
              type="button"
              className="ghostbtn quiet"
              title="Open the brief note in the editor"
              onClick={() => {
                setSidebarMode("notes");
                // briefs travel as REL paths but openNote is an id-only door —
                // resolve to the note's wire ULID first, or the tab opens on an
                // unresolvable id and renders "Untitled" (Seth, 2026-07-31)
                void corpusResolveRef(current.path!)
                  .then((id) => openNote(id))
                  .catch(() => openNote(current.path!));
              }}
            >
              Open in Notes
            </button>
          </div>
          {current.audioPath && <BriefAudio path={current.audioPath} />}
          {body.isLoading ? (
            <BreveSkeleton label="Opening the brief" />
          ) : body.isError ? (
            <EmptyMessage
              title="This brief could not be read."
              detail="The file may have moved. The library below is still live."
              action={
                <button type="button" className="ghostbtn" onClick={() => void body.refetch()}>
                  Try again
                </button>
              }
            />
          ) : (
            <>
              <BriefBody body={briefText} />
              {/* the finite-edition close: a brief ENDS — no feed, no more-to-load
                  (the anti-infinite-scroll statement, market pass 2026-07-30) */}
              <p className="breve-reader-end">
                That&rsquo;s the whole brief
                {snapshot.counts.topics ? ` — distilled from your ${snapshot.counts.topics} topics` : ""}.
                {nextBriefRoutine && (
                  <>
                    {" "}
                    Next: <strong>{nextBriefRoutine.label}</strong> —{" "}
                    {formatNextRoutine(nextBriefRoutine, now, snapshot.config.timezone)}.{" "}
                    <button type="button" className="breve-linkbtn" onClick={() => setView("routines")}>
                      Routines
                    </button>
                  </>
                )}
              </p>
            </>
          )}
        </section>
      )}

      <section className="breve-section breve-library-section" aria-labelledby="breve-recent-title">
        <div className="breve-section-head copy">
          <div>
            <h3 id="breve-recent-title">Brief library</h3>
            <p>Find a past briefing by title, date, or delivery period.</p>
          </div>
          {snapshot.imported && (
            <span className="breve-inline-status">
              <CheckGlyph size={12} /> In Rotli
            </span>
          )}
        </div>
        {briefs.length > 0 && (
          <div className="breve-brief-toolbar">
            <label className="breve-watch-search" htmlFor="breve-brief-search">
              <SearchGlyph size={14} />
              <input
                id="breve-brief-search"
                value={briefQuery}
                aria-label="Search brief library"
                placeholder="Search briefs…"
                onChange={(event) => setBriefQuery(event.target.value)}
              />
            </label>
            <label>
              <span className="sr-only">Filter briefs by period</span>
              <select
                value={briefKind}
                onChange={(event) => setBriefKind(event.target.value as typeof briefKind)}
              >
                <option value="all">All periods</option>
                <option value="morning">Morning</option>
                <option value="lunch">Lunch</option>
                <option value="night">Night</option>
              </select>
            </label>
            <span className="breve-watch-count">
              {visibleBriefs.length} of {briefs.length}
            </span>
          </div>
        )}
        {briefs.length === 0 ? (
          <EmptyMessage
            title="Your first brief has not arrived yet."
            detail={
              snapshot.counts.topics > 0
                ? "Your watchlist is ready. Review the routine schedule to choose when Breve should arrive."
                : "Add the topics you care about, then choose when each briefing should arrive."
            }
            action={
              <button
                type="button"
                className="ghostbtn primary"
                onClick={() => setView(snapshot.counts.topics > 0 ? "routines" : "watchlist")}
              >
                {snapshot.counts.topics > 0 ? "Review routines" : "Build watchlist"}
              </button>
            }
          />
        ) : visibleBriefs.length === 0 ? (
          <EmptyMessage
            title="No briefs match this view."
            detail="Try another period or clear the search phrase."
            action={
              <button
                type="button"
                className="ghostbtn"
                onClick={() => {
                  setBriefQuery("");
                  setBriefKind("all");
                }}
              >
                Clear filters
              </button>
            }
          />
        ) : (
          <div className="breve-brief-list">
            {visibleBriefs.map((brief) => {
              const content = (
                <>
                  <span className={`breve-kind ${brief.kind}`}>{brief.kind}</span>
                  <span className="breve-brief-title" title={brief.title}>
                    {brief.title}
                  </span>
                  <time dateTime={brief.date}>
                    {new Intl.DateTimeFormat(undefined, {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    }).format(new Date(`${brief.date}T12:00:00`))}
                  </time>
                  <span className="breve-brief-state">{brief.imported ? "In Rotli" : "Legacy"}</span>
                </>
              );
              // a row READS the brief in place (the inline reader above) —
              // leaving Breve is the reader's explicit "Open in Notes" only
              return brief.path ? (
                <button
                  type="button"
                  className={
                    current?.stem === brief.stem
                      ? "breve-brief-row interactive sel"
                      : "breve-brief-row interactive"
                  }
                  key={brief.stem}
                  aria-current={current?.stem === brief.stem ? "true" : undefined}
                  title={`Read ${brief.title}`}
                  onClick={() => readBrief(brief.stem)}
                >
                  {content}
                </button>
              ) : (
                <div className="breve-brief-row" key={brief.stem}>
                  {content}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

type BriefSlot = "morning" | "lunch" | "night";

/** The seven built-ins the scheduler keys on — everything else is a user
 * CUSTOM routine (removable, prompt-required). Mirrors Rust's
 * BUILTIN_ROUTINE_IDS. */
const BUILTIN_ROUTINE_IDS = new Set([
  "morning",
  "lunch",
  "night",
  "creators",
  "watchers",
  "doctor",
  "signal",
]);
function isCustomRoutine(routine: BreveRoutine): boolean {
  return !BUILTIN_ROUTINE_IDS.has(routine.id);
}

function routineBriefSlot(routine: BreveRoutine): BriefSlot | null {
  // custom routines never map to an arrival slot — a custom "night watch"
  // must not ride the built-in night arrival's delivery-time lockstep
  if (isCustomRoutine(routine)) return null;
  const text = `${routine.id} ${routine.label}`.toLowerCase();
  if (text.includes("morning")) return "morning";
  if (text.includes("lunch") || text.includes("pivot")) return "lunch";
  if (text.includes("night")) return "night";
  return null;
}

function RoutinesView({ snapshot }: { snapshot: BreveSnapshot }) {
  const queryClient = useQueryClient();
  const setView = useUiStore((s) => s.setBreveView);
  const [config, setConfig] = useState(snapshot.config);
  const [base, setBase] = useState(snapshot.config);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [error, setError] = useState("");
  // serialize only when a side actually changes — the draft-guard dirty check
  // ran two full stringifies per keystroke (perf audit 2026-07-30, finding 24)
  const configJson = useMemo(() => JSON.stringify(config), [config]);
  const baseJson = useMemo(() => JSON.stringify(base), [base]);
  const dirty = configJson !== baseJson;
  const now = Date.now();
  useBreveDraftGuard(dirty);

  useEffect(() => {
    if (dirty) return;
    setConfig(snapshot.config);
    setBase(snapshot.config);
  }, [dirty, snapshot.config]);
  useEffect(() => {
    if (dirty && saveState === "saved") setSaveState("idle");
  }, [dirty, saveState]);

  const patchRoutine = (id: string, patch: Partial<BreveRoutine>) =>
    setConfig((current) => ({
      ...current,
      routines: current.routines.map((routine) => (routine.id === id ? { ...routine, ...patch } : routine)),
    }));

  const setDelivery = (slot: BriefSlot, hhmm: string) => {
    setConfig((current) => ({
      ...current,
      deliveryTimes: { ...current.deliveryTimes, [slot]: hhmm },
      routines: current.routines.map((routine) => {
        if (routineBriefSlot(routine) !== slot || routine.schedule.kind !== "dailyAt") return routine;
        return { ...routine, schedule: { ...routine.schedule, hhmm } };
      }),
    }));
  };

  const setLead = (slot: BriefSlot, leadMinutes: number) => {
    setConfig((current) => ({
      ...current,
      leadOverrides: { ...current.leadOverrides, [slot]: leadMinutes },
      routines: current.routines.map((routine) => {
        if (routineBriefSlot(routine) !== slot || routine.schedule.kind !== "dailyAt") return routine;
        return { ...routine, schedule: { ...routine.schedule, leadMinutes } };
      }),
    }));
  };

  const save = async () => {
    setSaveState("saving");
    setError("");
    try {
      const next = await breveWriteConfig(config);
      queryClient.setQueryData(BREVE_QUERY_KEY, next);
      setBase(next.config);
      setSaveState("saved");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaveState("error");
    }
  };

  // legacy-less Breve activation for a fresh vault (2026-07-31)
  const [activateState, setActivateState] = useState<SaveState>("idle");
  const [activateError, setActivateError] = useState("");
  const activate = async () => {
    setActivateState("saving");
    setActivateError("");
    try {
      const next = await breveTakeover();
      queryClient.setQueryData(BREVE_QUERY_KEY, next);
      setActivateState("saved");
    } catch (e) {
      setActivateError(e instanceof Error ? e.message : String(e));
      setActivateState("error");
    }
  };

  // ── custom routines (Seth, 2026-07-31): add/remove + per-routine prompts ──
  const [promptOpen, setPromptOpen] = useState<string | null>(null);
  /** Which routine's workflow graph is expanded (2026-08-04). */
  const [flowOpen, setFlowOpen] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addLabel, setAddLabel] = useState("");
  const [addKind, setAddKind] = useState<"brief" | "reminder">("brief");
  const [addTime, setAddTime] = useState("09:00");
  const [addPrompt, setAddPrompt] = useState("");
  const [addLanes, setAddLanes] = useState<string[]>(["inApp", "signal"]);

  // instructions apply to custom routines AND the built-in briefs
  const promptable = (routine: BreveRoutine) =>
    isCustomRoutine(routine) || routineBriefSlot(routine) !== null;
  // clearing must REMOVE the field (an empty string fails Rust validation,
  // and exactOptionalPropertyTypes forbids prompt: undefined)
  const setRoutinePrompt = (id: string, value: string) =>
    setConfig((current) => ({
      ...current,
      routines: current.routines.map((routine) => {
        if (routine.id !== id) return routine;
        const { prompt: _drop, ...rest } = routine;
        return value ? { ...rest, prompt: value } : rest;
      }),
    }));
  const removeRoutine = (id: string) => {
    if (promptOpen === id) setPromptOpen(null);
    setConfig((current) => ({
      ...current,
      routines: current.routines.filter((routine) => routine.id !== id),
    }));
  };
  const addRoutine = () => {
    const base = addLabel
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 36)
      // the slice can re-expose a trailing dash; slot suffixes are reserved
      // (Rust refuses them — see valid_routine_slug)
      .replace(/-+$/g, "")
      .replace(/-(lunch|night)$/g, "-$1x");
    if (!base || !addPrompt.trim()) return;
    let id = base;
    let n = 2;
    while (config.routines.some((routine) => routine.id === id)) id = `${base}-${n++}`;
    setConfig((current) => ({
      ...current,
      routines: [
        ...current.routines,
        {
          id,
          label: addLabel.trim(),
          kind: addKind,
          enabled: true,
          schedule: { kind: "dailyAt", hhmm: addTime, leadMinutes: 0 },
          lanes: addLanes,
          prompt: addPrompt.trim(),
        },
      ],
    }));
    setAddOpen(false);
    setAddLabel("");
    setAddPrompt("");
    setAddKind("brief");
    setAddTime("09:00");
    setAddLanes(["inApp", "signal"]);
  };

  return (
    <div className="breve-page">
      <PageHead
        title="Routines"
        detail="Arrival times, recurring checks, and the jobs that build each brief."
      />
      <div className="breve-honesty" role="status">
        <ClockGlyph size={15} />
        <p>
          {snapshot.scheduler === "rotli"
            ? "Rotli is actively managing these routines and the always-on Signal assistant. Saved changes are adopted automatically."
            : snapshot.scheduler === "legacy-launchd"
              ? "The previous Breve scheduler is still in charge. Changes are preserved here, but Rotli does not deliver scheduled briefs yet."
              : "Rotli stores these routines, but its delivery scheduler is not active yet."}
        </p>
        {/* legacy-less activation (2026-07-31): a fresh vault has nothing to
            "take over" — this scaffolds the managed runtime, seeds it from the
            shared defaults, and starts the supervisor for THIS vault. */}
        {snapshot.scheduler === "none" && !snapshot.legacyRoot && (
          <button
            type="button"
            className="ghostbtn primary"
            disabled={activateState === "saving"}
            onClick={() => void activate()}
          >
            {activateState === "saving" ? "Starting…" : "Start Breve in this vault"}
          </button>
        )}
      </div>
      {activateError && (
        <p className="file-err" role="alert">
          ⚠ {activateError}
        </p>
      )}

      <div className="breve-config-toolbar">
        <label>
          <span>Timezone</span>
          <input
            value={config.timezone}
            onChange={(e) => setConfig({ ...config, timezone: e.target.value })}
          />
        </label>
        <span className="breve-toolbar-grow" />
        <SaveNote state={saveState} error={error} dirty={dirty} />
        <button
          type="button"
          className="ghostbtn primary"
          disabled={!dirty || saveState === "saving"}
          onClick={() => void save()}
        >
          {saveState === "saving" ? "Saving…" : "Save routines"}
        </button>
      </div>

      <section className="breve-section" aria-labelledby="breve-arrivals-title">
        <div className="breve-section-head copy">
          <div>
            <h3 id="breve-arrivals-title">Brief arrivals</h3>
            <p>Choose when each brief arrives and how early Breve should begin preparing it.</p>
          </div>
        </div>
        <div className="breve-arrivals">
          <div className="breve-arrival-head" aria-hidden="true">
            <span>Brief</span>
            <span>Delivery time</span>
            <span>Start preparing</span>
          </div>
          {(["morning", "lunch", "night"] as const).map((slot) => (
            <div className="breve-arrival-row" key={slot}>
              <span className={`breve-kind ${slot}`}>{slot}</span>
              <label>
                <span className="breve-mobile-field-label" aria-hidden="true">
                  Delivery time
                </span>
                <span className="sr-only">{slot} delivery time</span>
                <input
                  type="time"
                  value={config.deliveryTimes[slot]}
                  onChange={(e) => setDelivery(slot, e.target.value)}
                />
              </label>
              <label>
                <span className="breve-mobile-field-label" aria-hidden="true">
                  Start preparing
                </span>
                <span className="sr-only">Minutes to start preparing before {slot}</span>
                <input
                  type="number"
                  min="0"
                  max="240"
                  value={config.leadOverrides[slot] ?? config.leadMinutes}
                  onChange={(e) => setLead(slot, Math.max(0, Number(e.target.value) || 0))}
                />
                <span>minutes before</span>
              </label>
            </div>
          ))}
        </div>
      </section>

      <section className="breve-section" aria-labelledby="breve-jobs-title">
        <div className="breve-section-head copy">
          <div>
            <h3 id="breve-jobs-title">Automations</h3>
            <p>Control what Breve runs and where each result should appear.</p>
          </div>
          <span className="breve-inline-status">
            {config.routines.filter((routine) => routine.enabled).length} of {config.routines.length} active
          </span>
        </div>
        {config.routines.length === 0 && (
          <EmptyMessage
            title="No automations yet."
            detail="Breve's briefing and check-in jobs appear here once a Breve library is imported or set up. Start from the Briefs page."
            action={
              <button type="button" className="ghostbtn" onClick={() => setView("briefs")}>
                Go to Briefs
              </button>
            }
          />
        )}
        {config.routines.length > 0 && (
          <div className="breve-routine-columns" aria-hidden="true">
            <span>Automation</span>
            <span>Cadence</span>
            <span>Delivery</span>
          </div>
        )}
        <div className="breve-routine-list">
          {config.routines.map((routine) => {
            const lanes = [...new Set(["inApp", "signal", "email", ...routine.lanes])];
            const slot = routineBriefSlot(routine);
            return (
              <div key={routine.id} className="breve-routine-item">
                <div className={routine.enabled ? "breve-routine-row" : "breve-routine-row off"}>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={routine.enabled}
                    aria-label={`${routine.enabled ? "Disable" : "Enable"} ${routine.label}`}
                    className={routine.enabled ? "breve-routine-toggle on" : "breve-routine-toggle"}
                    onClick={() => patchRoutine(routine.id, { enabled: !routine.enabled })}
                  >
                    <span aria-hidden="true" />
                  </button>
                  <div className="breve-routine-main">
                    <strong>
                      {routine.label}
                      {isCustomRoutine(routine) && (
                        <span className="breve-routine-tag">
                          {routine.kind === "reminder" ? "reminder" : "custom brief"}
                        </span>
                      )}
                    </strong>
                    <span>{formatNextRoutine(routine, now, config.timezone)}</span>
                    {promptable(routine) && (
                      <button
                        type="button"
                        className="breve-routine-promptbtn"
                        aria-expanded={promptOpen === routine.id}
                        onClick={() => setPromptOpen(promptOpen === routine.id ? null : routine.id)}
                      >
                        {routine.prompt ? "Instructions ✎" : "Add instructions…"}
                      </button>
                    )}
                    {/* Workflow (2026-08-04): what this routine actually runs,
                        derived from its executor — read-only in this pass */}
                    <button
                      type="button"
                      className="breve-routine-promptbtn"
                      aria-expanded={flowOpen === routine.id}
                      onClick={() => setFlowOpen(flowOpen === routine.id ? null : routine.id)}
                    >
                      {flowOpen === routine.id ? "Hide workflow" : "Workflow"}
                    </button>
                  </div>
                  <div className="breve-schedule-control">
                    {routine.schedule.kind === "dailyAt" ? (
                      slot ? (
                        <span className="breve-schedule-reference">
                          {`${slot.charAt(0).toUpperCase() + slot.slice(1)} arrival`}
                        </span>
                      ) : (
                        <label>
                          At
                          <input
                            type="time"
                            aria-label={`${routine.label} time of day`}
                            value={routine.schedule.hhmm}
                            onChange={(e) =>
                              patchRoutine(routine.id, {
                                schedule: {
                                  kind: "dailyAt",
                                  hhmm: e.target.value,
                                  leadMinutes:
                                    routine.schedule.kind === "dailyAt" ? routine.schedule.leadMinutes : 0,
                                },
                              })
                            }
                          />
                        </label>
                      )
                    ) : routine.schedule.kind === "everySecs" ? (
                      <label>
                        Every
                        <input
                          type="number"
                          min="1"
                          aria-label={`${routine.label} interval in minutes`}
                          value={Math.max(1, Math.round(routine.schedule.secs / 60))}
                          onChange={(e) =>
                            patchRoutine(routine.id, {
                              schedule: {
                                kind: "everySecs",
                                secs: Math.max(60, Number(e.target.value) * 60 || 60),
                              },
                            })
                          }
                        />
                        min
                      </label>
                    ) : (
                      <span>Listener</span>
                    )}
                  </div>
                  <fieldset className="breve-lanes">
                    <legend className="sr-only">{routine.label} delivery lanes</legend>
                    {lanes.map((lane) => {
                      const checked = routine.lanes.includes(lane);
                      return (
                        <label key={lane}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() =>
                              patchRoutine(routine.id, {
                                lanes: checked
                                  ? routine.lanes.filter((value) => value !== lane)
                                  : [...routine.lanes, lane],
                              })
                            }
                          />
                          {lane === "inApp" ? "Rotli" : lane}
                        </label>
                      );
                    })}
                  </fieldset>
                </div>
                {flowOpen === routine.id && <RoutinePipelineView pipeline={routinePipeline(routine)} />}
                {promptOpen === routine.id && promptable(routine) && (
                  <div className="breve-routine-prompt">
                    <label>
                      <span>
                        {routine.kind === "reminder"
                          ? "What should the reminder say?"
                          : isCustomRoutine(routine)
                            ? "What should this brief research?"
                            : "Extra instructions for this brief (optional)"}
                      </span>
                      <textarea
                        rows={3}
                        maxLength={4000}
                        value={routine.prompt ?? ""}
                        onChange={(e) => setRoutinePrompt(routine.id, e.target.value)}
                      />
                    </label>
                    {isCustomRoutine(routine) && (
                      <button
                        type="button"
                        className="ghostbtn quiet breve-routine-remove"
                        onClick={() => removeRoutine(routine.id)}
                      >
                        Remove routine
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {addOpen ? (
          <div className="breve-add-routine">
            <div className="breve-add-grid">
              <label>
                <span>Name</span>
                <input
                  value={addLabel}
                  placeholder="Crypto watch"
                  onChange={(e) => setAddLabel(e.target.value)}
                />
              </label>
              <label>
                <span>Type</span>
                <select value={addKind} onChange={(e) => setAddKind(e.target.value as "brief" | "reminder")}>
                  <option value="brief">Research brief</option>
                  <option value="reminder">Reminder</option>
                </select>
              </label>
              <label>
                <span>Time</span>
                <input type="time" value={addTime} onChange={(e) => setAddTime(e.target.value)} />
              </label>
            </div>
            <label className="breve-add-prompt">
              <span>{addKind === "brief" ? "What should it research?" : "What should it say?"}</span>
              <textarea
                rows={3}
                maxLength={4000}
                value={addPrompt}
                placeholder={
                  addKind === "brief"
                    ? "Track notable movements in… and flag anything that…"
                    : "Time to review the weekly goals."
                }
                onChange={(e) => setAddPrompt(e.target.value)}
              />
            </label>
            <fieldset className="breve-lanes breve-add-lanes">
              <legend className="sr-only">Delivery lanes for the new routine</legend>
              {["inApp", "signal", "email"].map((lane) => (
                <label key={lane}>
                  <input
                    type="checkbox"
                    checked={addLanes.includes(lane)}
                    onChange={() =>
                      setAddLanes((current) =>
                        current.includes(lane)
                          ? current.filter((value) => value !== lane)
                          : [...current, lane],
                      )
                    }
                  />
                  {lane === "inApp" ? "Rotli" : lane}
                </label>
              ))}
            </fieldset>
            <div className="breve-add-actions">
              <button type="button" className="ghostbtn quiet" onClick={() => setAddOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="ghostbtn primary"
                disabled={!addLabel.trim() || !addPrompt.trim()}
                onClick={addRoutine}
              >
                Add routine
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="ghostbtn breve-add-open" onClick={() => setAddOpen(true)}>
            Add a routine…
          </button>
        )}
      </section>

      <BriefSkillEditor />
    </div>
  );
}

/** The brief system prompt, surfaced (Seth, 2026-07-31: "the briefs have a
 * system prompt let me see that prompt and I should be able to modify them").
 * Edits write a sync-immune override; Reset returns to the shipped default.
 * Applies to the next scheduled brief — no restart needed. */
function BriefSkillEditor() {
  const queryClient = useQueryClient();
  const skill = useQuery({ queryKey: ["breve", "brief-skill"], queryFn: breveBriefSkill, staleTime: 60_000 });
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [error, setError] = useState("");
  const text = draft ?? skill.data?.text ?? "";
  const dirty = draft !== null && draft !== (skill.data?.text ?? "");
  useBreveDraftGuard(dirty);

  const commit = async (value: string | null) => {
    setSaveState("saving");
    setError("");
    try {
      const next = await breveWriteBriefSkill(value);
      queryClient.setQueryData(["breve", "brief-skill"], next);
      setDraft(null);
      setSaveState("saved");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaveState("error");
    }
  };

  return (
    <section className="breve-section" aria-labelledby="breve-skill-title">
      <div className="breve-section-head copy">
        <div>
          <h3 id="breve-skill-title">Brief instructions</h3>
          <p>
            The playbook every brief follows — voice, quality bar, structure, delivery rules.
            {skill.data?.isCustom ? " You've customized it." : " This is the shipped default."}
          </p>
        </div>
        <button type="button" className="ghostbtn" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? "Hide" : "View & edit"}
        </button>
      </div>
      {open && (
        <div className="breve-skill-editor">
          <textarea
            rows={18}
            spellCheck={false}
            value={text}
            onChange={(e) => setDraft(e.target.value)}
            aria-label="Brief instructions"
          />
          <div className="breve-add-actions">
            <SaveNote state={saveState} error={error} dirty={dirty} />
            {skill.data?.isCustom && (
              <button type="button" className="ghostbtn quiet" onClick={() => void commit(null)}>
                Reset to default
              </button>
            )}
            <button
              type="button"
              className="ghostbtn primary"
              disabled={!dirty || saveState === "saving"}
              onClick={() => void commit(text)}
            >
              {saveState === "saving" ? "Saving…" : "Save instructions"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

type DetectMap = Partial<
  Record<ProviderId, { installed: boolean; authenticated: boolean; version: string | null }>
>;

/** A merged-Settings group heading — the former standalone page titles demoted
 * to quiet section anchors inside the one Settings home. */
function SettingsGroupHead({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="breve-settings-group">
      <h2>{title}</h2>
      <p>{detail}</p>
    </div>
  );
}

function ModelsView({ snapshot, embedded = false }: { snapshot: BreveSnapshot; embedded?: boolean }) {
  const queryClient = useQueryClient();
  const aiProviders = useUiStore((s) => s.aiProviders);
  const blockedModels = useUiStore((s) => s.blockedModels);
  const [config, setConfig] = useState(snapshot.config);
  const [base, setBase] = useState(snapshot.config);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [error, setError] = useState("");
  // per-side memo, not per render (perf audit 2026-07-30, finding 24)
  const policyJson = useMemo(() => JSON.stringify(config.modelPolicy), [config.modelPolicy]);
  const basePolicyJson = useMemo(() => JSON.stringify(base.modelPolicy), [base.modelPolicy]);
  const dirty = policyJson !== basePolicyJson;
  const duplicateFallback =
    new Set(config.modelPolicy.fallbacks).size !== config.modelPolicy.fallbacks.length;
  const modelValidation = config.modelPolicy.fallbacks.includes(config.modelPolicy.primary)
    ? "The primary writer cannot also be a fallback."
    : duplicateFallback
      ? "Each fallback model can appear only once."
      : "";
  useBreveDraftGuard(dirty);

  useEffect(() => {
    if (dirty) return;
    setConfig(snapshot.config);
    setBase(snapshot.config);
  }, [dirty, snapshot.config]);
  useEffect(() => {
    if (dirty && saveState === "saved") setSaveState("idle");
  }, [dirty, saveState]);

  const local = useQuery({
    queryKey: ["chat", "models"],
    queryFn: () => (isTauri() ? chatModels() : Promise.resolve([] as ChatModelInfo[])),
    staleTime: 60_000,
  });
  const detects = useQuery({
    queryKey: ["breve", "model-connections"],
    queryFn: async (): Promise<DetectMap> => {
      if (!isTauri()) return {};
      const pairs = await Promise.all(
        PROVIDER_IDS.map(async (id) => {
          try {
            return [id, await cliDetect(id)] as const;
          } catch {
            return [id, { installed: false, authenticated: false, version: null }] as const;
          }
        }),
      );
      return Object.fromEntries(pairs) as DetectMap;
    },
    staleTime: 30_000,
  });

  const connected = PROVIDER_IDS.flatMap((id) => {
    const ready = detects.data?.[id];
    // Breve may use any authenticated connection even when that lane is hidden
    // from the general chat picker. The per-model blocklist still wins.
    if (!ready?.installed || !ready.authenticated) return [];
    return CLI_CATALOG[id].filter((model) => !blockedModels.includes(model.id));
  });
  const allModels = [...(local.data ?? []), ...connected];
  const catalogModels = PROVIDER_IDS.flatMap((id) => CLI_CATALOG[id]);
  const options = modelPolicyOptions(
    config,
    allModels.map((model) => model.id),
  );
  const labelFor = (id: string) =>
    allModels.find((model) => model.id === id)?.label ??
    catalogModels.find((model) => model.id === id)?.label ??
    id.replace(/-(it-qat|instruct)-4bit$/i, "");

  const save = async () => {
    if (modelValidation) return;
    setSaveState("saving");
    setError("");
    try {
      // write only THIS form's slice over the freshest config — the co-mounted
      // Delivery form may have saved since this one went dirty, and writing the
      // whole stale copy would revert its work (adversarial review, HIGH)
      const next = await breveWriteConfig({ ...snapshot.config, modelPolicy: config.modelPolicy });
      queryClient.setQueryData(BREVE_QUERY_KEY, next);
      setBase(next.config);
      setSaveState("saved");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaveState("error");
    }
  };

  const moveFallback = (index: number, delta: -1 | 1) => {
    const list = [...config.modelPolicy.fallbacks];
    const target = index + delta;
    if (target < 0 || target >= list.length) return;
    [list[index], list[target]] = [list[target]!, list[index]!];
    setConfig({ ...config, modelPolicy: { ...config.modelPolicy, fallbacks: list } });
  };

  return (
    <div className={embedded ? "breve-embed" : "breve-page"}>
      {embedded ? (
        <SettingsGroupHead
          title="Models"
          detail="Choose the writer, ordered fallbacks, and the local helper used by briefs."
        />
      ) : (
        <PageHead
          title="Models"
          detail="Choose the writer, ordered fallbacks, and the local helper used by briefs."
        />
      )}
      <div className="breve-config-toolbar">
        <span className="breve-toolbar-grow" />
        <SaveNote state={saveState} error={error} dirty={dirty} />
        <button
          type="button"
          className="ghostbtn primary"
          disabled={!dirty || !!modelValidation || saveState === "saving"}
          onClick={() => void save()}
        >
          {saveState === "saving" ? "Saving…" : "Save model policy"}
        </button>
      </div>
      {modelValidation && (
        <p id="breve-model-validation" className="breve-watch-validation" role="alert">
          {modelValidation}
        </p>
      )}

      <section className="breve-section" aria-labelledby="breve-policy-title">
        <div className="breve-section-head copy">
          <div>
            <h3 id="breve-policy-title">Brief policy</h3>
            <p>
              Authenticated models stay available to Breve even when hidden from Chat. Individually blocked
              models remain excluded.
            </p>
          </div>
        </div>
        <div className="breve-policy-grid">
          <label>
            <span>Primary writer</span>
            <select
              value={config.modelPolicy.primary}
              onChange={(e) =>
                setConfig({
                  ...config,
                  briefModel: e.target.value,
                  modelPolicy: { ...config.modelPolicy, primary: e.target.value },
                })
              }
            >
              {options.map((id) => (
                <option key={id} value={id}>
                  {labelFor(id)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Local helper</span>
            <select
              value={config.modelPolicy.localHelper ?? ""}
              onChange={(e) =>
                setConfig({
                  ...config,
                  modelPolicy: { ...config.modelPolicy, localHelper: e.target.value || null },
                })
              }
            >
              <option value="">None</option>
              {(local.data ?? []).map((model) => (
                <option key={model.id} value={model.id}>
                  {model.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="breve-fallbacks">
          <div className="breve-section-head">
            <h4>Fallback order</h4>
          </div>
          {config.modelPolicy.fallbacks.map((id, index) => (
            <div className="breve-fallback-row" key={`${id}-${index}`}>
              <span>{index + 1}</span>
              <select
                value={id}
                aria-label={`Fallback model ${index + 1}`}
                aria-invalid={!!modelValidation}
                aria-describedby={modelValidation ? "breve-model-validation" : undefined}
                onChange={(e) => {
                  const list = [...config.modelPolicy.fallbacks];
                  list[index] = e.target.value;
                  setConfig({ ...config, modelPolicy: { ...config.modelPolicy, fallbacks: list } });
                }}
              >
                {options
                  .filter(
                    (option) =>
                      option === id ||
                      (option !== config.modelPolicy.primary &&
                        !config.modelPolicy.fallbacks.some(
                          (fallback, fallbackIndex) => fallbackIndex !== index && fallback === option,
                        )),
                  )
                  .map((option) => (
                    <option key={option} value={option}>
                      {labelFor(option)}
                    </option>
                  ))}
              </select>
              <button
                type="button"
                className="breve-icon-action"
                aria-label={`Move ${labelFor(id)} earlier`}
                disabled={index === 0}
                onClick={() => moveFallback(index, -1)}
              >
                <ChevronRight size={12} className="up" />
              </button>
              <button
                type="button"
                className="breve-icon-action"
                aria-label={`Move ${labelFor(id)} later`}
                disabled={index === config.modelPolicy.fallbacks.length - 1}
                onClick={() => moveFallback(index, 1)}
              >
                <ChevronRight size={12} className="down" />
              </button>
              <button
                type="button"
                className="breve-icon-action"
                aria-label={`Remove ${labelFor(id)}`}
                onClick={() =>
                  setConfig({
                    ...config,
                    modelPolicy: {
                      ...config.modelPolicy,
                      fallbacks: config.modelPolicy.fallbacks.filter((_, i) => i !== index),
                    },
                  })
                }
              >
                <XGlyph size={12} />
              </button>
            </div>
          ))}
          <select
            className="breve-add-fallback"
            aria-label="Add a fallback model"
            value=""
            onChange={(e) => {
              if (!e.target.value || config.modelPolicy.fallbacks.includes(e.target.value)) return;
              setConfig({
                ...config,
                modelPolicy: {
                  ...config.modelPolicy,
                  fallbacks: [...config.modelPolicy.fallbacks, e.target.value],
                },
              });
            }}
          >
            <option value="">Add fallback…</option>
            {options
              .filter((id) => id !== config.modelPolicy.primary && !config.modelPolicy.fallbacks.includes(id))
              .map((id) => (
                <option key={id} value={id}>
                  {labelFor(id)}
                </option>
              ))}
          </select>
        </div>
      </section>

      <section className="breve-section" aria-labelledby="breve-connections-title">
        <div className="breve-section-head copy">
          <div>
            <h3 id="breve-connections-title">Connections</h3>
            <p>Breve checks model access on this Mac without changing your Chat picker.</p>
          </div>
          {(local.isError || detects.isError) && (
            <button
              type="button"
              className="ghostbtn"
              onClick={() => {
                void local.refetch();
                void detects.refetch();
              }}
            >
              Check again
            </button>
          )}
        </div>
        <div className="breve-connection-list" aria-busy={local.isLoading || detects.isLoading}>
          <div className="breve-connection-row">
            <span>On this Mac</span>
            <span>
              {local.isLoading
                ? "Checking…"
                : local.isError
                  ? "Check failed"
                  : `${local.data?.length ?? 0} models`}
            </span>
            <strong>
              {local.isLoading
                ? "Checking"
                : local.isError
                  ? "Needs attention"
                  : (local.data?.length ?? 0) > 0
                    ? "Ready"
                    : "Unavailable"}
            </strong>
          </div>
          {PROVIDER_IDS.map((id) => {
            const detected = detects.data?.[id];
            const status =
              detects.isLoading && !detected
                ? "Checking"
                : !detected?.installed
                  ? "Not installed"
                  : !detected.authenticated
                    ? "Sign in required"
                    : aiProviders[id]
                      ? "Ready"
                      : "Ready for Breve";
            return (
              <div className="breve-connection-row" key={id}>
                <span>{PROVIDER_LABELS[id]}</span>
                <span>{detected?.version ?? ""}</span>
                <strong>{status}</strong>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

type DeliveryTest = { target: "email" | "signal"; state: SaveState; message: string } | null;

const PDF_THEME_OPTIONS: Array<{ value: BrevePdfThemePreset; label: string; detail: string }> = [
  { value: "charcoal", label: "Charcoal", detail: "Breve’s original dark editorial palette" },
  { value: "warmLight", label: "Warm Light", detail: "Rotli linen, cocoa, and clay" },
  { value: "warmDark", label: "Warm Dark", detail: "Rotli cocoa with clay accents" },
  { value: "paper", label: "Paper", detail: "Neutral white with crisp dark type" },
  { value: "custom", label: "Custom", detail: "Choose every PDF color" },
];

const PDF_COLOR_FIELDS: Array<{ key: keyof BrevePdfPalette; label: string }> = [
  { key: "background", label: "Page" },
  { key: "surface", label: "Panels" },
  { key: "text", label: "Text" },
  { key: "muted", label: "Secondary text" },
  { key: "accent", label: "Accent and links" },
  { key: "rule", label: "Rules" },
];

function resolvedPdfPalette(theme: BrevePdfTheme): BrevePdfPalette {
  return theme.preset === "custom" ? theme.custom : { ...BREVE_PDF_PRESETS[theme.preset] };
}

function pdfThemeValidation(theme: BrevePdfTheme): string {
  return validateBrevePdfPalette(resolvedPdfPalette(theme));
}

function PdfThemeEditor({
  theme,
  onChange,
}: {
  theme: BrevePdfTheme;
  onChange: (theme: BrevePdfTheme) => void;
}) {
  const palette = resolvedPdfPalette(theme);
  const validation = pdfThemeValidation(theme);
  const style = {
    "--pdf-preview-bg": palette.background,
    "--pdf-preview-surface": palette.surface,
    "--pdf-preview-text": palette.text,
    "--pdf-preview-muted": palette.muted,
    "--pdf-preview-accent": palette.accent,
    "--pdf-preview-rule": palette.rule,
  } as CSSProperties;
  return (
    <section className="breve-delivery-section breve-pdf-section" aria-labelledby="breve-pdf-theme-title">
      <div className="breve-delivery-head">
        <div>
          <h3 id="breve-pdf-theme-title">PDF appearance</h3>
          <p>New scheduled and on-demand PDFs use this palette. Existing files keep their original colors.</p>
        </div>
      </div>
      <div className="breve-pdf-layout">
        <div className="breve-pdf-controls">
          <label className="breve-field" htmlFor="breve-pdf-theme">
            <span>Theme</span>
            <select
              id="breve-pdf-theme"
              value={theme.preset}
              aria-describedby="breve-pdf-theme-help"
              onChange={(event) => onChange({ ...theme, preset: event.target.value as BrevePdfThemePreset })}
            >
              {PDF_THEME_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <small id="breve-pdf-theme-help">
              {PDF_THEME_OPTIONS.find((option) => option.value === theme.preset)?.detail}
            </small>
          </label>
          {theme.preset === "custom" && (
            <div className="breve-color-grid" aria-label="Custom PDF colors">
              {PDF_COLOR_FIELDS.map(({ key, label }) => (
                <label key={key} className="breve-color-field">
                  <span>{label}</span>
                  <span className="breve-color-control">
                    <input
                      type="color"
                      value={theme.custom[key]}
                      aria-label={`${label} color`}
                      onChange={(event) =>
                        onChange({ ...theme, custom: { ...theme.custom, [key]: event.target.value } })
                      }
                    />
                    <code>{theme.custom[key].toUpperCase()}</code>
                  </span>
                </label>
              ))}
            </div>
          )}
          {validation && (
            <p id="breve-pdf-theme-error" className="breve-field-error" role="alert">
              {validation}
            </p>
          )}
        </div>
        <div
          className="breve-pdf-preview"
          style={style}
          aria-label={`${PDF_THEME_OPTIONS.find((option) => option.value === theme.preset)?.label} PDF preview`}
        >
          <span className="breve-pdf-preview-kicker">Your personal wire</span>
          <strong>BREVE</strong>
          <span className="breve-pdf-preview-date">Morning · Friday</span>
          <div>
            <b>Today’s signal</b>
            <p>A quiet preview of headings, reading text, links, and section rules.</p>
            <span className="breve-pdf-preview-link">Read source</span>
          </div>
        </div>
      </div>
    </section>
  );
}

function DeliveryStatus({ ready, children }: { ready: boolean; children: string }) {
  return (
    <span className={ready ? "breve-delivery-status ready" : "breve-delivery-status"}>
      <span aria-hidden="true" />
      {children}
    </span>
  );
}

function ConfigureView({ snapshot, embedded = false }: { snapshot: BreveSnapshot; embedded?: boolean }) {
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({
    queryKey: ["breve", "delivery-settings"],
    queryFn: breveDeliverySettings,
  });
  const [draft, setDraft] = useState<BreveDeliverySettings | null>(null);
  const [base, setBase] = useState<BreveDeliverySettings | null>(null);
  const [config, setConfig] = useState(snapshot.config);
  const [configBase, setConfigBase] = useState(snapshot.config);
  const [apiKey, setApiKey] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [error, setError] = useState("");
  const [test, setTest] = useState<DeliveryTest>(null);
  const [removeKeyArmed, setRemoveKeyArmed] = useState(false);

  // four stringifies per keystroke across two drafts — memo per side
  // (perf audit 2026-07-30, finding 24)
  const draftJson = useMemo(() => JSON.stringify(draft), [draft]);
  const baseJson = useMemo(() => JSON.stringify(base), [base]);
  const themeJson = useMemo(() => JSON.stringify(config.pdfTheme), [config.pdfTheme]);
  const baseThemeJson = useMemo(() => JSON.stringify(configBase.pdfTheme), [configBase.pdfTheme]);
  const deliveryDirty = !!draft && !!base && (draftJson !== baseJson || !!apiKey.trim());
  const configDirty = themeJson !== baseThemeJson;
  const dirty = deliveryDirty || configDirty;
  const themeValidation = pdfThemeValidation(config.pdfTheme);
  useBreveDraftGuard(dirty);

  useEffect(() => {
    if (!settingsQuery.data || deliveryDirty) return;
    setDraft(settingsQuery.data);
    setBase(settingsQuery.data);
  }, [deliveryDirty, settingsQuery.data]);
  useEffect(() => {
    if (configDirty) return;
    setConfig(snapshot.config);
    setConfigBase(snapshot.config);
  }, [configDirty, snapshot.config]);
  useEffect(() => {
    if (dirty && saveState === "saved") setSaveState("idle");
  }, [dirty, saveState]);

  const recipients = draft?.emailTo.join("\n") ?? "";
  const invalidRecipient = draft?.emailTo.find((value) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value));
  const invalidSignal = [draft?.signalBot, draft?.signalOwner].find(
    (value) => !!value && !/^\+[1-9]\d{7,14}$/.test(value),
  );
  const deliveryValidation = invalidRecipient
    ? `“${invalidRecipient}” is not a valid email address.`
    : invalidSignal
      ? "Signal numbers must use international format, such as +14075551234."
      : "";
  const emailReady =
    !!draft?.resendKeyConfigured && !!draft.emailFrom && draft.emailTo.length > 0 && !invalidRecipient;
  const signalReady = !!draft?.signalBot && !!draft.signalOwner && !invalidSignal;

  const save = async () => {
    if (!draft || themeValidation || deliveryValidation) return;
    setSaveState("saving");
    setError("");
    try {
      if (configDirty) {
        // slice-write, same reasoning as the Models save: never clobber the
        // co-mounted Models form's saved policy with a stale full config
        const nextSnapshot = await breveWriteConfig({ ...snapshot.config, pdfTheme: config.pdfTheme });
        setConfig(nextSnapshot.config);
        setConfigBase(nextSnapshot.config);
        queryClient.setQueryData(BREVE_QUERY_KEY, nextSnapshot);
      }
      const hasNewKey = !!apiKey.trim();
      if (deliveryDirty) {
        if (hasNewKey) await breveStoreResendKey(apiKey.trim());
        const next = await breveWriteDeliverySettings({
          ...draft,
          resendKeyConfigured: draft.resendKeyConfigured || hasNewKey,
        });
        setDraft(next);
        setBase(next);
        setApiKey("");
        queryClient.setQueryData(["breve", "delivery-settings"], next);
      }
      setSaveState("saved");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaveState("error");
    }
  };

  const removeKey = async () => {
    if (!draft) return;
    setSaveState("saving");
    setError("");
    try {
      await breveRemoveResendKey();
      const next = await breveWriteDeliverySettings({ ...draft, resendKeyConfigured: false });
      setDraft(next);
      setBase(next);
      setApiKey("");
      setRemoveKeyArmed(false);
      setSaveState("saved");
      queryClient.setQueryData(["breve", "delivery-settings"], next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaveState("error");
    }
  };

  const runTest = async (target: "email" | "signal") => {
    setTest({
      target,
      state: "saving",
      message: target === "email" ? "Sending test email…" : "Sending test Signal…",
    });
    try {
      const message = await (target === "email" ? breveTestEmail() : breveTestSignal());
      setTest({ target, state: "saved", message });
    } catch (e) {
      setTest({ target, state: "error", message: e instanceof Error ? e.message : String(e) });
    }
  };

  const deliveryHead = embedded ? (
    <SettingsGroupHead
      title="Delivery & appearance"
      detail="Where Breve sends email and Signal messages, and how the PDF edition looks."
    />
  ) : (
    <PageHead
      title="Configure"
      detail="Choose how Breve looks and where it sends email and Signal messages."
    />
  );

  if (settingsQuery.isError) {
    return (
      <div className={embedded ? "breve-embed" : "breve-page"}>
        {deliveryHead}
        <EmptyMessage
          title="Delivery settings could not be loaded."
          detail="Your saved configuration was not changed. Try reading the snapshot again."
          action={
            <button type="button" className="ghostbtn" onClick={() => void settingsQuery.refetch()}>
              Try again
            </button>
          }
        />
      </div>
    );
  }
  if (settingsQuery.isLoading || !draft) {
    return (
      <div className={embedded ? "breve-embed" : "breve-page"}>
        {deliveryHead}
        <BreveSkeleton label="Loading delivery settings" />
      </div>
    );
  }

  return (
    <div className={embedded ? "breve-embed" : "breve-page"}>
      {deliveryHead}

      <div className="breve-config-savebar">
        <p>
          {import.meta.env.DEV
            ? "Loaded from your current setup. Changes made in dev stay temporary."
            : "Changes apply to the Rotli-managed scheduler after you save."}
        </p>
        <span className="breve-toolbar-grow" />
        <SaveNote state={saveState} error={error} dirty={dirty} />
        <button
          type="button"
          className="ghostbtn primary"
          disabled={!dirty || !!themeValidation || !!deliveryValidation || saveState === "saving"}
          onClick={() => void save()}
        >
          {saveState === "saving" ? "Saving…" : "Save configuration"}
        </button>
      </div>
      {deliveryValidation && (
        <p id="breve-delivery-validation" className="breve-watch-validation" role="alert">
          {deliveryValidation}
        </p>
      )}

      <aside className="breve-keychain-note" aria-label="Credential storage">
        <LockGlyph size={14} />
        <div>
          <strong>Secrets are saved in your Mac Keychain.</strong>
          <span>
            Rotli never displays your Resend API key. Delivery addresses and Signal routing stay in
            Rotli&rsquo;s managed Breve configuration.
          </span>
        </div>
      </aside>

      <PdfThemeEditor
        theme={config.pdfTheme}
        onChange={(pdfTheme) => {
          setConfig({ ...config, pdfTheme });
          setSaveState("idle");
        }}
      />

      <section className="breve-delivery-section" aria-labelledby="breve-email-config-title">
        <div className="breve-delivery-head">
          <div>
            <h3 id="breve-email-config-title">Email delivery</h3>
            <p>Breve sends scheduled briefs through Resend.</p>
          </div>
          <DeliveryStatus ready={emailReady}>{emailReady ? "Ready" : "Needs setup"}</DeliveryStatus>
        </div>
        <div className="breve-form-grid">
          <label className="breve-field wide" htmlFor="breve-resend-key">
            <span>Resend API key</span>
            <input
              id="breve-resend-key"
              type="password"
              autoComplete="off"
              value={apiKey}
              placeholder={
                draft.resendKeyConfigured ? "Saved in Keychain — enter a new key to replace it" : "re_…"
              }
              onChange={(event) => {
                setApiKey(event.target.value);
                setSaveState("idle");
              }}
              onKeyDown={(event) => event.stopPropagation()}
            />
            <small>The key is write-only. Rotli can check whether it exists but never displays it.</small>
          </label>
          <label className="breve-field" htmlFor="breve-email-from">
            <span>From</span>
            <input
              id="breve-email-from"
              value={draft.emailFrom}
              placeholder="Breve <briefs@yourdomain.com>"
              onChange={(event) => {
                setDraft({ ...draft, emailFrom: event.target.value });
                setSaveState("idle");
              }}
              onKeyDown={(event) => event.stopPropagation()}
            />
            <small>Must be a sender verified in your Resend account.</small>
          </label>
          <label className="breve-field" htmlFor="breve-email-to">
            <span>Recipients</span>
            <textarea
              id="breve-email-to"
              rows={3}
              value={recipients}
              aria-invalid={!!invalidRecipient}
              aria-describedby={invalidRecipient ? "breve-delivery-validation" : undefined}
              placeholder="you@example.com"
              onChange={(event) => {
                setDraft({
                  ...draft,
                  emailTo: event.target.value
                    .split(/[\n,]/)
                    .map((value) => value.trim())
                    .filter(Boolean),
                });
                setSaveState("idle");
              }}
              onKeyDown={(event) => event.stopPropagation()}
            />
            <small>One address per line. These receive scheduled briefs.</small>
          </label>
        </div>
        <div className="breve-delivery-actions">
          <button
            type="button"
            className="ghostbtn"
            title={dirty ? "Save your changes before sending a test" : undefined}
            disabled={!emailReady || dirty || test?.state === "saving"}
            onClick={() => void runTest("email")}
          >
            Send test email
          </button>
          {draft.resendKeyConfigured &&
            (removeKeyArmed ? (
              <span
                className="breve-confirm-actions inline"
                role="group"
                aria-label="Confirm API key removal"
              >
                <button type="button" className="ghostbtn" onClick={() => setRemoveKeyArmed(false)}>
                  Keep key
                </button>
                <button
                  type="button"
                  className="ghostbtn quiet"
                  disabled={saveState === "saving"}
                  onClick={() => void removeKey()}
                >
                  Confirm removal
                </button>
              </span>
            ) : (
              <button
                type="button"
                className="ghostbtn quiet"
                disabled={saveState === "saving"}
                onClick={() => setRemoveKeyArmed(true)}
              >
                Remove API key
              </button>
            ))}
          {test?.target === "email" && (
            <span
              className={test.state === "error" ? "breve-save-note err" : "breve-save-note"}
              role={test.state === "error" ? "alert" : "status"}
            >
              {test.message}
            </span>
          )}
        </div>
      </section>

      <section className="breve-delivery-section" aria-labelledby="breve-signal-config-title">
        <div className="breve-delivery-head">
          <div>
            <h3 id="breve-signal-config-title">Signal delivery</h3>
            <p>The bot number sends briefs only to the owner allowlist number.</p>
          </div>
          <DeliveryStatus ready={signalReady}>{signalReady ? "Ready" : "Needs setup"}</DeliveryStatus>
        </div>
        <div className="breve-form-grid">
          <label className="breve-field" htmlFor="breve-signal-bot">
            <span>Bot number</span>
            <input
              id="breve-signal-bot"
              inputMode="tel"
              value={draft.signalBot}
              aria-invalid={!!draft.signalBot && !/^\+[1-9]\d{7,14}$/.test(draft.signalBot)}
              aria-describedby={invalidSignal ? "breve-delivery-validation" : undefined}
              placeholder="+14075551234"
              onChange={(event) => {
                setDraft({ ...draft, signalBot: event.target.value });
                setSaveState("idle");
              }}
              onKeyDown={(event) => event.stopPropagation()}
            />
            <small>The sending number connected to Signal on this Mac.</small>
          </label>
          <label className="breve-field" htmlFor="breve-signal-owner">
            <span>Owner number</span>
            <input
              id="breve-signal-owner"
              inputMode="tel"
              value={draft.signalOwner}
              aria-invalid={!!draft.signalOwner && !/^\+[1-9]\d{7,14}$/.test(draft.signalOwner)}
              aria-describedby={invalidSignal ? "breve-delivery-validation" : undefined}
              placeholder="+14075551234"
              onChange={(event) => {
                setDraft({ ...draft, signalOwner: event.target.value });
                setSaveState("idle");
              }}
              onKeyDown={(event) => event.stopPropagation()}
            />
            <small>Only this number can use the Breve assistant.</small>
          </label>
          <label className="breve-field wide" htmlFor="breve-signal-owner-uuid">
            <span>
              Owner UUID <em>optional</em>
            </span>
            <input
              id="breve-signal-owner-uuid"
              value={draft.signalOwnerUuid}
              placeholder="Signal account UUID"
              onChange={(event) => {
                setDraft({ ...draft, signalOwnerUuid: event.target.value });
                setSaveState("idle");
              }}
              onKeyDown={(event) => event.stopPropagation()}
            />
            <small>Add this if Signal resolves the owner by UUID instead of phone number.</small>
          </label>
        </div>
        <div className="breve-delivery-actions">
          <button
            type="button"
            className="ghostbtn"
            title={dirty ? "Save your changes before sending a test" : undefined}
            disabled={!signalReady || dirty || test?.state === "saving"}
            onClick={() => void runTest("signal")}
          >
            Send test Signal
          </button>
          {test?.target === "signal" && (
            <span
              className={test.state === "error" ? "breve-save-note err" : "breve-save-note"}
              role={test.state === "error" ? "alert" : "status"}
            >
              {test.message}
            </span>
          )}
        </div>
      </section>
    </div>
  );
}

/** One Settings home (2026-07-30 rework): the legacy migration ladder, then
 * the former Models and Configure pages as quiet groups. */
function SettingsView({ snapshot }: { snapshot: BreveSnapshot }) {
  return (
    <div className="breve-page">
      <PageHead
        title="Settings"
        detail="Models, delivery, appearance, and the legacy migration — one home."
      />
      {(snapshot.source !== "rotli" || snapshot.legacyRoot) && <SourceStrip snapshot={snapshot} />}
      <MigrationBands snapshot={snapshot} />
      <ModelsView snapshot={snapshot} embedded />
      <ConfigureView snapshot={snapshot} embedded />
    </div>
  );
}

export function BreveSurface() {
  const view = useUiStore((s) => s.breveView);
  const query = useBreveSnapshot();
  const snapshot = query.data ?? EMPTY_BREVE_SNAPSHOT;

  if (query.isLoading) {
    return (
      <main className="breve-surface" aria-label="Breve">
        <div className="breve-page">
          <BreveSkeleton label="Loading Breve" />
        </div>
      </main>
    );
  }
  if (query.isError) {
    return (
      <main className="breve-surface" aria-label="Breve">
        <div className="breve-page">
          <EmptyMessage
            title="Breve could not be loaded."
            detail="Your Rotli data was not changed."
            action={
              <button type="button" className="ghostbtn" onClick={() => void query.refetch()}>
                Try again
              </button>
            }
          />
        </div>
      </main>
    );
  }

  return (
    <main className="breve-surface" aria-label={`Breve ${view}`}>
      {view === "briefs" && <BriefsView snapshot={snapshot} />}
      {view === "routines" && <RoutinesView snapshot={snapshot} />}
      {view === "watchlist" && <WatchlistView snapshot={snapshot} />}
      {view === "settings" && <SettingsView snapshot={snapshot} />}
    </main>
  );
}
