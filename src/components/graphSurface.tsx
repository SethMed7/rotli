// The Graph view (exploration 2026-10-05): every note as a dot, every
// wikilink a person wrote as a line. A content view like Tasks — a
// projection, never a store; notes stay plain Markdown and nothing about them
// changes. It has no sidebar row and no per-note panel, so it adds nothing to
// the writing screen: ⌘K "Graph" opens the whole vault, and a note's context
// menu "Show in graph" opens the notes around it. One surface, two scopes.
// The Librarian's related notes draw as dashed lines, on by default so people
// see what it does, behind one remembered switch (owner decision 2026-10-06).

import "../styles/graph.css";
import { lazy, Suspense, useMemo, useState } from "react";

import { useVaultGraph } from "../graph/composition";
import { matchingNodes } from "../graph/model";
import { ALL_NOTES_SCOPE, scopeCenter, scopedGraph } from "../graph/workflow";
import { useGraphStore } from "../state/graph";
import { usePanesStore } from "../state/panes";
import { useUiStore } from "../state/ui";
import { BackToNotes } from "./backToNotes";
import { SurfaceSearch } from "./surfaceSearch";

const GraphCanvas = lazy(() => import("./graph/graphCanvas").then((m) => ({ default: m.GraphCanvas })));

export function GraphSurface() {
  const { graph, error } = useVaultGraph();
  const scope = useGraphStore((s) => s.scope);
  const setScope = useGraphStore((s) => s.setScope);
  const librarianLinks = useGraphStore((s) => s.librarianLinks);
  const setLibrarianLinks = useGraphStore((s) => s.setLibrarianLinks);
  const [query, setQuery] = useState("");

  const shown = useMemo(
    () => (graph ? scopedGraph(graph, scope, librarianLinks) : null),
    [graph, scope, librarianLinks],
  );
  // the switch exists only once the Librarian has linked something
  const hasLibrarianLinks = graph?.edges.some((edge) => edge.suggested) ?? false;
  const suggestedShown = shown?.edges.filter((edge) => edge.suggested).length ?? 0;
  const matched = useMemo(() => (shown ? matchingNodes(shown, query) : new Set<string>()), [shown, query]);
  const centerTitle =
    scope.kind === "around" ? (graph?.nodes.find((node) => node.id === scope.noteId)?.title ?? null) : null;

  const back = () => useUiStore.getState().setContentView("panes");
  // openNote returns the content area to the panes itself
  const open = (id: string, newTab: boolean) => {
    usePanesStore.getState().openNote(id, newTab ? { newTab: true } : undefined);
  };
  const center = (id: string) => setScope({ kind: "around", noteId: id, depth: 1 });

  return (
    <div className="board graph">
      <header className="board-head">
        <BackToNotes onClick={back} />
        <h2 className="board-title">Graph</h2>
        {shown && (
          <span className="board-count">
            {shown.nodes.length} {shown.nodes.length === 1 ? "note" : "notes"} · {shown.edges.length}{" "}
            {shown.edges.length === 1 ? "link" : "links"}
            {suggestedShown > 0 && ` · ${suggestedShown} from the Librarian`}
          </span>
        )}
        {hasLibrarianLinks && (
          <button
            type="button"
            className="graph-chip graph-switch"
            aria-pressed={librarianLinks}
            title="Related notes the Librarian found, drawn dashed"
            onClick={() => setLibrarianLinks(!librarianLinks)}
          >
            <span className="graph-switch-line" aria-hidden="true" />
            Librarian links
          </button>
        )}
        {scope.kind === "around" && (
          <div className="graph-scope" role="group" aria-label="Graph scope">
            <span className="graph-scope-label">
              Around <strong>{centerTitle ?? "this note"}</strong>
            </span>
            <button
              type="button"
              className="graph-chip"
              aria-pressed={scope.depth === 2}
              onClick={() => setScope({ ...scope, depth: scope.depth === 1 ? 2 : 1 })}
            >
              {scope.depth === 1 ? "Show 2 steps" : "Show 1 step"}
            </button>
            <button type="button" className="graph-chip" onClick={() => setScope(ALL_NOTES_SCOPE)}>
              All notes
            </button>
          </div>
        )}
        <SurfaceSearch value={query} onChange={setQuery} label="Find a note" clearLabel="Clear note search" />
      </header>
      {error ? (
        <p className="file-err graph-message" role="alert">
          Couldn’t read your links — {error}
        </p>
      ) : shown === null ? (
        <p className="main-empty">Loading…</p>
      ) : shown.nodes.length === 0 ? (
        <div className="list-empty">
          <p className="be-title">
            {scope.kind === "around" ? "This note isn’t in the graph" : "No notes yet"}
          </p>
          <p className="be-sub">
            {scope.kind === "around"
              ? "Archived notes, chats, and files stay out of the graph."
              : "Every note you write shows up here as a dot."}
          </p>
        </div>
      ) : (
        <>
          {shown.edges.length === 0 && (
            <p className="graph-message">
              None of these notes link to each other yet. Type <code>[[</code> in a note to link another one.
            </p>
          )}
          <Suspense fallback={<p className="main-empty">Loading…</p>}>
            <GraphCanvas
              graph={shown}
              center={scopeCenter(scope)}
              matched={matched}
              onOpen={open}
              onCenter={center}
            />
          </Suspense>
          <p className="graph-hint">Click opens · ⇧-click centers · drag to move · pinch to zoom · 0 fits</p>
        </>
      )}
    </div>
  );
}
