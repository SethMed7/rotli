import { useEffect, useState } from "react";

import { setSetupHandle } from "../../keys/handles";
import {
  corpusImportVaultCopy,
  corpusInspectFolder,
  corpusListConfig,
  type CorpusRefView,
  type VaultInspection,
} from "../../lib/tauri";
import { chooseFolder, initMemexAsCorpus } from "../../memex/service";
import { activateCreatedVault, refreshActiveVault } from "../../state/activeVault";
import { ONBOARDING_STEP_NUMBER, ONBOARDING_TOTAL_STEPS } from "../../state/onboarding";
import { flushSettingsNow } from "../../state/persist";
import { useUiStore } from "../../state/ui";
import { requestVaultFolder } from "../../state/vaultFolderBrowser";
import { Character } from "../character";
import { SetupBack, SetupChoiceGroup, SetupPrimary } from "./setupControls";
import { SetupSideFriends } from "./setupSideFriends";

type Stage = "choose" | "create" | "scanning" | "review";

type Intent = "create" | "open" | "current";
type ImportMode = "in-place" | "copy";

export function vaultChoiceLabel(intent: Intent): string {
  if (intent === "create") return "Choose an empty folder";
  if (intent === "open") return "Choose an existing folder";
  return "Use this vault";
}

export function VaultActivation({
  onboarding = false,
  allowCurrent = false,
  onDone,
  onBack,
  onBeforeSwitch,
  onSwitchFailed,
}: {
  onboarding?: boolean;
  allowCurrent?: boolean;
  onDone?: () => void | Promise<void>;
  onBack?: () => void;
  onBeforeSwitch?: () => void | Promise<void>;
  onSwitchFailed?: () => void | Promise<void>;
}) {
  const [stage, setStage] = useState<Stage>("choose");
  const [intent, setIntent] = useState<Intent>("create");
  const [createPath, setCreatePath] = useState<string | null>(null);
  const [inspection, setInspection] = useState<VaultInspection | null>(null);
  const [importMode, setImportMode] = useState<ImportMode>("in-place");
  const [brainEnabled, setBrainEnabled] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState<CorpusRefView | null>(null);

  useEffect(() => {
    if (!onboarding || !allowCurrent) return;
    let live = true;
    void corpusListConfig()
      .then((config) => {
        if (live) setCurrent(config.corpus);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [allowCurrent, onboarding]);

  const restoreVaultStep = async () => {
    try {
      await onSwitchFailed?.();
    } catch {
      // Preserve the real vault-operation error below; persistence will retry.
    }
  };

  const chooseIntent = async () => {
    setError(null);
    setBusy(true);
    try {
      if (intent === "current") {
        await onDone?.();
        return;
      }
      const path = await requestVaultFolder({
        title: intent === "create" ? "Create a Rotli vault" : "Open an existing folder",
        description:
          intent === "create"
            ? "Choose an empty folder inside Home, or create one here. Rotli will keep ordinary local files there."
            : "Choose the folder that already contains the notes and files you want Rotli to use in place.",
        actionLabel: intent === "create" ? "Use empty folder" : "Review folder",
        requireEmpty: intent === "create",
      });
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
      await restoreVaultStep();
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
        await onBeforeSwitch?.();
        await flushSettingsNow();
        await initMemexAsCorpus(createPath, brainEnabled);
        await activateCreatedVault();
        await onDone?.();
        return;
      }
      if (stage === "review" && inspection) {
        if (importMode === "copy") {
          const destination = await requestVaultFolder({
            title: "Choose a destination",
            description: "Choose an empty folder for the reviewed copy, or create a new folder here.",
            actionLabel: "Import here",
            requireEmpty: true,
          });
          if (!destination) return;
          await onBeforeSwitch?.();
          await flushSettingsNow();
          await corpusImportVaultCopy(inspection.path, destination);
          await refreshActiveVault();
        } else {
          await onBeforeSwitch?.();
          await flushSettingsNow();
          if (await chooseFolder(inspection.path)) await refreshActiveVault();
        }
        await onDone?.();
      }
    } catch (cause) {
      await restoreVaultStep();
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const back = () => {
    setError(null);
    setInspection(null);
    setCreatePath(null);
    setStage("choose");
  };

  const primary = stage === "choose" ? () => void chooseIntent() : () => void activate();
  const goBack = stage === "choose" ? onBack : back;
  useEffect(() => {
    setSetupHandle({ continue: primary, ...(goBack ? { back: goBack } : {}) });
    return () => setSetupHandle(null);
  });

  return (
    <div className="onb vault-activation">
      <div className="onb-drag" data-tauri-drag-region />
      <section className="setup-shell" aria-labelledby="vault-title">
        <div className="setup-progress">
          <span>{onboarding ? `${ONBOARDING_STEP_NUMBER.vault} of ${ONBOARDING_TOTAL_STEPS}` : "Vault"}</span>
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

        {onboarding && <SetupSideFriends />}

        <div className="setup-stage" key={stage}>
          <aside className="setup-companion" aria-hidden="true">
            <Character
              name={stage === "scanning" ? "searching" : stage === "review" ? "knowledge" : "notes"}
              size={152}
              alwaysVisible
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
                      title: "Create a Rotli vault",
                      description:
                        "Choose an empty home. Rotli marks the vault and sets up its documented plain-file structure.",
                    },
                    {
                      value: "open",
                      title: "Open an existing folder",
                      description:
                        "Review an Obsidian, ZenNotes, or other Markdown tree before rotli writes anything.",
                    },
                    ...(current
                      ? [
                          {
                            value: "current" as const,
                            title: `Keep ${current.absPath.split("/").pop() || "current vault"}`,
                            description: `Explicitly continue with ${current.absPath}.`,
                          },
                        ]
                      : []),
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
            {stage !== "scanning" && goBack && <SetupBack disabled={busy} onClick={goBack} />}
            {stage !== "scanning" && (
              <SetupPrimary
                disabled={busy || (stage === "review" && inspection?.kind === "empty")}
                onClick={primary}
              >
                {busy
                  ? "Working…"
                  : stage === "choose"
                    ? vaultChoiceLabel(intent)
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
