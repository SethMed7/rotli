// The Memory browser (Stage 1, Increment 2) — a strictly READ-ONLY tour of the
// active memex's spine. rotli reads the WHOLE brain (self · wiki · history ·
// chats · inbox · map) and writes only chats/ + inbox.md; this surface never
// writes anything. The top level is a small hardcoded root list (the readable
// spine); folders navigate in via useSpineDir (a breadcrumb tracks where you
// are), and a .md file reads into a <pre> with the chat styles. Mirrors
// ChatSurface's shape (chat-* classes), minus every write control. Opened from
// the module switcher; closes back to Notes via the memoryOpen surface flag.

import { useEffect, useState } from "react";
import { activeInstance, isWritable } from "../memex/config";
import { readSpine } from "../memex/service";
import { useMemexConfig, useSpineDir, useWriteNote } from "../memex/useMemex";
import { isTauri } from "../lib/tauri";
import { useUiStore } from "../state/ui";

/** The readable spine, top level — folders first, then the two loose files.
 * `history` is deliberately left off: it's the by-day stream, not browse-y. */
const ROOT_ENTRIES: { name: string; rel: string; isDir: boolean }[] = [
  { name: "wiki", rel: "wiki", isDir: true },
  { name: "self", rel: "self", isDir: true },
  { name: "chats", rel: "chats", isDir: true },
  { name: "MAP.md", rel: "MAP.md", isDir: false },
  { name: "inbox.md", rel: "inbox.md", isDir: false },
];

