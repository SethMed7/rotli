import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { relativeLabel } from "../lib/dateLabels";
import { type ModelUsageRange, type ModelUsageSummary, isTauri, modelUsage } from "../lib/tauri";
import { useSearchableNotes } from "../services/hooks";
import { usePanesStore } from "../state/panes";
import { useUiStore } from "../state/ui";
import {
  compactUsageNumber,
  estimatedModelCost,
  formatUsageUsd,
  modelUsageCost,
  modelUsageSnapshot,
  modelUsageTrend,
  providerTotals,
  usageTokenTotal,
} from "./modelUsageSummary";
import { chatMark } from "./sidebar/chatMark";
import { homeDashboardSnapshot } from "./sidebar/homeDashboardModel";
import { ModelLogo } from "./sidebar/modelLogo";
import { useChatFolders } from "./sidebar/useChatFolders";

const RANGE_OPTIONS: Array<{ id: ModelUsageRange; label: string }> = [
  { id: "24h", label: "24 hours" },
  { id: "7d", label: "7 days" },
  { id: "30d", label: "30 days" },
  { id: "90d", label: "90 days" },
];

const RANGE_MS: Record<ModelUsageRange, number> = {
  "24h": 24 * 60 * 60 * 1_000,
  "7d": 7 * 24 * 60 * 60 * 1_000,
  "30d": 30 * 24 * 60 * 60 * 1_000,
  "90d": 90 * 24 * 60 * 60 * 1_000,
};

