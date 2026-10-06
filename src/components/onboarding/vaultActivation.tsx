// Where notes live, as one decision (the owner, 2026-10-01: "you either start
// fresh or connect a folder, that's it; after you pick it, no second stage").
// Create picks an empty folder and makes the vault there; Open picks a folder
// already holding notes and uses it in place, adding only Rotli's hidden
// .rotli sidecar. Picking the folder is the confirmation.

import { useEffect, useState } from "react";

import {
  corpusInspectFolder,
  corpusStatus,
  type CorpusConfigView,
  corpusListConfig,
  type CorpusRefView,
} from "../../lib/tauri";
import { chooseFolder, initMemexAsCorpus } from "../../memex/service";
import { activateCreatedVault, refreshActiveVault } from "../../state/activeVault";
import { ONBOARDING_STEP_NUMBER, ONBOARDING_TOTAL_STEPS } from "../../state/onboarding";
import { flushSettingsNow } from "../../state/persist";
import { useUiStore } from "../../state/ui";
import { requestVaultFolder } from "../../state/vaultFolderBrowser";
import { Character } from "../character";
import { OnboardingScenery } from "./onboardingScenery";
import {
  LIBRARIAN_ON_DESCRIPTION,
  SetupBack,
  SetupChoiceGroup,
  SetupPrimary,
  useSetupHandle,
} from "./setupControls";

type Intent = "create" | "open" | "current";

/** The vault setup may offer to keep: the one this install has chosen. A
 * debug build only borrows production's vault, read-only, to boot; keeping
 * that would record nothing, so setup would ask again on the next launch. */
export function keepableVault(
  config: Pick<CorpusConfigView, "corpus" | "developmentReadOnly">,
): CorpusRefView | null {
  return config.developmentReadOnly ? null : config.corpus;
}

export function vaultChoiceLabel(intent: Intent): string {
  if (intent === "create") return "Choose an empty folder";
  if (intent === "open") return "Choose an existing folder";
  return "Use this vault";
}

/** After opening a folder: carry on only when it really is the vault now. A
 * folder already open here is a no-op, which is fine for a vault this install
 * chose; a debug build only borrows production's vault read-only, so "opening"
 * it records nothing, and setup would end on the vault screen again. */
export function openedOrWhy(opened: boolean, configured: boolean): string | null {
  if (opened || configured) return null;
  return "That folder is already open here read-only, so Rotli can't keep it as this build's vault. Create a new vault, or pick another folder.";
}

/** Why a picked folder can't be used for what was asked, or null. */
export function folderMismatch(
  intent: "create" | "open",
  kind: "memex" | "markdown" | "empty",
): string | null {
  if (intent === "create" && kind !== "empty")
    return "That folder already has files. Choose Open an existing folder to use it as it is.";
  if (intent === "open" && kind === "empty")
    return "That folder is empty. Choose Create a Rotli vault to start fresh there.";
  return null;
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
  const [intent, setIntent] = useState<Intent>("create");
  // outside setup no Librarian screen follows, so a new vault asks here
  const [librarian, setLibrarian] = useState<"on" | "off">("on");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState<CorpusRefView | null>(null);

  useEffect(() => {
    if (!onboarding || !allowCurrent) return;
    let live = true;
    void corpusListConfig()
      .then((config) => {
        if (live) setCurrent(keepableVault(config));
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

  /** Pick the folder, and that's the vault: made fresh, or used in place. */
  const choose = async () => {
    if (busy) return;
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
            ? "Choose an empty folder inside Home, or create one here. Rotli keeps ordinary local files there."
            : "Choose the folder that already holds your notes. Rotli uses it in place and adds only a hidden .rotli folder.",
        actionLabel: intent === "create" ? "Create vault here" : "Open this folder",
        requireEmpty: intent === "create",
      });
      if (!path) return;
      // a read-only look first: nothing is written to a folder that doesn't fit
      const mismatch = folderMismatch(intent, (await corpusInspectFolder(path)).kind);
      if (mismatch) throw new Error(mismatch);
      await onBeforeSwitch?.();
      await flushSettingsNow();
      if (intent === "create") {
        // in setup, whether the Librarian works here is the next screen's question
        await initMemexAsCorpus(path, onboarding ? useUiStore.getState().brainEnabled : librarian === "on");
        await activateCreatedVault();
      } else if (await chooseFolder(path)) {
        await refreshActiveVault();
      } else {
        const why = openedOrWhy(false, await corpusStatus());
        if (why) throw new Error(why);
      }
      await onDone?.();
    } catch (cause) {
      await restoreVaultStep();
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const primary = () => void choose();
  useSetupHandle(primary, onBack);

  return (
    <div className="onb vault-activation">
      <div className="onb-drag" data-tauri-drag-region />
      <OnboardingScenery />
      <section className="setup-shell" aria-labelledby="vault-title">
        <div className="setup-progress">
          <span>{onboarding ? `${ONBOARDING_STEP_NUMBER.vault} of ${ONBOARDING_TOTAL_STEPS}` : "Vault"}</span>
          <span aria-hidden="true">·</span>
          <span>Vault</span>
        </div>

        <div className="setup-stage">
          <aside className="setup-companion" aria-hidden="true">
            <Character name={busy ? "searching" : "notes"} size={152} />
            <p>Your notes stay ordinary files you own.</p>
          </aside>

          <div className="setup-content">
            <h1 id="vault-title">Where should your notes live?</h1>
            <p className="setup-lede">
              Start fresh, or connect the Markdown folder you already use. Pick the folder and you&rsquo;re
              in.
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
                    "Pick an empty folder, or make one. Rotli sets up its plain-file structure there.",
                },
                {
                  value: "open",
                  title: "Open an existing folder",
                  description:
                    "Pick an Obsidian, ZenNotes, or other Markdown folder. It stays as it is; Rotli adds only a hidden .rotli folder.",
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
            {!onboarding && intent === "create" && (
              <SetupChoiceGroup
                label="Librarian choice"
                value={librarian}
                onChange={setLibrarian}
                options={[
                  {
                    value: "on",
                    title: "With the Librarian",
                    description: LIBRARIAN_ON_DESCRIPTION,
                  },
                  {
                    value: "off",
                    title: "Raw vault",
                    description:
                      "You arrange your notes yourself. Turn the Librarian on anytime in Settings.",
                  },
                ]}
              />
            )}
            <p className="setup-arrow-note">
              <kbd>←</kbd>
              <kbd>→</kbd> moves and selects
            </p>
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
            {onBack && <SetupBack disabled={busy} onClick={onBack} />}
            <SetupPrimary disabled={busy} onClick={primary}>
              {busy ? "Working…" : vaultChoiceLabel(intent)}
            </SetupPrimary>
          </div>
        </footer>
      </section>
    </div>
  );
}