export function MemorySurface() {
  const setMemoryOpen = useUiStore((s) => s.setMemoryOpen);
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen);

  const cfg = useMemexConfig();
  const active = cfg.data ? activeInstance(cfg.data) : null;

  // where in the tree we are ("" = the root spine list) and the selected file
  const [dir, setDir] = useState("");
  const [file, setFile] = useState<string | null>(null);
  const [body, setBody] = useState("");

  // Phase 1 "Stage it": an explicit composer that writes a new note into the
  // active memex's wiki/_inbox/ staging per the v3.5 contract. Only when the brain
  // is writable for rotli; the rest of Memory stays strictly read-only.
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState("");
  const writeNote = useWriteNote();
  const canCompose = !!active && isWritable(active);

  const listing = useSpineDir(active, dir);
  // at the root we show the curated spine; inside a folder we show what's there
  const entries = dir === "" ? ROOT_ENTRIES : (listing.data ?? []);

  // read the selected .md (read-only — markdown styling is the editor's job;
  // a plain transcript is enough for the Memory browser)
  useEffect(() => {
    let cancelled = false;
    if (active && file) {
      readSpine(active, file)
        .then((t) => !cancelled && setBody(t))
        .catch(() => !cancelled && setBody(""));
    } else {
      setBody("");
    }
    return () => {
      cancelled = true;
    };
  }, [active, file]);

  const openSettings = () => {
    setMemoryOpen(false);
    setSettingsOpen(true);
  };

  // breadcrumb: a root crumb + one clickable crumb per path segment
  const segments = dir ? dir.split("/") : [];
  const goRoot = () => {
    setDir("");
    setFile(null);
  };
  const goSegment = (i: number) => {
    setDir(segments.slice(0, i + 1).join("/"));
    setFile(null);
  };

  const startCompose = () => {
    setFile(null);
    setComposing(true);
  };
  const saveNote = () => {
    if (!active || !draft.trim() || writeNote.isPending) return;
    writeNote.mutate(
      { instance: active, body: draft },
      {
        onSuccess: ({ stem }) => {
          setComposing(false);
          setDraft("");
          setDir("wiki/_inbox"); // jump to staging so the new note is visible…
          setFile(`wiki/_inbox/${stem}.md`); // …and read the note that just landed
        },
      },
    );
  };

  return (
    <div className="chat-surface">
      <header className="chat-head">
        <button type="button" className="chat-back" onClick={() => setMemoryOpen(false)}>
          <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
            <path d="M15 18l-6-6 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Notes
        </button>
        <h2>Memory</h2>
        {active && <span className="chat-inst">· {active.label}</span>}
        {canCompose && !composing && (
          <button type="button" className="mem-newnote" onClick={startCompose} title="Write a note into this memex (wiki/_inbox staging)">
            ＋ Note
          </button>
        )}
      </header>

      {!isTauri() ? (
        <div className="chat-empty">The Memory browser reads your memex — it runs in the app.</div>
      ) : !active ? (
        <div className="chat-empty">
          <p>No memex connected yet.</p>
          <button type="button" className="chat-cta" onClick={openSettings}>
            Connect one in Settings → Memory
          </button>
        </div>
      ) : (
        <div className="chat-body">
          <aside className="chat-list">
            <nav className="mem-crumbs" aria-label="Location">
              <button
                type="button"
                className={dir === "" ? "mem-crumb sel" : "mem-crumb"}
                onClick={goRoot}
              >
                {active.label}
              </button>
              {segments.map((seg, i) => (
                <span key={`${seg}-${i}`} className="mem-crumb-wrap">
                  <span className="mem-sep" aria-hidden="true">/</span>
                  <button
                    type="button"
                    className={i === segments.length - 1 ? "mem-crumb sel" : "mem-crumb"}
                    onClick={() => goSegment(i)}
                  >
                    {seg}
                  </button>
                </span>
              ))}
            </nav>
            {entries.map((e) =>
              e.isDir ? (
                <button
                  type="button"
                  key={e.rel}
                  className="mem-row mem-dir"
                  onClick={() => {
                    setDir(e.rel);
                    setFile(null);
                  }}
                >
                  <span className="mem-glyph" aria-hidden="true">📁</span>
                  <span className="mem-name">{e.name}</span>
                </button>
              ) : (
                <button
                  type="button"
                  key={e.rel}
                  className={file === e.rel ? "mem-row mem-file sel" : "mem-row mem-file"}
                  onClick={() => setFile(e.rel)}
                >
                  <span className="mem-glyph" aria-hidden="true">·</span>
                  <span className="mem-name">{e.name}</span>
                </button>
              ),
            )}
            {dir !== "" && entries.length === 0 && (
              <p className="chat-list-empty">Nothing here.</p>
            )}
          </aside>

          <main className="chat-main">
            <div className="chat-scroll">
              {composing ? (
                <div className="mem-compose">
                  <p className="mem-compose-hint">
                    New note → <b>{active.label}</b> <code>wiki/_inbox</code>. The first line is the
                    title; rotli files it for you later.
                  </p>
                  <textarea
                    className="mem-compose-area"
                    autoFocus
                    placeholder={"# A title\n\nThen your note…"}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                        e.preventDefault();
                        saveNote();
                      } else if (e.key === "Escape") {
                        setComposing(false);
                        setDraft("");
                      }
                    }}
                  />
                  {writeNote.isError && (
                    <p className="mem-compose-err">{String((writeNote.error as Error)?.message ?? writeNote.error)}</p>
                  )}
                  <div className="mem-compose-actions">
                    <button
                      type="button"
                      className="mem-compose-cancel"
                      onClick={() => {
                        setComposing(false);
                        setDraft("");
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="mem-compose-save"
                      disabled={!draft.trim() || writeNote.isPending}
                      onClick={saveNote}
                    >
                      {writeNote.isPending ? "Saving…" : "Save to memex"}
                    </button>
                  </div>
                </div>
              ) : file ? (
                <pre className="chat-pre">{body}</pre>
              ) : (
                <div className="chat-newhint">
                  <p>
                    Browsing <b>{active.label}</b>.
                  </p>
                  <p className="chat-sub">
                    Open a folder, then a <code>.md</code> file to read it. This is the whole brain
                    — self · wiki · chats · map · inbox.
                  </p>
                </div>
              )}
            </div>
            <div className="chat-readonly">
              {canCompose
                ? "Read-only browsing — only ＋ Note writes, into wiki/_inbox staging."
                : "Read-only — rotli never edits your memory here."}
            </div>
          </main>
        </div>
      )}
    </div>
  );
}
