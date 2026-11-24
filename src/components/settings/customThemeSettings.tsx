// Settings → Appearance → My themes: the custom themes on this Mac. Choose,
// rename, export, delete, and import a theme file. A theme is checked by
// Rotli's contrast gate before it applies; when Rotli had to move a colour,
// this says which.

import { type CSSProperties, useMemo, useRef, useState } from "react";

import { resolveSeeds } from "../../brand/themeEngine/resolve";
import type { ThemeFileRead } from "../../brand/themeEngine/themeFile";
import { useCustomTheme } from "../../state/customTheme";
import {
  deleteCustomTheme,
  exportCustomTheme,
  importCustomTheme,
  renameCustomTheme,
  selectCustomTheme,
  themesAreDurable,
} from "../../themes/composition";
import { type ThemeEntry, previewRoles } from "../../themes/model";
import type { ImportResult } from "../../themes/workflow";
import { type CustomPreviewCanvas, WorkspacePreview } from "./workspacePreview";

type Readable = Extract<ThemeFileRead, { ok: true }>;

/** A theme's day and night as thumbnail canvases. */
function previewCanvases(read: Readable): CustomPreviewCanvas[] {
  const resolved = resolveSeeds(read.theme.seeds, read.theme.contrast);
  if (!resolved) return [];
  return (["light", "dark"] as const).map((mode) => ({
    mode,
    roles: previewRoles(resolved[mode].tokens) as CSSProperties,
  }));
}

/** The applied custom theme's canvases, for the Color scheme cards. */
export function useCustomPreview(): CustomPreviewCanvas[] | null {
  const selection = useCustomTheme((s) => s.selection);
  const notice = useCustomTheme((s) => s.notice);
  const entries = useCustomTheme((s) => s.entries);
  return useMemo(() => {
    if (!selection || notice) return null;
    const entry = entries.find((candidate) => candidate.id === selection.id);
    return entry?.read.ok ? previewCanvases(entry.read) : null;
  }, [selection, notice, entries]);
}

function ThemeCard({ entry, read, selected }: { entry: ThemeEntry; read: Readable; selected: boolean }) {
  const canvases = useMemo(() => previewCanvases(read), [read]);
  const [mode, setMode] = useState<"idle" | "rename" | "delete">("idle");
  const [draft, setDraft] = useState(read.theme.name);
  const [problem, setProblem] = useState<string | null>(null);
  const name = read.theme.name;

  const saveName = async () => {
    const next = draft.trim();
    if (!next || next === name) {
      setMode("idle");
      return;
    }
    const failure = await renameCustomTheme(entry.id, next);
    setProblem(failure);
    if (!failure) setMode("idle");
  };

  return (
    <div className="mytheme" data-theme-card={entry.id}>
      <button
        type="button"
        className={selected ? "famcard sel" : "famcard"}
        aria-pressed={selected}
        onClick={() => selectCustomTheme(entry.id)}
      >
        <WorkspacePreview environments={canvases} />
        <span className="famlabel">{name}</span>
        <span className="famcaption">
          {read.readOnly ? "From a newer Rotli · read-only here" : "Your theme, day and night"}
        </span>
      </button>
      {mode === "rename" ? (
        <form
          className="mytheme-actions"
          onSubmit={(event) => {
            event.preventDefault();
            void saveName();
          }}
        >
          <input
            className="rules-input"
            aria-label={`New name for ${name}`}
            value={draft}
            maxLength={48}
            autoFocus
            onChange={(event) => setDraft(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.stopPropagation();
                setDraft(name);
                setMode("idle");
              }
            }}
          />
          <button type="submit" className="ghostbtn">
            Save
          </button>
        </form>
      ) : mode === "delete" ? (
        <div className="mytheme-actions" role="group" aria-label={`Delete ${name}?`}>
          <span className="setnote">Delete {name}?</span>
          <button type="button" className="ghostbtn" onClick={() => void deleteCustomTheme(entry.id)}>
            Delete
          </button>
          <button type="button" className="ghostbtn" onClick={() => setMode("idle")}>
            Keep
          </button>
        </div>
      ) : (
        <div className="mytheme-actions">
          <button
            type="button"
            className="ghostbtn"
            disabled={read.readOnly}
            onClick={() => {
              setDraft(name);
              setProblem(null);
              setMode("rename");
            }}
          >
            Rename
          </button>
          <button
            type="button"
            className="ghostbtn"
            onClick={() =>
              void exportCustomTheme(entry.id, name).then((outcome) =>
                setProblem(outcome === "failed" ? "Couldn't export the theme. Try again." : null),
              )
            }
          >
            Export
          </button>
          <button type="button" className="ghostbtn" onClick={() => setMode("delete")}>
            Delete
          </button>
        </div>
      )}
      {problem && (
        <p className="setnote err" role="alert">
          {problem}
        </p>
      )}
    </div>
  );
}