function usageLine(summary: ModelUsageSummary | undefined) {
  const points = modelUsageTrend(summary);
  const high = Math.max(1, ...points.map((point) => point.tokens));
  return points
    .map((point, index) => {
      const x = points.length <= 1 ? 0 : (index / (points.length - 1)) * 100;
      const y = 30 - (point.tokens / high) * 27;
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

function costLabel(cost: ReturnType<typeof modelUsageCost>): string {
  if (cost.pricedTokens === 0) return "Unavailable";
  const formatted = formatUsageUsd(cost.usd);
  const estimate = formatted.startsWith("<") ? formatted : `~${formatted}`;
  return `${estimate}${cost.unpricedTokens > 0 ? "+" : ""}`;
}

function RotliActivity() {
  const [range, setRange] = useState<ModelUsageRange>("7d");
  const notes = useSearchableNotes().notes;
  const chats = useChatFolders();
  const chatModelMap = useUiStore((state) => state.chatModel);
  const openSummary = usePanesStore((state) => state.openSummary);
  const openChat = usePanesStore((state) => state.openChat);
  const dashboardModels = useMemo(
    () =>
      Object.fromEntries(
        chats.chatList.flatMap((chat) => {
          const scoped = chats.activeMemex ? `${chats.activeMemex.id}:${chat.slug}` : chat.slug;
          const id = chatModelMap[scoped] ?? chatModelMap[chat.slug];
          return id ? [[chat.slug, id]] : [];
        }),
      ),
    [chatModelMap, chats.activeMemex, chats.chatList],
  );
  const nowMs = Date.now();
  const sinceMs = nowMs - RANGE_MS[range];
  const snapshot = useMemo(
    () => homeDashboardSnapshot(notes, dashboardModels, chats.chatList, nowMs, RANGE_MS[range]),
    [notes, dashboardModels, chats.chatList, nowMs, range],
  );
  const recentNotes = useMemo(
    () =>
      notes
        .filter((note) => note.updatedAt >= sinceMs && note.updatedAt <= nowMs)
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 6),
    [notes, nowMs, sinceMs],
  );
  const recentChats = useMemo(
    () => chats.chatList.filter((chat) => chat.modifiedMs >= sinceMs && chat.modifiedMs <= nowMs).slice(0, 6),
    [chats.chatList, nowMs, sinceMs],
  );

  return (
    <>
      <section className="dashboard-usage-toolbar rotli" aria-label="Rotli activity controls">
        <div className="dashboard-range" role="group" aria-label="Rotli activity range">
          {RANGE_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              className={range === option.id ? "sel" : ""}
              aria-pressed={range === option.id}
              onClick={() => setRange(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </section>

      <section className="dashboard-metric-strip" aria-label="Rotli activity totals">
        <div>
          <span>Notes in this vault</span>
          <strong>{snapshot.notes.total}</strong>
        </div>
        <div>
          <span>New in range</span>
          <strong>{snapshot.notes.newInRange}</strong>
        </div>
        <div>
          <span>Updated in range</span>
          <strong>{snapshot.notes.updatedInRange}</strong>
        </div>
        <div>
          <span>Chats active</span>
          <strong>{snapshot.chat.activeInRange}</strong>
        </div>
      </section>

      <section className="dashboard-grid" aria-label="Rotli recents">
        <article className="dashboard-panel">
          <div className="dashboard-panel-head">
            <div>
              <span>Rotli activity</span>
              <strong>Recent notes</strong>
            </div>
            <small>Saved files</small>
          </div>
          <div className="dashboard-list">
            {recentNotes.map((note) => (
              <button type="button" key={note.id} onClick={() => openSummary(note)}>
                <span className="dashboard-list-mark" aria-hidden="true">
                  N
                </span>
                <span className="dashboard-list-copy">
                  <strong>{note.title || "Untitled"}</strong>
                  <small>Note</small>
                </span>
                <time>{relativeLabel(note.updatedAt)}</time>
                <span className="dashboard-list-arrow" aria-hidden="true">
                  ›
                </span>
              </button>
            ))}
            {recentNotes.length === 0 && <p className="dashboard-empty">No notes updated in this range.</p>}
          </div>
        </article>

        <article className="dashboard-panel">
          <div className="dashboard-panel-head">
            <div>
              <span>Rotli activity</span>
              <strong>Recent chats</strong>
            </div>
            <small>Vault files</small>
          </div>
          <div className="dashboard-list">
            {recentChats.map((chat) => (
              <button type="button" key={chat.slug} onClick={() => openChat(chat.slug)}>
                <span className="dashboard-list-mark chat" aria-hidden="true">
                  C
                </span>
                <span className="dashboard-list-copy">
                  <strong>{chat.title || chat.slug}</strong>
                  <small>Chat</small>
                </span>
                <time>{relativeLabel(chat.modifiedMs)}</time>
                <span className="dashboard-list-arrow" aria-hidden="true">
                  ›
                </span>
              </button>
            ))}
            {recentChats.length === 0 && <p className="dashboard-empty">No chats active in this range.</p>}
          </div>
        </article>
      </section>

      <section className="dashboard-provenance" aria-label="Writing provenance">
        <strong>Writing provenance</strong>
        <span>
          Human-versus-AI word totals stay hidden until Rotli can derive them from durable edit provenance.
          The current file alone cannot support an honest split.
        </span>
      </section>
    </>
  );
}

function ModelUsageDashboard() {
  const [range, setRange] = useState<ModelUsageRange>("30d");
  const [refreshing, setRefreshing] = useState(false);
  const queryClient = useQueryClient();
  const usage = useQuery({
    queryKey: ["modelUsage", range],
    queryFn: () => modelUsage(range),
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });
  const snapshot = modelUsageSnapshot(usage.data);
  const providers = providerTotals(snapshot.models);
  const estimatedCost = modelUsageCost(snapshot.models);
  const maxProvider = Math.max(1, ...providers.map(([, value]) => value.tokens));
  const total = Math.max(1, snapshot.tokens);
  const line = usageLine(usage.data);
  const browserOnly = !isTauri();
  const reading = usage.isFetching || refreshing;

  const refresh = async () => {
    setRefreshing(true);
    try {
      const value = await modelUsage(range, true);
      queryClient.setQueryData(["modelUsage", range], value);
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <>
      <section className="dashboard-usage-toolbar" aria-label="Model usage range">
        <div className="dashboard-range" role="group" aria-label="Time range">
          {RANGE_OPTIONS.map((option) => (
            <button
              type="button"
              key={option.id}
              className={range === option.id ? "sel" : ""}
              aria-pressed={range === option.id}
              onClick={() => setRange(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="dashboard-refresh"
          disabled={reading || browserOnly}
          onClick={() => void refresh()}
          aria-label="Refresh local model usage"
          title="Refresh local model usage"
        >
          <span className="dashboard-refresh-glyph" aria-hidden="true">
            ↻
          </span>
          <span>{reading ? "Reading…" : "Refresh"}</span>
        </button>
      </section>

      {usage.isLoading ? (
        <section
          className="dashboard-loading"
          role="status"
          aria-busy="true"
          aria-label="Reading local model usage"
        >
          <span />
          <span />
          <span />
        </section>
      ) : usage.isError ? (
        <section className="dashboard-state error" role="alert">
          <strong>Model usage could not be read.</strong>
          <span>{usage.error instanceof Error ? usage.error.message : String(usage.error)}</span>
        </section>
      ) : snapshot.tokens === 0 ? (
        <section className="dashboard-state">
          <strong>{browserOnly ? "Desktop-only model usage" : "No local session usage in this range"}</strong>
          <span>
            {browserOnly
              ? "The browser twin never scans provider histories on this computer. Open the Tauri app to view local aggregates."
              : "Rotli found no Claude Code or Codex token records in the selected time window."}
          </span>
        </section>
      ) : (
        <div className={reading ? "dashboard-results reading" : "dashboard-results"} aria-busy={reading}>
          {reading && (
            <div className="dashboard-reading-state" role="status">
              Updating {RANGE_OPTIONS.find((option) => option.id === range)?.label}…
            </div>
          )}
          <section className="dashboard-metric-strip models" aria-label="Model usage totals">
            <div>
              <span>API-equivalent cost</span>
              <strong>{costLabel(estimatedCost)}</strong>
              <small>Estimate, not billed spend</small>
            </div>
            <div>
              <span>Processed tokens</span>
              <strong>{compactUsageNumber(snapshot.tokens)}</strong>
            </div>
            <div>
              <span>Local sessions</span>
              <strong>{compactUsageNumber(snapshot.sessions)}</strong>
            </div>
            <div>
              <span>Cached input</span>
              <strong>{Math.round(snapshot.cacheShare * 100)}%</strong>
            </div>
          </section>

          <section className="dashboard-usage-grid">
            <article className="dashboard-panel dashboard-chart-panel">
              <div className="dashboard-panel-head">
                <div>
                  <span>Model usage</span>
                  <strong>Processed tokens</strong>
                </div>
                <small>{RANGE_OPTIONS.find((option) => option.id === range)?.label}</small>
              </div>
              <svg
                className="dashboard-usage-chart"
                viewBox="0 0 100 32"
                preserveAspectRatio="none"
                role="img"
              >
                <title>Processed model tokens over the selected time range</title>
                <path className="area" d={`${line} L100 32 L0 32 Z`} />
                <path className="line" d={line} />
              </svg>
              <div className="dashboard-chart-axis" aria-hidden="true">
                <span>{new Date(usage.data?.sinceMs ?? 0).toLocaleDateString()}</span>
                <span>{new Date(usage.data?.untilMs ?? 0).toLocaleDateString()}</span>
              </div>
            </article>

            <article className="dashboard-panel dashboard-provider-panel">
              <div className="dashboard-panel-head">
                <div>
                  <span>Provider histories</span>
                  <strong>Local coverage</strong>
                </div>
                <small>Claude Code + Codex</small>
              </div>
              <div className="dashboard-provider-list">
                {providers.map(([provider, value]) => {
                  const mark = chatMark(provider === "claude" ? "claude" : "codex", provider);
                  return (
                    <div key={provider}>
                      <div className="dashboard-provider-name">
                        <span>{mark.logo ? <ModelLogo logo={mark.logo} /> : mark.initial}</span>
                        <strong>{provider === "claude" ? "Claude Code" : "Codex"}</strong>
                        <small>
                          {costLabel(value.cost)} · {compactUsageNumber(value.tokens)}
                        </small>
                      </div>
                      <div className="dashboard-provider-track">
                        <span style={{ width: `${(value.tokens / maxProvider) * 100}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </article>
          </section>

          <section className="dashboard-panel dashboard-models" aria-label="Model breakdown">
            <div className="dashboard-panel-head">
              <div>
                <span>Model usage</span>
                <strong>Model breakdown</strong>
              </div>
              <small>{snapshot.models.length} models</small>
            </div>
            <div className="dashboard-model-table" role="table">
              <div className="head" role="row">
                <span role="columnheader">Model</span>
                <span role="columnheader">Provider</span>
                <span role="columnheader">Sessions</span>
                <span role="columnheader">Tokens</span>
                <span role="columnheader">Est. cost</span>
              </div>
              {snapshot.models.map((model) => {
                const tokens = usageTokenTotal(model.tokens);
                const cost = estimatedModelCost(model);
                return (
                  <div key={`${model.provider}:${model.model}`} role="row">
                    <strong role="cell">{model.model}</strong>
                    <span role="cell">{model.provider === "claude" ? "Claude Code" : "Codex"}</span>
                    <span role="cell">{model.sessions.toLocaleString()}</span>
                    <span role="cell">{compactUsageNumber(tokens)}</span>
                    <span role="cell" title={`${Math.round((tokens / total) * 100)}% of processed tokens`}>
                      {costLabel(cost)}
                    </span>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      )}

      <section className="dashboard-provenance model" aria-label="Model usage provenance">
        <strong>Local model telemetry</strong>
        <span>
          Rotli reads token counters from provider-owned local session histories and returns aggregates only.
          Dollar values are estimated API-equivalent costs from a price snapshot checked August 12, 2026—not
          subscription billing or an invoice. Estimates assume standard context and default cache-write rates;
          unknown model IDs stay unpriced. No prompt, response, project path, file name, or session identifier
          is sent to the webview.
        </span>
      </section>
    </>
  );
}

export function DashboardSurface() {
  const section = useUiStore((state) => state.dashboardSection);
  const setSection = useUiStore((state) => state.setDashboardSection);
  return (
    <main className={`dashboard-surface ${section}`}>
      <header className="dashboard-head">
        <div>
          <p>{section === "rotli" ? "Rotli activity" : "Provider activity"}</p>
          <h1>{section === "rotli" ? "Your vault in Rotli" : "Model usage on this Mac"}</h1>
        </div>
        <span>
          {section === "rotli"
            ? "Notes, chats, and saved file activity from this vault."
            : "Token and session aggregates from local provider histories—not subscription charges."}
        </span>
      </header>

      <nav className="dashboard-tabs" aria-label="Dashboard section">
        <button
          type="button"
          className={section === "rotli" ? "sel" : ""}
          aria-current={section === "rotli" ? "page" : undefined}
          onClick={() => setSection("rotli")}
        >
          <strong>Rotli activity</strong>
          <span>Vault notes and chats</span>
        </button>
        <button
          type="button"
          className={section === "models" ? "sel" : ""}
          aria-current={section === "models" ? "page" : undefined}
          onClick={() => setSection("models")}
        >
          <strong>Model usage</strong>
          <span>Local provider sessions</span>
        </button>
      </nav>

      {section === "rotli" ? <RotliActivity /> : <ModelUsageDashboard />}
    </main>
  );
}
