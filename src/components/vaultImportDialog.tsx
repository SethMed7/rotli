// "Work on a copy" (docs/design/vault-copy-and-obsidian-compatibility.md,
// slice 3): one dialog for a folder that already holds notes — the choice,
// the copy's progress with Cancel, then where the copy is or what went wrong.

import { answerVaultOpen, cancelVaultCopy, closeVaultImport } from "../services/vaultImport";
import { type VaultImportStep, useVaultImport } from "../state/vaultImport";
import { WebDialogFrame } from "./webDialogFrame";

/** Lines the copy shows while it runs (the tests read these, not copies). */
export const COPYING_LINES = {
  ready: "Getting ready…",
  onlyRead: "Your original is only read, never changed.",
} as const;

const megabytes = (bytes: number) => `${(bytes / 1_000_000).toFixed(bytes < 10_000_000 ? 1 : 0)} MB`;
const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** The dialog's title and lines for one step (pure; the tests read it). */
export function importCopy(step: Exclude<VaultImportStep, { kind: "idle" }>): {
  title: string;
  lines: string[];
} {
  switch (step.kind) {
    case "choose":
      return {
        title: `Open “${step.label}”`,
        lines: [
          `It’s ${articled(step.source)} with ${plural(step.notes, "note", "notes")}. How should Rotli open it?`,
        ],
      };
    case "copying":
      return {
        title: `Copying “${step.label}”`,
        lines: [
          step.totalFiles > 0
            ? `${plural(step.files, "file", "files")} of ${step.totalFiles.toLocaleString()} · ${megabytes(step.bytes)} of ${megabytes(step.totalBytes)}`
            : COPYING_LINES.ready,
          COPYING_LINES.onlyRead,
        ],
      };
    case "done":
      return {
        title: "Your copy is open",
        lines: [
          `Copied ${plural(step.report.files, "file", "files")} to ${step.report.destination}. Your original wasn’t changed.`,
          ...(step.report.skipped.length > 0
            ? [
                `${plural(step.report.skipped.length, "linked item wasn’t", "linked items weren’t")} copied: ${step.report.skipped.slice(0, 5).join(", ")}${step.report.skipped.length > 5 ? "…" : ""}`,
              ]
            : []),
        ],
      };
    case "failed":
      return { title: `Couldn’t copy “${step.label}”`, lines: [step.message] };
  }
}

function articled(source: string): string {
  return /^[aeiou]/i.test(source) ? `an ${source}` : `a ${source}`;
}

export function VaultImportDialog() {
  const step = useVaultImport((state) => state.step);
  if (step.kind === "idle") return null;
  const { title, lines } = importCopy(step);
  const copying = step.kind === "copying";
  const close = () =>
    step.kind === "choose" ? answerVaultOpen("cancel") : copying ? cancelVaultCopy() : closeVaultImport();
  return (
    <WebDialogFrame
      id="vault-import"
      title={title}
      busy={copying}
      onClose={close}
      actions={
        step.kind === "choose" ? (
          <>
            <button type="button" className="rename-btn" onClick={() => answerVaultOpen("in-place")}>
              Open in place
            </button>
            <button type="button" className="rename-btn primary" onClick={() => answerVaultOpen("copy")}>
              Work on a copy
            </button>
          </>
        ) : copying ? (
          <button type="button" className="rename-btn" onClick={cancelVaultCopy}>
            Cancel
          </button>
        ) : (
          <button type="button" className="rename-btn primary" onClick={closeVaultImport}>
            {step.kind === "done" ? "Done" : "Close"}
          </button>
        )
      }
    >
      {lines.map((line) => (
        <p key={line} className="web-connect-line" role={step.kind === "failed" ? "alert" : undefined}>
          {line}
        </p>
      ))}
      {step.kind === "choose" && (
        <>
          <p className="web-connect-line">
            <strong>Work on a copy (recommended).</strong> Rotli makes its own copy beside your vaults and
            opens that. Your original stays exactly as it is.
          </p>
          <p className="web-connect-line">
            <strong>Open in place.</strong> Rotli reads and edits these notes where they are, and never
            reorganizes them.
          </p>
        </>
      )}
      {copying && step.totalFiles > 0 && (
        <progress className="vault-import-progress" max={step.totalBytes || 1} value={step.bytes} />
      )}
    </WebDialogFrame>
  );
}
