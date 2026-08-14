// The Watchlist view: a scannable read surface (compact topic rows under group
// headers) with one in-place editor per topic. Adding lives in two obvious
// places — "Add group" in the manager bar and "+ Add topic" in every group
// header. Validation sits on the offending row, never in a page banner. The
// markdown read/write contract is unchanged (src/routines/watchlist.ts).

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";

import { breveBackfillWatchlist, breveWriteWatchlist, openUrl, type BreveSnapshot } from "../../lib/tauri";
import type { WatchItem } from "../../routines/watchlist";
import { ChevronRight, ExternalLinkGlyph, PlusGlyph, SearchGlyph, XGlyph } from "../glyphs";
import { PageHead, SaveNote, useBreveDraftGuard, type SaveState } from "./breveShared";
import {
  editId,
  editableWatchlist,
  itemIssue,
  normalizedWebsite,
  sectionIssue,
  watchlistDocument,
  watchlistHasIssues,
  websiteDomain,
  type EditableWatchItem,
  type EditableWatchSection,
} from "./breveWatchlistModel";
import { BREVE_QUERY_KEY } from "./useBreve";

function WatchGuidanceInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
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

function TopicEditor({
  item,
  issue,
  issueId,
  onPatch,
  onRemove,
  onDone,
  focusRef,
}: {
  item: EditableWatchItem;
  issue: string | null;
  issueId: string;
  onPatch: (patch: Partial<WatchItem>) => void;
  onRemove: () => void;
  onDone: () => void;
  focusRef: (node: HTMLInputElement | null) => void;
}) {
  return (
    <div className="breve-watch-item">
      <label className="breve-watch-topic-field">
        <span className="breve-watch-field-label">Topic</span>
        <input
          ref={focusRef}
          value={item.watch}
          placeholder="Company, person, product, or theme"
          aria-invalid={!item.watch.trim()}
          aria-describedby={issue ? issueId : undefined}
          onChange={(event) => onPatch({ watch: event.target.value })}
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
            aria-describedby={issue ? issueId : undefined}
            onChange={(event) => onPatch({ url: event.target.value })}
            onBlur={() => {
              const normalized = normalizedWebsite(item.url ?? "");
              if (normalized) onPatch({ url: normalized });
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
        onClick={onRemove}
      >
        <XGlyph size={13} />
      </button>
      <label className="breve-watch-guidance-field">
        <span className="breve-watch-field-label">What should Breve look for?</span>
        <WatchGuidanceInput value={item.lens} onChange={(lens) => onPatch({ lens })} />
      </label>
      <div className="breve-watch-item-foot">
        {issue ? (
          <p id={issueId} className="breve-watch-row-issue" role="alert">
            {issue}
          </p>
        ) : (
          <span />
        )}
        <button type="button" className="ghostbtn" onClick={onDone}>
          Done
        </button>
      </div>
    </div>
  );
}

export function WatchlistView({ snapshot }: { snapshot: BreveSnapshot }) {
  const queryClient = useQueryClient();
  const initial = useMemo(() => editableWatchlist(snapshot.watchlist), [snapshot.watchlist]);
  const [sections, setSections] = useState(initial.sections);
  const [preferences, setPreferences] = useState(initial.preferences);
  const [base, setBase] = useState(() => watchlistDocument(initial.sections, initial.preferences));
  const [query, setQuery] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [refreshState, setRefreshState] = useState<"idle" | "running" | "done" | "error">("idle");
  const [refreshMessage, setRefreshMessage] = useState("");
  const [error, setError] = useState("");
  // groups arrive FOLDED (2026-07-30: 34 topics read as 10 calm rows, not a
  // wall) — search auto-expands matches, Add topic unfolds its group
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
    () => new Set(initial.sections.map((section) => section.id)),
  );
  const [openItems, setOpenItems] = useState<Set<string>>(() => new Set());
  const pendingFocus = useRef<string | null>(null);
  const markdown = watchlistDocument(sections, preferences);
  const dirty = markdown !== base;
  useBreveDraftGuard(dirty);
  const topicCount = sections.reduce((total, section) => total + section.items.length, 0);
  const hasIssues = watchlistHasIssues(sections);
  const normalizedQuery = query.trim().toLowerCase();
  const visibleSections = normalizedQuery
    ? sections.flatMap((section) => {
        const groupMatches = section.title.toLowerCase().includes(normalizedQuery);
        const items = groupMatches
          ? section.items
          : section.items.filter((item) =>
              `${item.watch} ${item.lens} ${item.url ?? ""}`.toLowerCase().includes(normalizedQuery),
            );
        return items.length || groupMatches ? [{ ...section, items }] : [];
      })
    : sections;

  // section ids regenerate on every reparse, so carrying fold state across a
  // snapshot reset needs a TITLE mirror — without it, saving refolds the very
  // group the user was working in (adversarial review, MEDIUM)
  const expandedTitlesRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    expandedTitlesRef.current = new Set(
      sections.filter((section) => !collapsedGroups.has(section.id)).map((section) => section.title),
    );
  }, [sections, collapsedGroups]);

  useEffect(() => {
    if (dirty) return;
    const next = editableWatchlist(snapshot.watchlist);
    setSections(next.sections);
    setPreferences(next.preferences);
    setBase(watchlistDocument(next.sections, next.preferences));
    setCollapsedGroups(
      new Set(
        next.sections
          .filter((section) => !expandedTitlesRef.current.has(section.title))
          .map((section) => section.id),
      ),
    );
    setOpenItems(new Set());
  }, [dirty, snapshot.watchlist]);

  const focusWhenPending = (id: string) => (node: HTMLInputElement | null) => {
    if (node && pendingFocus.current === id) {
      pendingFocus.current = null;
      node.focus();
    }
  };

  const updateSection = (sectionId: string, patch: Partial<Pick<EditableWatchSection, "title" | "note">>) => {
    setSections((current) =>
      current.map((section) => (section.id === sectionId ? { ...section, ...patch } : section)),
    );
    setSaveState("idle");
  };

  const updateItem = (sectionId: string, itemId: string, patch: Partial<WatchItem>) => {
    setSections((current) =>
      current.map((section) =>
        section.id === sectionId
          ? {
              ...section,
              items: section.items.map((item) => (item.id === itemId ? { ...item, ...patch } : item)),
            }
          : section,
      ),
    );
    setSaveState("idle");
  };

  const removeItem = (sectionId: string, itemId: string) => {
    setSections((current) =>
      current.map((section) =>
        section.id === sectionId
          ? {
              ...section,
              items: section.items.filter((item) => item.id !== itemId),
            }
          : section,
      ),
    );
    setOpenItems((current) => {
      const next = new Set(current);
      next.delete(itemId);
      return next;
    });
    setSaveState("idle");
  };

  const toggleItem = (itemId: string) => {
    // ONE editor at a time — opening a row folds the previous one, so the
    // read surface never degrades back into a wall of forms (PR #11 review)
    setOpenItems((current) => (current.has(itemId) ? new Set() : new Set([itemId])));
  };

  const addTopic = (sectionId: string) => {
    const itemId = editId();
    setQuery("");
    pendingFocus.current = itemId;
    setCollapsedGroups((current) => {
      const next = new Set(current);
      next.delete(sectionId);
      return next;
    });
    setOpenItems(new Set([itemId]));
    setSections((current) =>
      current.map((section) =>
        section.id === sectionId
          ? {
              ...section,
              items: [...section.items, { id: itemId, watch: "", lens: "", url: "" }],
            }
          : section,
      ),
    );
    setSaveState("idle");
  };

  const addGroup = () => {
    const sectionId = editId();
    setQuery("");
    pendingFocus.current = sectionId;
    setSections((current) => [...current, { id: sectionId, title: "", note: "", items: [] }]);
    setSaveState("idle");
  };

  const save = async () => {
    if (hasIssues) return;
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

  const refreshLastThirtyDays = async () => {
    if (hasIssues || refreshState === "running") return;
    setRefreshState("running");
    setRefreshMessage("");
    setError("");
    try {
      if (dirty) {
        setSaveState("saving");
        const saved = await breveWriteWatchlist(markdown);
        queryClient.setQueryData(BREVE_QUERY_KEY, saved);
        setBase(markdown);
        setSaveState("saved");
      }
      const result = await breveBackfillWatchlist();
      queryClient.setQueryData(BREVE_QUERY_KEY, result.snapshot);
      setRefreshState("done");
      setRefreshMessage(result.message);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setRefreshState("error");
      setRefreshMessage(message);
    }
  };

  return (
    <div className="breve-page">
      <PageHead
        title="Watchlist"
        detail="Tell Breve what to follow and what kind of change matters to you."
      />
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
        <span className="breve-watch-count">
          {topicCount} {topicCount === 1 ? "topic" : "topics"} in {sections.length}{" "}
          {sections.length === 1 ? "group" : "groups"}
        </span>
        <span className="breve-toolbar-grow" />
        {hasIssues ? (
          /* also covers a loaded file that ARRIVES invalid (external edit) —
             a greyed Save must never be unexplained (PR #11 review) */
          <span className="breve-watch-hint" role="status">
            Fix the marked rows to save
          </span>
        ) : (
          <SaveNote state={saveState} error={error} dirty={dirty} />
        )}
        <button type="button" className="ghostbtn" onClick={addGroup}>
          <PlusGlyph size={13} /> Add group
        </button>
        <button
          type="button"
          className="ghostbtn"
          disabled={hasIssues || refreshState === "running" || saveState === "saving"}
          title={
            hasIssues
              ? "Fix the marked watchlist rows first"
              : "Save any changes, then research this watchlist across the last 30 days"
          }
          onClick={() => void refreshLastThirtyDays()}
        >
          {refreshState === "running" ? "Refreshing 30 days…" : "Refresh last 30 days"}
        </button>
        <button
          type="button"
          className="ghostbtn primary"
          disabled={!dirty || hasIssues || saveState === "saving"}
          onClick={() => void save()}
        >
          {saveState === "saving" ? "Saving…" : "Save watchlist"}
        </button>
      </div>

      {refreshMessage && (
        <p
          className={`breve-watch-refresh-note ${refreshState}`}
          role={refreshState === "error" ? "alert" : "status"}
        >
          {refreshMessage}
        </p>
      )}

      <div className="breve-watch-groups">
        {visibleSections.map((section) => {
          const expanded = !!normalizedQuery || !collapsedGroups.has(section.id);
          const groupIssue = sectionIssue(sections, section);
          const hiddenIssues = expanded ? 0 : section.items.filter((item) => itemIssue(item)).length;
          return (
            <section
              className="breve-watch-group"
              key={section.id}
              aria-label={`${section.title || "Untitled"} watch group`}
            >
              <div className="breve-watch-group-head">
                <button
                  type="button"
                  className="breve-watch-disclosure"
                  aria-label={`${expanded ? "Collapse" : "Expand"} ${section.title || "watch group"}`}
                  aria-expanded={expanded}
                  onClick={() =>
                    setCollapsedGroups((current) => {
                      const next = new Set(current);
                      if (next.has(section.id)) next.delete(section.id);
                      else next.add(section.id);
                      return next;
                    })
                  }
                >
                  <ChevronRight size={12} className={expanded ? "open" : undefined} />
                </button>
                <label>
                  <span className="sr-only">Group name</span>
                  <input
                    ref={focusWhenPending(section.id)}
                    value={section.title}
                    aria-label="Group name"
                    placeholder="Name this group"
                    aria-invalid={!!groupIssue}
                    aria-describedby={groupIssue ? `breve-group-issue-${section.id}` : undefined}
                    onChange={(event) => updateSection(section.id, { title: event.target.value })}
                    onKeyDown={(event) => event.stopPropagation()}
                  />
                </label>
                <span>
                  {section.items.length} {section.items.length === 1 ? "topic" : "topics"}
                </span>
                <button
                  type="button"
                  className="ghostbtn breve-watch-add"
                  onClick={() => addTopic(section.id)}
                >
                  <PlusGlyph size={13} /> Add topic
                </button>
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
              {groupIssue && (
                <p id={`breve-group-issue-${section.id}`} className="breve-watch-row-issue" role="alert">
                  {groupIssue}
                </p>
              )}
              {hiddenIssues > 0 && (
                <p className="breve-watch-row-issue" role="alert">
                  {hiddenIssues === 1 ? "1 topic needs attention" : `${hiddenIssues} topics need attention`}
                  {" — expand the group to fix it."}
                </p>
              )}

              {expanded && (
                <>
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
                    {section.items.map((item) => {
                      const issue = itemIssue(item);
                      const issueId = `breve-topic-issue-${item.id}`;
                      if (openItems.has(item.id)) {
                        return (
                          <TopicEditor
                            key={item.id}
                            item={item}
                            issue={issue}
                            issueId={issueId}
                            onPatch={(patch) => updateItem(section.id, item.id, patch)}
                            onRemove={() => removeItem(section.id, item.id)}
                            onDone={() => toggleItem(item.id)}
                            focusRef={focusWhenPending(item.id)}
                          />
                        );
                      }
                      const domain = websiteDomain(item.url);
                      return (
                        <div className="breve-watch-row" key={item.id}>
                          <button
                            type="button"
                            className="breve-watch-row-open"
                            aria-expanded={false}
                            aria-describedby={issue ? issueId : undefined}
                            title={`Edit ${item.watch || "topic"}`}
                            onClick={() => toggleItem(item.id)}
                          >
                            <span className="breve-watch-row-name">{item.watch || "Untitled topic"}</span>
                            {domain ? (
                              <span className="breve-watch-row-domain">{domain}</span>
                            ) : (
                              <span className="breve-watch-row-domain empty">no website</span>
                            )}
                            <span className="breve-watch-row-lens">
                              {item.lens || "No guidance yet — Breve follows general news."}
                            </span>
                            <span className="breve-watch-row-edit" aria-hidden="true">
                              Edit
                            </span>
                          </button>
                          <button
                            type="button"
                            className="breve-watch-remove"
                            aria-label={`Remove ${item.watch || "empty topic"}`}
                            title="Remove topic"
                            onClick={() => removeItem(section.id, item.id)}
                          >
                            <XGlyph size={13} />
                          </button>
                          {issue && (
                            <p id={issueId} className="breve-watch-row-issue" role="alert">
                              {issue}
                            </p>
                          )}
                        </div>
                      );
                    })}
                    {section.items.length === 0 && (
                      <p className="breve-watch-group-empty">
                        No topics yet — use “+ Add topic” above to give Breve something to follow.
                      </p>
                    )}
                  </div>
                </>
              )}
            </section>
          );
        })}
        {sections.length === 0 && (
          <div className="breve-watch-empty">
            <p>Your watchlist is empty.</p>
            <span>
              Start with “Add group” to name an area you care about, then use “+ Add topic” inside the group
              for each company, person, or theme Breve should follow.
            </span>
            <button type="button" className="ghostbtn primary" onClick={addGroup}>
              <PlusGlyph size={13} /> Add first group
            </button>
          </div>
        )}
        {sections.length > 0 && visibleSections.length === 0 && (
          <div className="breve-watch-empty">
            <p>No topics match “{query}”.</p>
            <button type="button" className="ghostbtn" onClick={() => setQuery("")}>
              Clear search
            </button>
          </div>
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
            onChange={(event) => {
              setPreferences(event.target.value);
              setSaveState("idle");
            }}
            onKeyDown={(event) => event.stopPropagation()}
          />
        </label>
      </section>
    </div>
  );
}