const MAX_IMPORT_BYTES = 64 * 1024;

export function CustomThemeSettings() {
  const entries = useCustomTheme((s) => s.entries);
  const selection = useCustomTheme((s) => s.selection);
  const notice = useCustomTheme((s) => s.notice);
  const moved = useCustomTheme((s) => s.moved);
  const fileInput = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<{
    text: string;
    result: Extract<ImportResult, { status: "exists" }>;
  } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const finish = (result: ImportResult, text: string) => {
    if (result.status === "exists") setPending({ text, result });
    else {
      setPending(null);
      setProblem(result.status === "refused" ? result.problem : null);
    }
  };

  const importFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) {
      setProblem("This file is too large to be a theme.");
      return;
    }
    const text = await file.text();
    finish(await importCustomTheme(text), text);
  };

  return (
    <section className="mythemes" aria-labelledby="mythemes-head">
      <h4 className="sethead" id="mythemes-head">
        My themes
      </h4>
      <p className="lead">
        Themes you've made or imported. Rotli checks every color pair before a theme applies, and moves a
        color when it has to.
        {themesAreDurable() ? "" : " In the browser, imported themes last until you reload."}
      </p>
      {notice && (
        <p className="setnote" role="status">
          {notice}
        </p>
      )}
      {moved.length > 0 && (
        <details className="mytheme-moved">
          <summary>
            Rotli moved {moved.length} {moved.length === 1 ? "color" : "colors"} to keep it readable
          </summary>
          <ul>
            {moved.map((note) => (
              <li key={`${note.mode}-${note.role}`}>
                {note.mode === "light" ? "Day" : "Night"} {note.role.toLowerCase()}: {note.from} became{" "}
                {note.to}, {note.why}.
              </li>
            ))}
          </ul>
        </details>
      )}
      <div className="famrow">
        {entries.map((entry) =>
          entry.read.ok ? (
            <ThemeCard
              key={entry.id}
              entry={entry}
              read={entry.read}
              selected={selection?.id === entry.id && !notice}
            />
          ) : (
            <div className="famcard mytheme-unreadable" key={entry.id}>
              <span className="famlabel">Couldn't read {entry.id}.json</span>
              <span className="famcaption">Rotli left the file as it is.</span>
            </div>
          ),
        )}
      </div>
      <input
        ref={fileInput}
        type="file"
        accept=".json,application/json"
        hidden
        aria-hidden="true"
        tabIndex={-1}
        data-testid="theme-import-input"
        onChange={(event) => {
          const input = event.currentTarget;
          void importFile(input.files?.[0]).finally(() => {
            input.value = "";
          });
        }}
      />
      <button type="button" className="ghostbtn" onClick={() => fileInput.current?.click()}>
        Import theme…
      </button>
      {pending && (
        <div className="mytheme-actions" role="group" aria-label="A theme with this name is already here">
          <span className="setnote">{pending.result.plan.theme.name} is already here.</span>
          <button
            type="button"
            className="ghostbtn"
            onClick={() =>
              void importCustomTheme(pending.text, "replace").then((r) => finish(r, pending.text))
            }
          >
            Replace
          </button>
          <button
            type="button"
            className="ghostbtn"
            onClick={() =>
              void importCustomTheme(pending.text, "keep-both").then((r) => finish(r, pending.text))
            }
          >
            Keep both
          </button>
          <button type="button" className="ghostbtn" onClick={() => setPending(null)}>
            Cancel
          </button>
        </div>
      )}
      {problem && (
        <p className="setnote err" role="alert">
          {problem}
        </p>
      )}
    </section>
  );
}
