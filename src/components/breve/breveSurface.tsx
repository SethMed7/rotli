import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
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
  breveTestEmail,
  breveTestSignal,
  breveWriteDeliverySettings,
  breveWriteConfig,
  breveWriteWatchlist,
  chatModels,
  cliDetect,
  isTauri,
  openUrl,
  type BreveDeliverySettings,
  type BrevePdfPalette,
  type BrevePdfTheme,
  type BrevePdfThemePreset,
} from "../../lib/tauri";
import { BREVE_PDF_PRESETS, validateBrevePdfPalette } from "../../brand/brevePdfThemes";
import {
  CLI_CATALOG,
  PROVIDER_IDS,
  PROVIDER_LABELS,
  type ProviderId,
} from "../../ai/models";
import {
  parseWatchlist,
  serializeWatchlist,
  legacyWatchUrl,
  type WatchItem,
  type WatchSection,
} from "../../routines/watchlist";
import { useUiStore } from "../../state/ui";
import { usePanesStore } from "../../state/panes";
import { CheckGlyph, ChevronRight, ClockGlyph, ExternalLinkGlyph, LockGlyph, PlusGlyph, SearchGlyph, XGlyph } from "../glyphs";
import {
  EMPTY_BREVE_SNAPSHOT,
  formatNextRoutine,
  modelPolicyOptions,
  nextRoutineEpoch,
  sortBriefs,
} from "../../routines/briefs";
import { BREVE_QUERY_KEY, useBreveSnapshot } from "./useBreve";

type SaveState = "idle" | "saving" | "saved" | "error";

function PageHead({ title, detail }: { title: string; detail: string }) {
  return (
    <header className="breve-page-head">
      <hgroup>
        <h2>{title}</h2>
        <p>{detail}</p>
      </hgroup>
    </header>
  );
}

function SaveNote({ state, error, dirty = false }: { state: SaveState; error?: string; dirty?: boolean }) {
  if (state === "idle" && !dirty) return null;
  const message = state === "saving"
    ? "Saving…"
    : state === "saved"
      ? "Saved"
      : state === "error"
        ? error || "Could not save"
        : "Unsaved changes";
  return (
    <span
      className={state === "error" ? "breve-save-note err" : "breve-save-note"}
      role={state === "error" ? "alert" : "status"}
      aria-live={state === "error" ? "assertive" : "polite"}
    >
      {state === "saved" && <CheckGlyph size={12} />}
      {message}
    </span>
  );
}

function useBreveDraftGuard(dirty: boolean) {
  const setBreveDirty = useUiStore((state) => state.setBreveDirty);
  useEffect(() => {
    setBreveDirty(dirty);
    return () => setBreveDirty(false);
  }, [dirty, setBreveDirty]);
}

function EmptyMessage({
  title,
  detail,
  action,
}: {
  title: string;
  detail: string;
  action?: ReactNode;
}) {
  return (
    <div className="breve-empty-state">
      <strong>{title}</strong>
      <p>{detail}</p>
      {action}
    </div>
  );
}

function BreveSkeleton({ label }: { label: string }) {
  return (
    <div className="breve-skeleton" role="status" aria-label={label} aria-busy="true">
      <span className="breve-skeleton-title" />
      <span className="breve-skeleton-copy" />
      <span className="breve-skeleton-band" />
      <span className="breve-skeleton-row" />
      <span className="breve-skeleton-row short" />
    </div>
  );
}

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

