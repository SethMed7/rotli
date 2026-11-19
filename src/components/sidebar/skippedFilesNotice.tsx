// The vault's persistent, calm notice for files Rotli left out because they
// have a hard link (third review of pull request 267; src/lib/hardLinks.ts
// owns the words). One sentence, then the paths and what to do on request.
// No badge, no alarm, no dismiss: it stays while the files do, and goes when
// they're gone. Rotli never repairs a file.

import { useId, useState } from "react";

import { INDEPENDENT_COPY, searchSkippedLine, skippedSummary } from "../../lib/hardLinks";
import { useSkippedFiles } from "../../services/hooks";
import type { SkippedFile } from "../../types";

export const SHOW_FILES = "Show the files";
export const HIDE_FILES = "Hide the files";

export function SkippedFilesNotice() {
  return <SkippedFilesNoticeView files={useSkippedFiles()} />;
}

export function SkippedFilesNoticeView({
  files,
  defaultOpen = false,
}: {
  files: readonly SkippedFile[];
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const listId = useId();
  if (files.length === 0) return null;
  return (
    <section className="skipped-notice" aria-label="Files Rotli didn’t open">
      <p className="skipped-notice-text">{skippedSummary(files.length)}</p>
      <button
        type="button"
        className="skipped-notice-toggle"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((shown) => !shown)}
      >
        {open ? HIDE_FILES : SHOW_FILES}
      </button>
      {open && (
        <div id={listId} className="skipped-notice-detail">
          <ul className="skipped-notice-list">
            {files.map((file) => (
              <li key={file.path} className="skipped-notice-path">
                {file.path}
              </li>
            ))}
          </ul>
          <p className="skipped-notice-help">{INDEPENDENT_COPY}</p>
        </div>
      )}
    </section>
  );
}

/** The line under search results: said only while a query is typed. */
export function SearchSkippedLine({ query, count }: { query: string; count: number }) {
  if (query.trim() === "" || count === 0) return null;
  return <p className="pal-skipped">{searchSkippedLine(count)}</p>;
}
