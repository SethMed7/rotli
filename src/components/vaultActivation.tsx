import { useEffect, useState } from "react";

import { setSetupHandle } from "../lib/setupHandle";
import { corpusImportVaultCopy, corpusInspectFolder, type VaultInspection } from "../lib/tauri";
import { chooseFolder, createPracticeVault, initMemexAsCorpus, pickFolder } from "../memex/service";
import { flushSettingsNow } from "../state/persist";
import { useUiStore } from "../state/ui";
import { Character } from "./character";
import { SetupChoiceGroup, SetupPrimary } from "./setupControls";

type Stage = "choose" | "create" | "scanning" | "review";
type Intent = "create" | "open" | "practice";
type ImportMode = "in-place" | "copy";

export function VaultActivation() {
  const [stage, setStage] = useState<Stage>("choose");
  const [intent, setIntent] = useState<Intent>("create");
  const [createPath, setCreatePath] = useState<string | null>(null);
  const [inspection, setInspection] = useState<VaultInspection | null>(null);
  const [importMode, setImportMode] = useState<ImportMode>("in-place");
  const [brainEnabled, setBrainEnabled] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chooseIntent = async () => {
    setError(null);
    setBusy(true);
    try {
      if (intent === "practice") {
        await flushSettingsNow();
        await createPracticeVault();
        return;
      }
      const path = await pickFolder();
      if (!path) return;
      if (intent === "create") {
        const report = await corpusInspectFolder(path);
        if (report.kind !== "empty") {
          throw new Error(
            "That folder already has files. Choose Open an existing folder so you can review it first.",
          );
        }
        setCreatePath(path);
        setStage("create");
      } else {
        setStage("scanning");
        setInspection(await corpusInspectFolder(path));
        setStage("review");
      }
    } catch (cause) {
      setStage("choose");
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const activate = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (stage === "create" && createPath) {
        useUiStore.getState().setBrainEnabled(brainEnabled);
        await flushSettingsNow();
        await initMemexAsCorpus(createPath, brainEnabled);
        return;
      }
      if (stage === "review" && inspection) {
        if (importMode === "copy") {
          const destination = await pickFolder();
          if (!destination) return;
          await flushSettingsNow();
          await corpusImportVaultCopy(inspection.path, destination);
        } else {
          await flushSettingsNow();
          await chooseFolder(inspection.path);
        }
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const primary = stage === "choose" ? () => void chooseIntent() : () => void activate();
  useEffect(() => {
    setSetupHandle({ continue: primary });
    return () => setSetupHandle(null);
  });

  const back = () => {
    setError(null);
    setInspection(null);
    setCreatePath(null);
    setStage("choose");
  };

  return (
    <div className="onb vault-activation">
      <div className="onb-drag" data-tauri-drag-region />
      <section className="setup-shell" aria-labelledby="vault-title">
        <div className="setup-progress">
          <span>Vault</span>
          <span aria-hidden="true">·</span>
          <span>
            {stage === "choose"
              ? "Choose"
              : stage === "create"
                ? "Create"
                : stage === "scanning"
                  ? "Scanning"
                  : "Review"}
          </span>
        </div>

        <div className="setup-stage" key={stage}>
          <aside className="setup-companion" aria-hidden="true">
            <Character
              name={stage === "scanning" ? "searching" : stage === "review" ? "knowledge" : "notes"}
              size={152}
            />
            <p>
              {stage === "review"
                ? "Your folders stay folders. Main mirrors them as references."
                : stage === "create"
                  ? "A fresh home, made of ordinary local files."
                  : "Nothing is chosen or changed until you confirm."}
            </p>
          </aside>

          <div className="setup-content">
            {stage === "choose" && (
              <>
                <p className="setup-eyebrow">One folder is one vault</p>
                <h1 id="vault-title">Where should your notes live?</h1>
                <p className="setup-lede">
                  Start fresh or bring the Markdown folder you already use. There is one Main view—not a
                  second copy of your files.
                </p>
                <SetupChoiceGroup
                  label="Vault choice"
                  value={intent}
                  onChange={setIntent}
                  options={[
                    {
                      value: "create",
                      title: "Create a new vault",
                      description: "Choose an empty home and let rotli set up its plain-file structure.",
                    },
                    {
                      value: "open",
                      title: "Open an existing folder",
                      description:
                        "Review an Obsidian, ZenNotes, or other Markdown tree before rotli writes anything.",
                    },
                    {
                      value: "practice",
                      title: "Try a practice vault",
                      description: "Let rotli make a disposable local playground so you can explore first.",
                    },
                  ]}
                />
                <p className="setup-arrow-note">
                  <kbd>←</kbd>
                  <kbd>→</kbd> moves and selects
                </p>
              </>
            )}

            {stage === "scanning" && (
              <div className="setup-scanning" role="status">
                <h1 id="vault-title">Reading the folder map…</h1>
                <p className="setup-lede">Counting notes and nested folders. No files are being written.</p>
                <span className="setup-scan-line" aria-hidden="true" />
              </div>
            )}

            {stage === "create" && createPath && (
              <>
                <p className="setup-eyebrow">New vault</p>
                <h1 id="vault-title">Create {createPath.split("/").pop()}?</h1>
                <p className="setup-path">{createPath}</p>
                <SetupChoiceGroup
                  label="Librarian choice"
                  value={brainEnabled ? "librarian" : "raw"}
                  onChange={(value) => setBrainEnabled(value === "librarian")}
                  options={[
                    {
                      value: "librarian",
                      title: "With the Librarian",
                      description:
                        "An on-device helper can file captures and suggest metadata. Actions are logged and undoable.",
                    },
                    {
                      value: "raw",
                      title: "Raw vault",
                      description:
                        "No AI organization. You arrange the same plain files yourself and can opt in later.",
                    },
                  ]}
                />
              </>
            )}

            {stage === "review" && inspection && (
              <>
                <p className="setup-eyebrow">{inspection.source}</p>
                <h1 id="vault-title">Bring in {inspection.label}.</h1>
                <p className="setup-path">{inspection.path}</p>
                <div className="vault-stats" aria-label="Vault scan summary">
                  <span>
                    <strong>{inspection.markdownFiles}</strong> Markdown notes
                  </span>
                  <span>
                    <strong>{inspection.folders}</strong> nested folders
                  </span>
                  <span>
                    <strong>{inspection.otherFiles}</strong> other files
                  </span>
                </div>
                <SetupChoiceGroup
                  label="Import method"
                  value={importMode}
                  onChange={setImportMode}
                  options={[
                    {
                      value: "in-place",
                      title: "Open in place",
                      description:
                        "Keep using this exact folder. rotli adds only its hidden .rotli sidecar after confirmation.",
                    },
                    {
                      value: "copy",
                      title: "Import a copy",
                      description: "Choose an empty destination. The source vault remains untouched.",
                    },
                  ]}
                />
                <div className="vault-preservation">
                  <strong>What stays intact</strong>
                  <span>Folder and nested-folder structure</span>
                  <span>Markdown files and conventional asset paths</span>
                  <span>One Main reference tree; no duplicate content store</span>
                </div>
                {inspection.warnings.map((warning) => (
                  <p className="setup-warning" key={warning}>
                    {warning}
                  </p>
                ))}
              </>
            )}

            {error && (
              <p className="setup-error" role="alert">
                {error}
              </p>
            )}
          </div>
        </div>

        <footer className="setup-footer">
          <span className="setup-local-note">Local files remain the durable truth.</span>
          <div className="setup-actions">
            {stage !== "choose" && stage !== "scanning" && (
              <button type="button" className="setup-button secondary" disabled={busy} onClick={back}>
                <kbd aria-hidden="true">←</kbd>
                <span>Back</span>
              </button>
            )}
            {stage !== "scanning" && (
              <SetupPrimary
                disabled={busy || (stage === "review" && inspection?.kind === "empty")}
                onClick={primary}
              >
                {busy
                  ? "Working…"
                  : stage === "choose"
                    ? "Choose folder"
                    : stage === "create"
                      ? "Create vault"
                      : importMode === "copy"
                        ? "Choose copy destination"
                        : "Open this vault"}
              </SetupPrimary>
            )}
          </div>
        </footer>
      </section>
    </div>
  );
}