function BriefsView({ snapshot }: { snapshot: BreveSnapshot }) {
  const queryClient = useQueryClient();
  const openNote = usePanesStore((s) => s.openNote);
  const setSidebarMode = useUiStore((s) => s.setSidebarMode);
  const setView = useUiStore((s) => s.setBreveView);
  const [importState, setImportState] = useState<SaveState>("idle");
  const [takeoverState, setTakeoverState] = useState<SaveState>("idle");
  const [retireState, setRetireState] = useState<SaveState>("idle");
  const [retireArmed, setRetireArmed] = useState(false);
  const [error, setError] = useState("");
  const [briefQuery, setBriefQuery] = useState("");
  const [briefKind, setBriefKind] = useState<"all" | "morning" | "lunch" | "night">("all");
  const briefs = useMemo(() => sortBriefs(snapshot.briefs), [snapshot.briefs]);
  const normalizedBriefQuery = briefQuery.trim().toLowerCase();
  const visibleBriefs = briefs.filter((brief) =>
    (briefKind === "all" || brief.kind === briefKind) &&
    (!normalizedBriefQuery || `${brief.title} ${brief.date} ${brief.kind}`.toLowerCase().includes(normalizedBriefQuery)),
  );
  const now = Date.now();
  const nextBriefRoutine = snapshot.config.routines
    .filter((routine) => routine.enabled && routine.kind === "brief")
    .map((routine) => ({ routine, epoch: nextRoutineEpoch(routine, now, snapshot.config.timezone) }))
    .filter((entry): entry is { routine: BreveRoutine; epoch: number } => entry.epoch !== null)
    .sort((a, b) => a.epoch - b.epoch)[0]?.routine;
  const deliveryLanes = [...new Set(
    snapshot.config.routines
      .filter((routine) => routine.enabled && routine.kind === "brief")
      .flatMap((routine) => routine.lanes),
  )].map((lane) => lane === "inApp" ? "Rotli" : lane.charAt(0).toUpperCase() + lane.slice(1));

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
    <div className="breve-page">
      <PageHead title="Briefs" detail="Morning, lunch, and night briefings in one searchable library." />
      {(snapshot.source !== "rotli" || snapshot.legacyRoot) && <SourceStrip snapshot={snapshot} />}

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
              Copies private runtime state, disables Breve&rsquo;s seven legacy launchd jobs,
              and starts the Rotli-managed scheduler. The legacy folder is kept as a backup.
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
            {retireArmed ? <>
              <button type="button" className="ghostbtn" onClick={() => setRetireArmed(false)}>Keep project</button>
              <button
                type="button"
                className="ghostbtn primary"
                disabled={retireState === "saving"}
                onClick={() => void retireLegacy()}
              >
                {retireState === "saving" ? "Verifying…" : "Confirm move to Trash"}
              </button>
            </> : (
              <button type="button" className="ghostbtn quiet" onClick={() => setRetireArmed(true)}>
                Review retirement
              </button>
            )}
          </div>
          <SaveNote state={retireState} error={error} />
        </section>
      )}

      <section className="breve-brief-overview" aria-label="Breve readiness">
        <div className="breve-next-brief">
          <span>Next scheduled run</span>
          <strong>{nextBriefRoutine?.label ?? "No brief is scheduled"}</strong>
          <p>{nextBriefRoutine
            ? formatNextRoutine(nextBriefRoutine, now, snapshot.config.timezone)
            : "Turn on a briefing routine to resume delivery."}</p>
          <button type="button" className="ghostbtn" onClick={() => setView("routines")}>Adjust schedule</button>
        </div>
        <dl className="breve-readiness-list">
          <div>
            <dt>Watchlist</dt>
            <dd>{snapshot.counts.topics
              ? `${snapshot.counts.topics} topics in ${snapshot.counts.sections} groups`
              : "No topics yet"}</dd>
            <button type="button" onClick={() => setView("watchlist")}>{snapshot.counts.topics ? "Review" : "Add topics"}</button>
          </div>
          <div>
            <dt>Delivery</dt>
            <dd>{deliveryLanes.length ? deliveryLanes.join(" · ") : "No delivery lanes enabled"}</dd>
            <button type="button" onClick={() => setView("configure")}>Configure</button>
          </div>
          <div>
            <dt>Latest brief</dt>
            <dd>{briefs[0] ? briefs[0].title : "Nothing generated yet"}</dd>
            {briefs[0]?.path
              ? <button type="button" onClick={() => { setSidebarMode("notes"); openNote(briefs[0]!.path!); }}>Open</button>
              : <span>{briefs.length ? (import.meta.env.DEV ? "Read-only snapshot" : "Stored outside Rotli") : "Waiting"}</span>}
          </div>
        </dl>
      </section>

      <section className="breve-section breve-library-section" aria-labelledby="breve-recent-title">
        <div className="breve-section-head copy">
          <div>
            <h3 id="breve-recent-title">Brief library</h3>
            <p>Find a past briefing by title, date, or delivery period.</p>
          </div>
          {snapshot.imported && <span className="breve-inline-status"><CheckGlyph size={12} /> In Rotli</span>}
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
              <select value={briefKind} onChange={(event) => setBriefKind(event.target.value as typeof briefKind)}>
                <option value="all">All periods</option>
                <option value="morning">Morning</option>
                <option value="lunch">Lunch</option>
                <option value="night">Night</option>
              </select>
            </label>
            <span className="breve-watch-count">{visibleBriefs.length} of {briefs.length}</span>
          </div>
        )}
        {briefs.length === 0 ? (
          <EmptyMessage
            title="Your first brief has not arrived yet."
            detail={snapshot.counts.topics > 0
              ? "Your watchlist is ready. Review the routine schedule to choose when Breve should arrive."
              : "Add the topics you care about, then choose when each briefing should arrive."}
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
            action={<button type="button" className="ghostbtn" onClick={() => { setBriefQuery(""); setBriefKind("all"); }}>Clear filters</button>}
          />
        ) : (
          <div className="breve-brief-list">
            {visibleBriefs.map((brief) => {
              const content = <>
                <span className={`breve-kind ${brief.kind}`}>{brief.kind}</span>
                <span className="breve-brief-title" title={brief.title}>{brief.title}</span>
                <time dateTime={brief.date}>{new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(`${brief.date}T12:00:00`))}</time>
                <span className="breve-brief-state">{brief.imported ? "In Rotli" : "Legacy"}</span>
              </>;
              return brief.path ? (
                <button
                  type="button"
                  className="breve-brief-row interactive"
                  key={brief.stem}
                  title={`Open ${brief.title}`}
                  onClick={(event) => {
                    setSidebarMode("notes");
                    openNote(brief.path!, { newTab: event.metaKey });
                  }}
                >
                  {content}
                </button>
              ) : (
                <div className="breve-brief-row" key={brief.stem}>{content}</div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

type EditableWatchItem = WatchItem & { id: string };
type EditableWatchSection = Omit<WatchSection, "items"> & { id: string; items: EditableWatchItem[] };

function normalizedWebsite(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(candidate);
    if ((parsed.protocol !== "https:" && parsed.protocol !== "http:") || !parsed.hostname) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function WatchGuidanceInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const frame = requestAnimationFrame(() => {
      if (!ref.current) return;
      ref.current.style.height = "auto";
      ref.current.style.height = `${Math.max(72, ref.current.scrollHeight)}px`;
    });
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return (
    <textarea
      ref={ref}
      value={value}
      rows={2}
      placeholder="The signal, change, or angle that matters"
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => event.stopPropagation()}
    />
  );
}

function editId(): string {
  return crypto.randomUUID();
}

function editableWatchlist(markdown: string): { sections: EditableWatchSection[]; preferences: string } {
  const parsed = parseWatchlist(markdown);
  return {
    preferences: parsed.preferences,
    sections: parsed.sections.map((section) => ({
      ...section,
      note: section.note ?? "",
      id: editId(),
      items: section.items.map((item) => ({ ...item, url: item.url ?? legacyWatchUrl(item.watch), id: editId() })),
    })),
  };
}

function watchlistDocument(sections: EditableWatchSection[], preferences: string): string {
  return serializeWatchlist({
    preferences,
    sections: sections.map(({ title, note, items }) => ({
      title,
      ...(note ? { note } : {}),
      items: items.map(({ watch, lens, url }) => ({ watch, lens, ...(url?.trim() ? { url: url.trim() } : {}) })),
    })),
  });
}

function WatchlistView({ snapshot }: { snapshot: BreveSnapshot }) {
  const queryClient = useQueryClient();
  const initial = useMemo(() => editableWatchlist(snapshot.watchlist), [snapshot.watchlist]);
  const [sections, setSections] = useState(initial.sections);
  const [preferences, setPreferences] = useState(initial.preferences);
  const [base, setBase] = useState(() => watchlistDocument(initial.sections, initial.preferences));
  const [query, setQuery] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [error, setError] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set());
  const markdown = watchlistDocument(sections, preferences);
  const dirty = markdown !== base;
  useBreveDraftGuard(dirty);
  const topicCount = sections.reduce((total, section) => total + section.items.length, 0);
  const duplicateGroup = sections.find(
    (section, index) =>
      !!section.title.trim() &&
      sections.findIndex((candidate) => candidate.title.trim().toLowerCase() === section.title.trim().toLowerCase()) !== index,
  );
  const invalid = sections.some((section) => !section.title.trim() || section.items.some((item) => !item.watch.trim()));
  const invalidWebsite = sections
    .flatMap((section) => section.items)
    .find((item) => item.url?.trim() && !normalizedWebsite(item.url));
  const validation = duplicateGroup
    ? `“${duplicateGroup.title.trim()}” is used more than once. Give each group a unique name.`
    : invalid
      ? "Every group and topic needs a name. Complete or remove the empty row before saving."
      : invalidWebsite
        ? `“${invalidWebsite.url}” is not a valid website. Use a domain or an http/https URL.`
      : "";
  const normalizedQuery = query.trim().toLowerCase();
  const visibleSections = normalizedQuery
    ? sections.flatMap((section) => {
        const groupMatches = section.title.toLowerCase().includes(normalizedQuery);
        const items = groupMatches
          ? section.items
          : section.items.filter((item) => `${item.watch} ${item.lens} ${item.url ?? ""}`.toLowerCase().includes(normalizedQuery));
        return items.length || groupMatches ? [{ ...section, items }] : [];
      })
    : sections;

  useEffect(() => {
    if (dirty) return;
    const next = editableWatchlist(snapshot.watchlist);
    setSections(next.sections);
    setPreferences(next.preferences);
    setBase(watchlistDocument(next.sections, next.preferences));
    setCollapsedGroups(new Set());
  }, [dirty, snapshot.watchlist]);

  const updateSection = (sectionId: string, patch: Partial<Pick<EditableWatchSection, "title" | "note">>) => {
    setSections((current) => current.map((section) => section.id === sectionId ? { ...section, ...patch } : section));
    setSaveState("idle");
  };

  const updateItem = (sectionId: string, itemId: string, patch: Partial<WatchItem>) => {
    setSections((current) => current.map((section) =>
      section.id === sectionId
        ? { ...section, items: section.items.map((item) => item.id === itemId ? { ...item, ...patch } : item) }
        : section,
    ));
    setSaveState("idle");
  };

  const addTopic = (sectionId: string) => {
    setQuery("");
    setSections((current) => current.map((section) =>
      section.id === sectionId
        ? { ...section, items: [...section.items, { id: editId(), watch: "", lens: "", url: "" }] }
        : section,
    ));
    setSaveState("idle");
  };

  const addGroup = () => {
    setQuery("");
    setSections((current) => [
      ...current,
      { id: editId(), title: "New group", items: [{ id: editId(), watch: "", lens: "", url: "" }] },
    ]);
    setSaveState("idle");
  };

  const save = async () => {
    if (validation) return;
    setSaveState("saving");
    setError("");
    try {
      const next = await breveWriteWatchlist(markdown);
      queryClient.setQueryData(BREVE_QUERY_KEY, next);
      setBase(markdown);
      setSaveState("saved");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaveState("error");
    }
  };

  return (
    <div className="breve-page">
      <PageHead title="Watchlist" detail="Tell Breve what to follow and what kind of change matters to you." />
      <div className="breve-watch-manager-bar">
        <label className="breve-watch-search" htmlFor="breve-watch-search">
          <SearchGlyph size={14} />
          <input
            id="breve-watch-search"
            aria-label="Search watchlist topics"
            value={query}
            placeholder="Search topics…"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => event.stopPropagation()}
          />
        </label>
        <span className="breve-watch-count">{topicCount} {topicCount === 1 ? "topic" : "topics"} in {sections.length} {sections.length === 1 ? "group" : "groups"}</span>
        <span className="breve-toolbar-grow" />
        <SaveNote state={saveState} error={error} dirty={dirty} />
        <button type="button" className="ghostbtn" onClick={addGroup}>
          <PlusGlyph size={13} /> Add group
        </button>
        <button type="button" className="ghostbtn primary" disabled={!dirty || !!validation || saveState === "saving"} onClick={() => void save()}>
          {saveState === "saving" ? "Saving…" : "Save watchlist"}
        </button>
      </div>
      {validation && <p id="breve-watch-validation" className="breve-watch-validation" role="alert">{validation}</p>}

      <div className="breve-watch-groups">
        {visibleSections.map((section) => {
          const expanded = !!normalizedQuery || !collapsedGroups.has(section.id);
          const duplicate = !!section.title.trim() && sections.filter(
            (candidate) => candidate.title.trim().toLowerCase() === section.title.trim().toLowerCase(),
          ).length > 1;
          return (
          <section className="breve-watch-group" key={section.id} aria-label={`${section.title || "Untitled"} watch group`}>
            <div className="breve-watch-group-head">
              <button
                type="button"
                className="breve-watch-disclosure"
                aria-label={`${expanded ? "Collapse" : "Expand"} ${section.title || "watch group"}`}
                aria-expanded={expanded}
                onClick={() => setCollapsedGroups((current) => {
                  const next = new Set(current);
                  if (next.has(section.id)) next.delete(section.id);
                  else next.add(section.id);
                  return next;
                })}
              >
                <ChevronRight size={12} className={expanded ? "open" : undefined} />
              </button>
              <label>
                <span className="sr-only">Group name</span>
                <input
                  value={section.title}
                  aria-label="Group name"
                  aria-invalid={!section.title.trim() || duplicate}
                  aria-describedby={validation ? "breve-watch-validation" : undefined}
                  onChange={(event) => updateSection(section.id, { title: event.target.value })}
                  onKeyDown={(event) => event.stopPropagation()}
                />
              </label>
              <span>{section.items.length} {section.items.length === 1 ? "topic" : "topics"}</span>
              <button
                type="button"
                className="breve-watch-remove"
                aria-label={`Remove ${section.title || "group"}`}
                title={section.items.length ? "Remove the topics first" : "Remove group"}
                disabled={section.items.length > 0}
                onClick={() => {
                  setSections((current) => current.filter((candidate) => candidate.id !== section.id));
                  setSaveState("idle");
                }}
              >
                <XGlyph size={13} />
              </button>
            </div>

            {expanded && <>
            <label className="breve-watch-group-note">
              <span className="sr-only">Optional group guidance</span>
              <input
                value={section.note ?? ""}
                placeholder="Optional guidance for this group"
                onChange={(event) => updateSection(section.id, { note: event.target.value })}
                onKeyDown={(event) => event.stopPropagation()}
              />
            </label>

            <div className="breve-watch-items">
              {section.items.map((item) => (
                <div className="breve-watch-item" key={item.id}>
                  <label className="breve-watch-topic-field">
                    <span className="breve-watch-field-label">Topic</span>
                    <input
                      value={item.watch}
                      placeholder="Company, person, product, or theme"
                      aria-invalid={!item.watch.trim()}
                      aria-describedby={validation ? "breve-watch-validation" : undefined}
                      onChange={(event) => updateItem(section.id, item.id, { watch: event.target.value })}
                      onKeyDown={(event) => event.stopPropagation()}
                    />
                  </label>
                  <label className="breve-watch-website-field">
                    <span className="breve-watch-field-label">Website or source</span>
                    <span className="breve-watch-link-control">
                      <input
                        type="url"
                        inputMode="url"
                        value={item.url ?? ""}
                        placeholder="company.com"
                        aria-invalid={!!item.url?.trim() && !normalizedWebsite(item.url)}
                        aria-describedby={validation ? "breve-watch-validation" : undefined}
                        onChange={(event) => updateItem(section.id, item.id, { url: event.target.value })}
                        onBlur={() => {
                          const normalized = normalizedWebsite(item.url ?? "");
                          if (normalized) updateItem(section.id, item.id, { url: normalized });
                        }}
                        onKeyDown={(event) => event.stopPropagation()}
                      />
                      <button
                        type="button"
                        className="breve-watch-open-link"
                        disabled={!normalizedWebsite(item.url ?? "")}
                        aria-label={`Open website for ${item.watch || "topic"}`}
                        title={normalizedWebsite(item.url ?? "") ? "Open website" : "Add a valid website first"}
                        onClick={() => {
                          const url = normalizedWebsite(item.url ?? "");
                          if (url) void openUrl(url);
                        }}
                      >
                        <ExternalLinkGlyph size={13} />
                      </button>
                    </span>
                  </label>
                  <button
                    type="button"
                    className="breve-watch-remove"
                    aria-label={`Remove ${item.watch || "empty topic"}`}
                    title="Remove topic"
                    onClick={() => {
                      setSections((current) => current.map((candidate) =>
                        candidate.id === section.id
                          ? { ...candidate, items: candidate.items.filter((candidateItem) => candidateItem.id !== item.id) }
                          : candidate,
                      ));
                      setSaveState("idle");
                    }}
                  >
                    <XGlyph size={13} />
                  </button>
                  <label className="breve-watch-guidance-field">
                    <span className="breve-watch-field-label">What should Breve look for?</span>
                    <WatchGuidanceInput
                      value={item.lens}
                      onChange={(lens) => updateItem(section.id, item.id, { lens })}
                    />
                  </label>
                </div>
              ))}
              {section.items.length === 0 && <p className="breve-watch-group-empty">No topics in this group yet.</p>}
            </div>
            <button type="button" className="breve-watch-add" onClick={() => addTopic(section.id)}>
              <PlusGlyph size={13} /> Add topic
            </button>
            </>}
          </section>
        )})}
        {sections.length === 0 && (
          <div className="breve-watch-empty">
            <p>Your watchlist is empty.</p>
            <span>Add a group, then add the topics Breve should follow.</span>
            <button type="button" className="ghostbtn primary" onClick={addGroup}>Add first group</button>
          </div>
        )}
        {sections.length > 0 && visibleSections.length === 0 && (
          <div className="breve-watch-empty"><p>No topics match “{query}”.</p><button type="button" className="ghostbtn" onClick={() => setQuery("")}>Clear search</button></div>
        )}
      </div>

      <section className="breve-watch-preferences" aria-labelledby="breve-watch-preferences-title">
        <div>
          <h3 id="breve-watch-preferences-title">Brief preferences</h3>
          <p>Optional guidance that applies across every topic.</p>
        </div>
        <label>
          <span className="sr-only">Brief preferences for every topic</span>
          <textarea
            value={preferences}
            rows={4}
            aria-labelledby="breve-watch-preferences-title"
            placeholder="For example: Keep each brief concise and prioritize meaningful product changes."
            onChange={(event) => { setPreferences(event.target.value); setSaveState("idle"); }}
            onKeyDown={(event) => event.stopPropagation()}
          />
        </label>
      </section>
    </div>
  );
}

type BriefSlot = "morning" | "lunch" | "night";

function routineBriefSlot(routine: BreveRoutine): BriefSlot | null {
  const text = `${routine.id} ${routine.label}`.toLowerCase();
  if (text.includes("morning")) return "morning";
  if (text.includes("lunch") || text.includes("pivot")) return "lunch";
  if (text.includes("night")) return "night";
  return null;
}

function RoutinesView({ snapshot }: { snapshot: BreveSnapshot }) {
  const queryClient = useQueryClient();
  const [config, setConfig] = useState(snapshot.config);
  const [base, setBase] = useState(snapshot.config);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [error, setError] = useState("");
  const dirty = JSON.stringify(config) !== JSON.stringify(base);
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
      routines: current.routines.map((routine) =>
        routine.id === id ? { ...routine, ...patch } : routine,
      ),
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

  return (
    <div className="breve-page">
      <PageHead title="Routines" detail="Arrival times, recurring checks, and the jobs that build each brief." />
      <div className="breve-honesty" role="status">
        <ClockGlyph size={15} />
        <p>
          {snapshot.scheduler === "rotli"
            ? "Rotli is actively managing these routines and the always-on Signal assistant. Saved changes are adopted automatically."
            : snapshot.scheduler === "legacy-launchd"
            ? "The previous Breve scheduler is still in charge. Changes are preserved here, but Rotli does not deliver scheduled briefs yet."
            : "Rotli stores these routines, but its delivery scheduler is not active yet."}
        </p>
      </div>

      <div className="breve-config-toolbar">
        <label>
          <span>Timezone</span>
          <input value={config.timezone} onChange={(e) => setConfig({ ...config, timezone: e.target.value })} />
        </label>
        <span className="breve-toolbar-grow" />
        <SaveNote state={saveState} error={error} dirty={dirty} />
        <button type="button" className="ghostbtn primary" disabled={!dirty || saveState === "saving"} onClick={() => void save()}>
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
                <span className="breve-mobile-field-label" aria-hidden="true">Delivery time</span>
                <span className="sr-only">{slot} delivery time</span>
                <input type="time" value={config.deliveryTimes[slot]} onChange={(e) => setDelivery(slot, e.target.value)} />
              </label>
              <label>
                <span className="breve-mobile-field-label" aria-hidden="true">Start preparing</span>
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
          <span className="breve-inline-status">{config.routines.filter((routine) => routine.enabled).length} of {config.routines.length} active</span>
        </div>
        <div className="breve-routine-columns" aria-hidden="true">
          <span>Automation</span>
          <span>Cadence</span>
          <span>Delivery</span>
        </div>
        <div className="breve-routine-list">
          {config.routines.map((routine) => {
            const lanes = [...new Set(["inApp", "signal", "email", ...routine.lanes])];
            const slot = routineBriefSlot(routine);
            return (
              <div className={routine.enabled ? "breve-routine-row" : "breve-routine-row off"} key={routine.id}>
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
                  <strong>{routine.label}</strong>
                  <span>{formatNextRoutine(routine, now, config.timezone)}</span>
                </div>
                <div className="breve-schedule-control">
                  {routine.schedule.kind === "dailyAt" ? (
                    <span className="breve-schedule-reference">
                      {slot ? `${slot.charAt(0).toUpperCase() + slot.slice(1)} arrival` : "Daily"}
                    </span>
                  ) : routine.schedule.kind === "everySecs" ? (
                    <label>
                      Every
                      <input
                        type="number"
                        min="1"
                        aria-label={`${routine.label} interval in minutes`}
                        value={Math.max(1, Math.round(routine.schedule.secs / 60))}
                        onChange={(e) => patchRoutine(routine.id, { schedule: { kind: "everySecs", secs: Math.max(60, Number(e.target.value) * 60 || 60) } })}
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
            );
          })}
        </div>
      </section>
    </div>
  );
}

type DetectMap = Partial<Record<ProviderId, { installed: boolean; authenticated: boolean; version: string | null }>>;

function ModelsView({ snapshot }: { snapshot: BreveSnapshot }) {
  const queryClient = useQueryClient();
  const aiProviders = useUiStore((s) => s.aiProviders);
  const blockedModels = useUiStore((s) => s.blockedModels);
  const [config, setConfig] = useState(snapshot.config);
  const [base, setBase] = useState(snapshot.config);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [error, setError] = useState("");
  const dirty = JSON.stringify(config.modelPolicy) !== JSON.stringify(base.modelPolicy);
  const duplicateFallback = new Set(config.modelPolicy.fallbacks).size !== config.modelPolicy.fallbacks.length;
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
  const options = modelPolicyOptions(config, allModels.map((model) => model.id));
  const labelFor = (id: string) =>
    allModels.find((model) => model.id === id)?.label ??
    catalogModels.find((model) => model.id === id)?.label ??
    id.replace(/-(it-qat|instruct)-4bit$/i, "");

  const save = async () => {
    if (modelValidation) return;
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

  const moveFallback = (index: number, delta: -1 | 1) => {
    const list = [...config.modelPolicy.fallbacks];
    const target = index + delta;
    if (target < 0 || target >= list.length) return;
    [list[index], list[target]] = [list[target]!, list[index]!];
    setConfig({ ...config, modelPolicy: { ...config.modelPolicy, fallbacks: list } });
  };

  return (
    <div className="breve-page">
      <PageHead title="Models" detail="Choose the writer, ordered fallbacks, and the local helper used by briefs." />
      <div className="breve-config-toolbar">
        <span className="breve-toolbar-grow" />
        <SaveNote state={saveState} error={error} dirty={dirty} />
        <button type="button" className="ghostbtn primary" disabled={!dirty || !!modelValidation || saveState === "saving"} onClick={() => void save()}>
          {saveState === "saving" ? "Saving…" : "Save model policy"}
        </button>
      </div>
      {modelValidation && <p id="breve-model-validation" className="breve-watch-validation" role="alert">{modelValidation}</p>}

      <section className="breve-section" aria-labelledby="breve-policy-title">
        <div className="breve-section-head copy">
          <div>
            <h3 id="breve-policy-title">Brief policy</h3>
            <p>Authenticated models stay available to Breve even when hidden from Chat. Individually blocked models remain excluded.</p>
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
              {options.map((id) => <option key={id} value={id}>{labelFor(id)}</option>)}
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
              {(local.data ?? []).map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
            </select>
          </label>
        </div>

        <div className="breve-fallbacks">
          <div className="breve-section-head"><h4>Fallback order</h4></div>
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
                  .filter((option) => option === id || (
                    option !== config.modelPolicy.primary &&
                    !config.modelPolicy.fallbacks.some((fallback, fallbackIndex) => fallbackIndex !== index && fallback === option)
                  ))
                  .map((option) => <option key={option} value={option}>{labelFor(option)}</option>)}
              </select>
              <button type="button" className="breve-icon-action" aria-label={`Move ${labelFor(id)} earlier`} disabled={index === 0} onClick={() => moveFallback(index, -1)}><ChevronRight size={12} className="up" /></button>
              <button type="button" className="breve-icon-action" aria-label={`Move ${labelFor(id)} later`} disabled={index === config.modelPolicy.fallbacks.length - 1} onClick={() => moveFallback(index, 1)}><ChevronRight size={12} className="down" /></button>
              <button
                type="button"
                className="breve-icon-action"
                aria-label={`Remove ${labelFor(id)}`}
                onClick={() => setConfig({ ...config, modelPolicy: { ...config.modelPolicy, fallbacks: config.modelPolicy.fallbacks.filter((_, i) => i !== index) } })}
              ><XGlyph size={12} /></button>
            </div>
          ))}
          <select
            className="breve-add-fallback"
            aria-label="Add a fallback model"
            value=""
            onChange={(e) => {
              if (!e.target.value || config.modelPolicy.fallbacks.includes(e.target.value)) return;
              setConfig({ ...config, modelPolicy: { ...config.modelPolicy, fallbacks: [...config.modelPolicy.fallbacks, e.target.value] } });
            }}
          >
            <option value="">Add fallback…</option>
            {options.filter((id) => id !== config.modelPolicy.primary && !config.modelPolicy.fallbacks.includes(id)).map((id) => (
              <option key={id} value={id}>{labelFor(id)}</option>
            ))}
          </select>
        </div>
      </section>

      <section className="breve-section" aria-labelledby="breve-connections-title">
        <div className="breve-section-head copy">
          <div><h3 id="breve-connections-title">Connections</h3><p>Breve checks model access on this Mac without changing your Chat picker.</p></div>
          {(local.isError || detects.isError) && <button type="button" className="ghostbtn" onClick={() => { void local.refetch(); void detects.refetch(); }}>Check again</button>}
        </div>
        <div className="breve-connection-list" aria-busy={local.isLoading || detects.isLoading}>
          <div className="breve-connection-row">
            <span>On this Mac</span>
            <span>{local.isLoading ? "Checking…" : local.isError ? "Check failed" : `${local.data?.length ?? 0} models`}</span>
            <strong>{local.isLoading ? "Checking" : local.isError ? "Needs attention" : (local.data?.length ?? 0) > 0 ? "Ready" : "Unavailable"}</strong>
          </div>
          {PROVIDER_IDS.map((id) => {
            const detected = detects.data?.[id];
            const status = detects.isLoading && !detected
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

function PdfThemeEditor({ theme, onChange }: { theme: BrevePdfTheme; onChange: (theme: BrevePdfTheme) => void }) {
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
              {PDF_THEME_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <small id="breve-pdf-theme-help">{PDF_THEME_OPTIONS.find((option) => option.value === theme.preset)?.detail}</small>
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
                      onChange={(event) => onChange({ ...theme, custom: { ...theme.custom, [key]: event.target.value } })}
                    />
                    <code>{theme.custom[key].toUpperCase()}</code>
                  </span>
                </label>
              ))}
            </div>
          )}
          {validation && <p id="breve-pdf-theme-error" className="breve-field-error" role="alert">{validation}</p>}
        </div>
        <div className="breve-pdf-preview" style={style} aria-label={`${PDF_THEME_OPTIONS.find((option) => option.value === theme.preset)?.label} PDF preview`}>
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

function ConfigureView({ snapshot }: { snapshot: BreveSnapshot }) {
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

  const deliveryDirty = !!draft && !!base && (JSON.stringify(draft) !== JSON.stringify(base) || !!apiKey.trim());
  const configDirty = JSON.stringify(config.pdfTheme) !== JSON.stringify(configBase.pdfTheme);
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
  const invalidSignal = [draft?.signalBot, draft?.signalOwner]
    .find((value) => !!value && !/^\+[1-9]\d{7,14}$/.test(value));
  const deliveryValidation = invalidRecipient
    ? `“${invalidRecipient}” is not a valid email address.`
    : invalidSignal
      ? "Signal numbers must use international format, such as +14075551234."
      : "";
  const emailReady = !!draft?.resendKeyConfigured && !!draft.emailFrom && draft.emailTo.length > 0 && !invalidRecipient;
  const signalReady = !!draft?.signalBot && !!draft.signalOwner && !invalidSignal;

  const save = async () => {
    if (!draft || themeValidation || deliveryValidation) return;
    setSaveState("saving");
    setError("");
    try {
      if (configDirty) {
        const nextSnapshot = await breveWriteConfig(config);
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
    setTest({ target, state: "saving", message: target === "email" ? "Sending test email…" : "Sending test Signal…" });
    try {
      const message = await (target === "email" ? breveTestEmail() : breveTestSignal());
      setTest({ target, state: "saved", message });
    } catch (e) {
      setTest({ target, state: "error", message: e instanceof Error ? e.message : String(e) });
    }
  };

  if (settingsQuery.isError) {
    return (
      <div className="breve-page">
        <PageHead title="Configure" detail="Connect the services Breve uses to deliver for you." />
        <EmptyMessage
          title="Delivery settings could not be loaded."
          detail="Your saved configuration was not changed. Try reading the snapshot again."
          action={<button type="button" className="ghostbtn" onClick={() => void settingsQuery.refetch()}>Try again</button>}
        />
      </div>
    );
  }
  if (settingsQuery.isLoading || !draft) {
    return <div className="breve-page"><PageHead title="Configure" detail="Connect the services Breve uses to deliver for you." /><BreveSkeleton label="Loading delivery settings" /></div>;
  }

  return (
    <div className="breve-page">
      <PageHead title="Configure" detail="Choose how Breve looks and where it sends email and Signal messages." />

      <div className="breve-config-savebar">
        <p>{import.meta.env.DEV ? "Loaded from your current setup. Changes made in dev stay temporary." : "Changes apply to the Rotli-managed scheduler after you save."}</p>
        <span className="breve-toolbar-grow" />
        <SaveNote state={saveState} error={error} dirty={dirty} />
        <button type="button" className="ghostbtn primary" disabled={!dirty || !!themeValidation || !!deliveryValidation || saveState === "saving"} onClick={() => void save()}>
          {saveState === "saving" ? "Saving…" : "Save configuration"}
        </button>
      </div>
      {deliveryValidation && <p id="breve-delivery-validation" className="breve-watch-validation" role="alert">{deliveryValidation}</p>}

      <aside className="breve-keychain-note" aria-label="Credential storage">
        <LockGlyph size={14} />
        <div>
          <strong>Secrets are saved in your Mac Keychain.</strong>
          <span>Rotli never displays your Resend API key. Delivery addresses and Signal routing stay in Rotli&rsquo;s managed Breve configuration.</span>
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
              placeholder={draft.resendKeyConfigured ? "Saved in Keychain — enter a new key to replace it" : "re_…"}
              onChange={(event) => { setApiKey(event.target.value); setSaveState("idle"); }}
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
              onChange={(event) => { setDraft({ ...draft, emailFrom: event.target.value }); setSaveState("idle"); }}
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
                setDraft({ ...draft, emailTo: event.target.value.split(/[\n,]/).map((value) => value.trim()).filter(Boolean) });
                setSaveState("idle");
              }}
              onKeyDown={(event) => event.stopPropagation()}
            />
            <small>One address per line. These receive scheduled briefs.</small>
          </label>
        </div>
        <div className="breve-delivery-actions">
          <button type="button" className="ghostbtn" title={dirty ? "Save your changes before sending a test" : undefined} disabled={!emailReady || dirty || test?.state === "saving"} onClick={() => void runTest("email")}>Send test email</button>
          {draft.resendKeyConfigured && (removeKeyArmed ? (
            <span className="breve-confirm-actions inline" role="group" aria-label="Confirm API key removal">
              <button type="button" className="ghostbtn" onClick={() => setRemoveKeyArmed(false)}>Keep key</button>
              <button type="button" className="ghostbtn quiet" disabled={saveState === "saving"} onClick={() => void removeKey()}>Confirm removal</button>
            </span>
          ) : (
            <button type="button" className="ghostbtn quiet" disabled={saveState === "saving"} onClick={() => setRemoveKeyArmed(true)}>Remove API key</button>
          ))}
          {test?.target === "email" && <span className={test.state === "error" ? "breve-save-note err" : "breve-save-note"} role={test.state === "error" ? "alert" : "status"}>{test.message}</span>}
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
              onChange={(event) => { setDraft({ ...draft, signalBot: event.target.value }); setSaveState("idle"); }}
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
              onChange={(event) => { setDraft({ ...draft, signalOwner: event.target.value }); setSaveState("idle"); }}
              onKeyDown={(event) => event.stopPropagation()}
            />
            <small>Only this number can use the Breve assistant.</small>
          </label>
          <label className="breve-field wide" htmlFor="breve-signal-owner-uuid">
            <span>Owner UUID <em>optional</em></span>
            <input
              id="breve-signal-owner-uuid"
              value={draft.signalOwnerUuid}
              placeholder="Signal account UUID"
              onChange={(event) => { setDraft({ ...draft, signalOwnerUuid: event.target.value }); setSaveState("idle"); }}
              onKeyDown={(event) => event.stopPropagation()}
            />
            <small>Add this if Signal resolves the owner by UUID instead of phone number.</small>
          </label>
        </div>
        <div className="breve-delivery-actions">
          <button type="button" className="ghostbtn" title={dirty ? "Save your changes before sending a test" : undefined} disabled={!signalReady || dirty || test?.state === "saving"} onClick={() => void runTest("signal")}>Send test Signal</button>
          {test?.target === "signal" && <span className={test.state === "error" ? "breve-save-note err" : "breve-save-note"} role={test.state === "error" ? "alert" : "status"}>{test.message}</span>}
        </div>
      </section>
    </div>
  );
}

export function BreveSurface() {
  const view = useUiStore((s) => s.breveView);
  const query = useBreveSnapshot();
  const snapshot = query.data ?? EMPTY_BREVE_SNAPSHOT;

  if (query.isLoading) {
    return <main className="breve-surface" aria-label="Breve"><div className="breve-page"><BreveSkeleton label="Loading Breve" /></div></main>;
  }
  if (query.isError) {
    return (
      <main className="breve-surface" aria-label="Breve">
        <div className="breve-page">
          <EmptyMessage title="Breve could not be loaded." detail="Your Rotli data was not changed." action={<button type="button" className="ghostbtn" onClick={() => void query.refetch()}>Try again</button>} />
        </div>
      </main>
    );
  }

  return (
    <main className="breve-surface" aria-label={`Breve ${view}`}>
      {view === "briefs" && <BriefsView snapshot={snapshot} />}
      {view === "watchlist" && <WatchlistView snapshot={snapshot} />}
      {view === "routines" && <RoutinesView snapshot={snapshot} />}
      {view === "models" && <ModelsView snapshot={snapshot} />}
      {view === "configure" && <ConfigureView snapshot={snapshot} />}
    </main>
  );
}
