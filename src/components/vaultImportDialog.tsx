// Adding a vault that already holds notes (docs/design/vault-copy-and-obsidian-
// compatibility.md): one dialog — confirm connecting it in place, or connect
// a copy with the Librarian; then the copy's progress with Cancel, then where
// the copy is or what went wrong.

import { answerVaultOpen, cancelVaultCopy, closeVaultImport } from "../services/vaultImport";
import { type VaultImportStep, useVaultImport } from "../state/vaultImport";
import { WebDialogFrame } from "./webDialogFrame";
import { WhyCopy } from "./whyCopy";

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
        title: `Connect “${step.label}”`,
        lines: [`It’s ${articled(step.source)} with ${plural(step.notes, "note", "notes")}.`],
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
          ...(step.report.marked === "imported"
            ? ["The Librarian is on for the copy, at Suggest: it proposes each change, and you approve it."]
            : []),
          ...(step.report.skipped.length > 0
            ? [
                `${plural(step.report.skipped.length, "linked item wasn’t", "linked items weren’t")} copied: ${step.report.skipped.slice(0, 5).join(", ")}${step.report.skipped.length > 5 ? "…" : ""}`,
              ]
            : []),
          ...(step.report.marked === "foreign"
            ? [
                "It has a memex.json from another app, which Rotli leaves as it is. So the copy is open as a protected folder: Rotli changes only what you ask for there, and the Librarian stays off.",
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
            <button type="button" className="rename-btn" onClick={() => answerVaultOpen("copy")}>
              Connect a copy with the Librarian
            </button>
            <button type="button" className="rename-btn primary" onClick={() => answerVaultOpen("in-place")}>
              Connect
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
            <strong>Connect.</strong> Rotli opens these notes where they are. You read and edit them as usual;
            nothing is moved or renamed, and the Librarian stays off here.
          </p>
          <p className="web-connect-line">
            <strong>Connect a copy with the Librarian.</strong> Rotli copies the folder beside your vaults,
            and the Librarian organizes the copy, suggesting each change first. Your original stays exactly as
            it is.
          </p>
          <WhyCopy />
        </>
      )}
      {copying && step.totalFiles > 0 && (
        <progress className="vault-import-progress" max={step.totalBytes || 1} value={step.bytes} />
      )}
    </WebDialogFrame>
  );
}
